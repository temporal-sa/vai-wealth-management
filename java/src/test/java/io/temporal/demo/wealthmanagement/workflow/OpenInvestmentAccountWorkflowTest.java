package io.temporal.demo.wealthmanagement.workflow;

import io.temporal.activity.Activity;
import io.temporal.activity.ActivityInterface;
import io.temporal.activity.ActivityMethod;
import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowOptions;
import io.temporal.client.WorkflowStub;
import io.temporal.demo.wealthmanagement.common.ServerInfo;
import io.temporal.demo.wealthmanagement.model.InvestmentAccount;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountInput;
import io.temporal.demo.wealthmanagement.model.UpdateStatusInput;
import io.temporal.demo.wealthmanagement.model.WealthManagementClient;
import io.temporal.testing.TestWorkflowEnvironment;
import io.temporal.worker.Worker;
import io.temporal.workflow.ChildWorkflowOptions;
import io.temporal.workflow.QueryMethod;
import io.temporal.workflow.SignalMethod;
import io.temporal.workflow.Workflow;
import io.temporal.workflow.WorkflowInterface;
import io.temporal.workflow.WorkflowMethod;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Runs the workflow against fake versions of the TypeScript activities, registered under the real
 * activity names on the TypeScript task queue, so it can be tested without the TypeScript worker,
 * Redis or the data files.
 */
class OpenInvestmentAccountWorkflowTest {
    private static final String OPEN_ACCOUNT_QUEUE = "OpenAccount-test";
    private static final String CLIENT_ID = "123";
    private static final String ACCOUNT_NAME = "College Fund";
    private static final String PARENT_ID = "parent";
    private static final String CHILD_ID = "open-account-test-child";

    private TestWorkflowEnvironment testEnv;
    private WorkflowClient client;
    private FakeTypeScriptActivities tsActivities;

    @BeforeEach
    void setUp() {
        testEnv = TestWorkflowEnvironment.newInstance();
        client = testEnv.getWorkflowClient();

        Worker openAccountWorker = testEnv.newWorker(OPEN_ACCOUNT_QUEUE);
        openAccountWorker.registerWorkflowImplementationTypes(
                OpenInvestmentAccountWorkflowImpl.class, TestParentWorkflowImpl.class);

        // Stands in for the TypeScript worker, which hosts the activities
        tsActivities = new FakeTypeScriptActivities();
        Worker tsWorker = testEnv.newWorker(ServerInfo.getTaskqueue());
        tsWorker.registerActivitiesImplementations(tsActivities);

        testEnv.start();
    }

    @AfterEach
    void tearDown() {
        testEnv.close();
    }

    @Test
    void opensAccountAfterKycAndComplianceApproval() {
        TestParentWorkflow parent = startParent();
        OpenInvestmentAccountWorkflow child = waitForChild();

        assertEquals("Waiting KYC", child.getCurrentState());
        assertEquals("Jane", child.getClientDetails().firstName());

        child.verifyKyc();
        child.complianceApproved();
        WorkflowStub.fromTyped(parent).getResult(Void.class);

        assertEquals(List.of("getClient:" + CLIENT_ID, "openInvestment:" + CLIENT_ID + "/" + ACCOUNT_NAME + "/1000.0"),
                tsActivities.calls);
        assertEquals(List.of(
                "Account \"College Fund\" is waiting for KYC verification.",
                "KYC approved. Account \"College Fund\" is waiting for compliance review.",
                "Account \"College Fund\" has been successfully opened."), parent.getStatuses());
        assertEquals("Complete", child.getCurrentState());
    }

    @Test
    void updateClientDetailsChangesOnlyTheGivenFields() {
        startParent();
        OpenInvestmentAccountWorkflow child = waitForChild();

        child.updateClientDetails(Map.of("phone", "555-0100", "unknown_field", "ignored"));

        WealthManagementClient details = child.getClientDetails();
        assertEquals("555-0100", details.phone());
        assertEquals("Jane", details.firstName());
        assertEquals("jane@example.com", details.email());
        // Updating details does not approve KYC; the agent does that separately
        assertEquals("Waiting KYC", child.getCurrentState());
    }

    @Test
    void complianceApprovalBeforeKycWaitsForKyc() {
        TestParentWorkflow parent = startParent();
        OpenInvestmentAccountWorkflow child = waitForChild();

        child.complianceApproved();
        assertEquals("Waiting KYC", child.getCurrentState());

        child.verifyKyc();
        WorkflowStub.fromTyped(parent).getResult(Void.class);
        assertEquals("Complete", child.getCurrentState());
    }

    @Test
    void transientActivityFailuresAreRetried() {
        tsActivities.openInvestmentFailures.set(2);
        TestParentWorkflow parent = startParent();
        OpenInvestmentAccountWorkflow child = waitForChild();
        child.verifyKyc();
        child.complianceApproved();
        WorkflowStub.fromTyped(parent).getResult(Void.class);

        assertEquals(3, tsActivities.openInvestmentAttempts.get());
    }

