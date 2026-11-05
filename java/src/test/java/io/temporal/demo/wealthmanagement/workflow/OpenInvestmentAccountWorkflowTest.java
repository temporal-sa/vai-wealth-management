package io.temporal.demo.wealthmanagement.workflow;

import io.temporal.activity.Activity;
import io.temporal.activity.ActivityInterface;
import io.temporal.activity.ActivityMethod;
import io.temporal.api.enums.v1.EventType;
import io.temporal.api.enums.v1.WorkflowExecutionStatus;
import io.temporal.api.history.v1.HistoryEvent;
import io.temporal.api.workflowservice.v1.DescribeWorkflowExecutionRequest;
import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowOptions;
import io.temporal.client.WorkflowStub;
import io.temporal.demo.wealthmanagement.common.ServerInfo;
import io.temporal.demo.wealthmanagement.model.InvestmentAccount;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountInput;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountOutput;
import io.temporal.demo.wealthmanagement.model.UpdateStatusInput;
import io.temporal.demo.wealthmanagement.model.WealthManagementClient;
import io.temporal.failure.ApplicationFailure;
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
import java.util.concurrent.ConcurrentHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
    private static final String INVESTMENT_ID = "i-test";

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
        OpenInvestmentAccountOutput result = WorkflowStub.fromTyped(child).getResult(OpenInvestmentAccountOutput.class);
        WorkflowStub.fromTyped(parent).getResult(Void.class);

        assertTrue(result.accountCreated());
        assertEquals(List.of("getClient:" + CLIENT_ID, "openInvestment:" + ACCOUNT_NAME + "/1000.0",
                "debit:1000.0/" + initialDepositId(child), "register:" + INVESTMENT_ID), tsActivities.calls);
        assertEquals(List.of(
                "Waiting KYC",
                "Waiting Compliance Review",
                "Compliance review has been approved. Creating Investment Account",
                "Creating the account record.",
                "Transferring $1,000.00 from the linked bank account.",
                "Registering the account with the custodian.",
                "Complete"), parent.getStatuses());
        assertEquals("Complete", child.getCurrentState());
    }

    @Test
    void updateClientDetailsSavesTheDetailsAndApprovesKyc() {
        startParent();
        OpenInvestmentAccountWorkflow child = waitForChild();

        WealthManagementClient saved = child.updateClientDetails(Map.of("phone", "555-0100"));

        assertEquals("555-0100", saved.phone());
        assertEquals("Jane", saved.firstName());
        assertEquals("555-0100", child.getClientDetails().phone());
        assertTrue(tsActivities.calls.contains("updateClient:" + CLIENT_ID + "/{phone=555-0100}"));
        // Saving the details approves KYC, so the workflow moves on to compliance review
        waitForQuery(() -> "Waiting Compliance Review".equals(child.getCurrentState()) ? true : null);
    }

    @Test
    void reopeningAfterRollbackUsesANewTransferId() {
        tsActivities.failures.put("registerAccount", "reject");
        OpenInvestmentAccountWorkflow first = startAndApprove(null);
        WorkflowStub.fromTyped(first).getResult(OpenInvestmentAccountOutput.class);
        String firstDebit = initialDepositId(first);
        tsActivities.failures.clear();
        // The parent closes after the final status signal; wait for it so its ID can be reused
        client.newUntypedWorkflowStub(PARENT_ID).getResult(Void.class);

        // Same parent and child workflow IDs, as when the customer opens the same account again in a chat
        OpenInvestmentAccountOutput result = runToCompletion(null);

        assertTrue(result.accountCreated());
        List<String> debits = tsActivities.calls.stream().filter(c -> c.startsWith("debit:")).toList();
        assertEquals(2, debits.size());
        assertEquals("debit:1000.0/" + firstDebit, debits.get(0));
        assertFalse(debits.get(1).equals(debits.get(0)), "a reused transfer ID would not move any money");
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
    void transientFailuresAreRetriedNotRolledBack() {
        tsActivities.failures.put("openInvestment", 2);
        OpenInvestmentAccountOutput result = runToCompletion(null);

        assertTrue(result.accountCreated());
        assertEquals(List.of("getClient:" + CLIENT_ID,
                "openInvestment attempt 1 failed", "openInvestment attempt 2 failed",
                "openInvestment:" + ACCOUNT_NAME + "/1000.0",
                "debit:1000.0/" + initialDepositId(childStub()), "register:" + INVESTMENT_ID), tsActivities.calls);
    }

    @Test
    void sagaRollsBackInReverseWhenCustodianRejects() {
        tsActivities.failures.put("registerAccount", "reject");
        OpenInvestmentAccountWorkflow child = startAndApprove(null);
        OpenInvestmentAccountOutput result = WorkflowStub.fromTyped(child).getResult(OpenInvestmentAccountOutput.class);
        TestParentWorkflow parent = client.newWorkflowStub(TestParentWorkflow.class, PARENT_ID);
        WorkflowStub.fromTyped(parent).getResult(Void.class);

        assertFalse(result.accountCreated());
        assertEquals("The account was not opened: registerAccount rejected", result.message());
        assertEquals("Rolled back. The account was not opened: registerAccount rejected.", child.getCurrentState());
        String transferId = initialDepositId(child);
        assertEquals(List.of("getClient:" + CLIENT_ID, "openInvestment:" + ACCOUNT_NAME + "/1000.0",
                "debit:1000.0/" + transferId, "register:" + INVESTMENT_ID,
                "credit:1000.0/" + transferId + "-refund", "closeInvestment:" + INVESTMENT_ID),
                tsActivities.calls);
        List<String> statuses = parent.getStatuses();
        assertEquals(List.of(
                "Failed: registerAccount rejected. Rolling back.",
                "Rolling back: refunding $1,000.00 to the linked bank account.",
                "Rolling back: removing the account record.",
                "Rolled back. The account was not opened: registerAccount rejected."),
                statuses.subList(statuses.size() - 4, statuses.size()));
    }

    @Test
    void sagaUndoesOnlyCompletedSteps() {
        tsActivities.failures.put("debitLinkedAccount", "reject");
        OpenInvestmentAccountOutput result = runToCompletion(null);

        assertFalse(result.accountCreated());
        // The debit never happened, so there is nothing to refund
        assertEquals(List.of("getClient:" + CLIENT_ID, "openInvestment:" + ACCOUNT_NAME + "/1000.0",
                "debit:1000.0/" + initialDepositId(childStub()), "closeInvestment:" + INVESTMENT_ID),
                tsActivities.calls);
    }

    @Test
    void promoCodeBugPausesTheWorkflowInsteadOfFailingIt() throws InterruptedException {
        OpenInvestmentAccountWorkflow child = startAndApprove("WELCOME-BONUS");
        String workflowId = WorkflowStub.fromTyped(child).getExecution().getWorkflowId();

        String failure = null;
        for (int i = 0; i < 40 && failure == null; i++) {
            for (HistoryEvent event : client.fetchHistory(workflowId).getEvents()) {
                if (event.getEventType() == EventType.EVENT_TYPE_WORKFLOW_TASK_FAILED) {
                    failure = event.getWorkflowTaskFailedEventAttributes().getFailure().getMessage();
                }
            }
            Thread.sleep(250);
        }

        assertNotNull(failure, "the demo bug should fail the workflow task");
        // Paused, not failed: still running, and the saga never started
        WorkflowExecutionStatus status = testEnv.getWorkflowServiceStubs().blockingStub()
                .describeWorkflowExecution(DescribeWorkflowExecutionRequest.newBuilder()
                        .setNamespace(testEnv.getNamespace())
                        .setExecution(WorkflowStub.fromTyped(child).getExecution())
                        .build())
                .getWorkflowExecutionInfo().getStatus();
        assertEquals(WorkflowExecutionStatus.WORKFLOW_EXECUTION_STATUS_RUNNING, status);
        assertFalse(tsActivities.calls.stream().anyMatch(c -> c.startsWith("openInvestment")));
        WorkflowStub.fromTyped(child).terminate("test finished");
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

        Map<?, ?> details = workflow.update("get_client_details", Map.class);
        assertEquals("Jane", details.get("first_name"));
        assertEquals("single", details.get("marital_status"));

        workflow.signal("verify_kyc");
        workflow.signal("compliance_approved");
        Map<?, ?> result = workflow.getResult(Map.class);
        assertEquals(true, result.get("account_created"));
        assertEquals("openInvestment:" + ACCOUNT_NAME + "/250.0", tsActivities.calls.get(1));
    }

    // Starts the child through the test parent, approves KYC and compliance, and waits for the result
    private OpenInvestmentAccountOutput runToCompletion(String promoCode) {
        OpenInvestmentAccountWorkflow child = startAndApprove(promoCode);
        return WorkflowStub.fromTyped(child).getResult(OpenInvestmentAccountOutput.class);
    }

    private OpenInvestmentAccountWorkflow startAndApprove(String promoCode) {
        TestParentWorkflow parent = client.newWorkflowStub(TestParentWorkflow.class,
                WorkflowOptions.newBuilder().setWorkflowId(PARENT_ID).setTaskQueue(OPEN_ACCOUNT_QUEUE).build());
        WorkflowClient.start(parent::run, promoCode == null ? "" : promoCode);
        OpenInvestmentAccountWorkflow child = waitForChild();
        child.verifyKyc();
        child.complianceApproved();
        return child;
    }

    private TestParentWorkflow startParent() {
        TestParentWorkflow parent = client.newWorkflowStub(TestParentWorkflow.class,
                WorkflowOptions.newBuilder().setWorkflowId(PARENT_ID).setTaskQueue(OPEN_ACCOUNT_QUEUE).build());
        WorkflowClient.start(parent::run, "");
        return parent;
    }

    private void startParentOnly() {
        TestParentWorkflow parent = client.newWorkflowStub(TestParentWorkflow.class,
                WorkflowOptions.newBuilder().setWorkflowId(PARENT_ID).setTaskQueue(OPEN_ACCOUNT_QUEUE).build());
        WorkflowClient.start(parent::run, (String) null);
    }

    // The parent starts the child asynchronously, so poll until the child has started. Then
    // get_client_details waits until it has loaded the client.
    private OpenInvestmentAccountWorkflow waitForChild() {
        OpenInvestmentAccountWorkflow child = childStub();
        waitForQuery(child::getCurrentState);
        child.getClientDetails();
        return child;
    }

    private OpenInvestmentAccountWorkflow childStub() {
        return client.newWorkflowStub(OpenInvestmentAccountWorkflow.class, CHILD_ID);
    }

    // The idempotency key of the initial deposit, which is unique per run of the child
    private String initialDepositId(OpenInvestmentAccountWorkflow child) {
        String runId = WorkflowStub.fromTyped(child).getExecution().getRunId();
        if (runId == null || runId.isEmpty()) {
            runId = testEnv.getWorkflowServiceStubs().blockingStub()
                    .describeWorkflowExecution(DescribeWorkflowExecutionRequest.newBuilder()
                            .setNamespace(testEnv.getNamespace())
                            .setExecution(io.temporal.api.common.v1.WorkflowExecution.newBuilder()
                                    .setWorkflowId(CHILD_ID).build())
                            .build())
                    .getWorkflowExecutionInfo().getExecution().getRunId();
        }
        return CHILD_ID + "-" + runId + "-initial-deposit";
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
        // promoCode: null to not start a child, "" to start one without a promo code
        @WorkflowMethod
        void run(String promoCode);

        @SignalMethod(name = "update_status")
        void updateStatus(UpdateStatusInput input);

        @QueryMethod
        List<String> getStatuses();
    }

    public static class TestParentWorkflowImpl implements TestParentWorkflow {
        private final List<String> statuses = new ArrayList<>();

        @Override
        public void run(String promoCode) {
            if (promoCode != null) {
                OpenInvestmentAccountWorkflow child = Workflow.newChildWorkflowStub(
                        OpenInvestmentAccountWorkflow.class,
                        ChildWorkflowOptions.newBuilder().setWorkflowId(CHILD_ID).build());
                child.run(new OpenInvestmentAccountInput(CLIENT_ID, ACCOUNT_NAME, 1000.0, PARENT_ID,
                        promoCode.isEmpty() ? null : promoCode));
            }
            // let the final status signal arrive before completing
            Workflow.await(() -> statuses.stream()
                    .anyMatch(s -> s.equals("Complete") || s.startsWith("Rolled back")));
        }

        // Records the reported states, and checks that each one says which opening it is for
        @Override
        public void updateStatus(UpdateStatusInput input) {
            if (!ACCOUNT_NAME.equals(input.accountName()) || input.workflowId() == null) {
                throw new IllegalArgumentException("unexpected status update " + input);
            }
            statuses.add(input.state());
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

        @ActivityMethod(name = "updateClient")
        WealthManagementClient updateClient(String clientId, Map<String, Object> fields);

        @ActivityMethod(name = "openInvestment")
        InvestmentAccount openInvestment(String clientId, String name, double balance);

        @ActivityMethod(name = "closeInvestment")
        boolean closeInvestment(String clientId, String investmentId);

        @ActivityMethod(name = "debitLinkedAccount")
        Map<String, Object> debitLinkedAccount(String clientId, double amount, String transferId);

        @ActivityMethod(name = "creditLinkedAccount")
        Map<String, Object> creditLinkedAccount(String clientId, double amount, String transferId);

        @ActivityMethod(name = "registerAccount")
        String registerAccount(String clientId, String investmentId, double amount);
    }

    static class FakeTypeScriptActivities implements TypeScriptActivities {
        // Activity calls, in order
        final List<String> calls = Collections.synchronizedList(new ArrayList<>());
        // Keyed by activity name: "reject" fails non-retryably; an Integer N fails the first N attempts
        final Map<String, Object> failures = new ConcurrentHashMap<>();

        private void maybeFail(String name) {
            Object behavior = failures.get(name);
            if ("reject".equals(behavior)) {
                throw ApplicationFailure.newNonRetryableFailure(name + " rejected", "Rejected");
            }
            int attempt = Activity.getExecutionContext().getInfo().getAttempt();
            if (behavior instanceof Integer n && attempt <= n) {
                calls.add(name + " attempt " + attempt + " failed");
                throw new RuntimeException(name + " unavailable");
            }
        }

        @Override
        public WealthManagementClient getClient(String clientId) {
            calls.add("getClient:" + clientId);
            return new WealthManagementClient(clientId, "Jane", "Doe", "1 Main St", "555-0199",
                    "jane@example.com", "single");
        }

        @Override
        public WealthManagementClient updateClient(String clientId, Map<String, Object> fields) {
            calls.add("updateClient:" + clientId + "/" + fields);
            WealthManagementClient c = getClient(clientId);
            calls.remove(calls.size() - 1);
            return new WealthManagementClient(c.clientId(), c.firstName(), c.lastName(), c.address(),
                    (String) fields.getOrDefault("phone", c.phone()), c.email(), c.maritalStatus());
        }

        @Override
        public InvestmentAccount openInvestment(String clientId, String name, double balance) {
            maybeFail("openInvestment");
            calls.add("openInvestment:" + name + "/" + balance);
            return new InvestmentAccount(INVESTMENT_ID, name, balance);
        }

        @Override
        public boolean closeInvestment(String clientId, String investmentId) {
            calls.add("closeInvestment:" + investmentId);
            return true;
        }

        @Override
        public Map<String, Object> debitLinkedAccount(String clientId, double amount, String transferId) {
            calls.add("debit:" + amount + "/" + transferId);
            maybeFail("debitLinkedAccount");
            return Map.of();
        }

        @Override
        public Map<String, Object> creditLinkedAccount(String clientId, double amount, String transferId) {
            calls.add("credit:" + amount + "/" + transferId);
            return Map.of();
        }

        @Override
        public String registerAccount(String clientId, String investmentId, double amount) {
            calls.add("register:" + investmentId);
            maybeFail("registerAccount");
            return "CUST-" + investmentId;
        }
    }
}