    // The TypeScript supervisor sends plain JSON objects, so check the wire format rather than the Java types
    @Test
    void acceptsAndReturnsTheTypeScriptJsonShapes() {
        WorkflowStub workflow = client.newUntypedWorkflowStub("OpenInvestmentAccountWorkflow",
                WorkflowOptions.newBuilder()
                        .setWorkflowId("open-account-" + UUID.randomUUID())
                        .setTaskQueue(OPEN_ACCOUNT_QUEUE)
                        .build());
        startParentOnly();
        workflow.start(Map.of(
                "client_id", CLIENT_ID,
                "account_name", ACCOUNT_NAME,
                "initial_amount", 250,
                "parent_workflow_id", PARENT_ID));

        Map<?, ?> details = waitForQuery(() -> workflow.query("get_client_details", Map.class));
        assertEquals("Jane", details.get("first_name"));
        assertEquals("single", details.get("marital_status"));

        workflow.signal("verify_kyc");
        workflow.signal("compliance_approved");
        assertNull(workflow.getResult(Object.class));
        assertEquals("openInvestment:" + CLIENT_ID + "/" + ACCOUNT_NAME + "/250.0", tsActivities.calls.get(1));
    }

    private TestParentWorkflow startParent() {
        TestParentWorkflow parent = client.newWorkflowStub(TestParentWorkflow.class,
                WorkflowOptions.newBuilder().setWorkflowId(PARENT_ID).setTaskQueue(OPEN_ACCOUNT_QUEUE).build());
        WorkflowClient.start(parent::run, true);
        return parent;
    }

    private void startParentOnly() {
        TestParentWorkflow parent = client.newWorkflowStub(TestParentWorkflow.class,
                WorkflowOptions.newBuilder().setWorkflowId(PARENT_ID).setTaskQueue(OPEN_ACCOUNT_QUEUE).build());
        WorkflowClient.start(parent::run, false);
    }

    // The parent starts the child asynchronously, so poll until the child has loaded the client
    private OpenInvestmentAccountWorkflow waitForChild() {
        OpenInvestmentAccountWorkflow child = client.newWorkflowStub(OpenInvestmentAccountWorkflow.class, CHILD_ID);
        waitForQuery(child::getClientDetails);
        return child;
    }

    private static <T> T waitForQuery(java.util.function.Supplier<T> query) {
        long deadline = System.currentTimeMillis() + 10_000;
        while (true) {
            try {
                T result = query.get();
                if (result != null) {
                    return result;
                }
            } catch (RuntimeException e) {
                if (System.currentTimeMillis() > deadline) {
                    throw e;
                }
            }
            if (System.currentTimeMillis() > deadline) {
                throw new AssertionError("query never returned a result");
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AssertionError(e);
            }
        }
    }

    // Plays the part of the TypeScript supervisor: starts the child and records its status signals
    @WorkflowInterface
    public interface TestParentWorkflow {
        @WorkflowMethod
        void run(boolean startChild);

        @SignalMethod(name = "update_status")
        void updateStatus(UpdateStatusInput input);

        @QueryMethod
        List<String> getStatuses();
    }

    public static class TestParentWorkflowImpl implements TestParentWorkflow {
        private final List<String> statuses = new ArrayList<>();

        @Override
        public void run(boolean startChild) {
            if (startChild) {
                OpenInvestmentAccountWorkflow child = Workflow.newChildWorkflowStub(
                        OpenInvestmentAccountWorkflow.class,
                        ChildWorkflowOptions.newBuilder().setWorkflowId(CHILD_ID).build());
                child.run(new OpenInvestmentAccountInput(CLIENT_ID, ACCOUNT_NAME, 1000.0, PARENT_ID));
            }
            // let the final status signal arrive before completing
            Workflow.await(() -> statuses.stream().anyMatch(s -> s.endsWith("successfully opened.")));
        }

        @Override
        public void updateStatus(UpdateStatusInput input) {
            statuses.add(input.status());
        }

        @Override
        public List<String> getStatuses() {
            return statuses;
        }
    }

    // Same activity names and signatures as the TypeScript activities
    @ActivityInterface
    public interface TypeScriptActivities {
        @ActivityMethod(name = "getClient")
        WealthManagementClient getClient(String clientId);

        @ActivityMethod(name = "openInvestment")
        InvestmentAccount openInvestment(String clientId, String name, double balance);
    }

    static class FakeTypeScriptActivities implements TypeScriptActivities {
        // Activity calls, in order
        final List<String> calls = Collections.synchronizedList(new ArrayList<>());
        // openInvestment fails this many attempts before succeeding
        final AtomicInteger openInvestmentFailures = new AtomicInteger();
        final AtomicInteger openInvestmentAttempts = new AtomicInteger();

        @Override
        public WealthManagementClient getClient(String clientId) {
            calls.add("getClient:" + clientId);
            return new WealthManagementClient(clientId, "Jane", "Doe", "1 Main St", "555-0199",
                    "jane@example.com", "single");
        }

        @Override
        public InvestmentAccount openInvestment(String clientId, String name, double balance) {
            openInvestmentAttempts.incrementAndGet();
            if (Activity.getExecutionContext().getInfo().getAttempt() <= openInvestmentFailures.get()) {
                throw new RuntimeException("core banking unavailable");
            }
            calls.add("openInvestment:" + clientId + "/" + name + "/" + balance);
            return new InvestmentAccount("i-test", name, balance);
        }
    }
}
