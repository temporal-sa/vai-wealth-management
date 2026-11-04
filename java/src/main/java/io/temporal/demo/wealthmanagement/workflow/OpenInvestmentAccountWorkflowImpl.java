package io.temporal.demo.wealthmanagement.workflow;

import io.temporal.activity.ActivityOptions;
import io.temporal.demo.wealthmanagement.common.ServerInfo;
import io.temporal.demo.wealthmanagement.model.InvestmentAccount;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountInput;
import io.temporal.demo.wealthmanagement.model.UpdateStatusInput;
import io.temporal.demo.wealthmanagement.model.WealthManagementClient;
import io.temporal.workflow.ActivityStub;
import io.temporal.workflow.Workflow;
import org.slf4j.Logger;

import java.time.Duration;
import java.util.Map;

public class OpenInvestmentAccountWorkflowImpl implements OpenInvestmentAccountWorkflow {
    private static final Logger log = Workflow.getLogger(OpenInvestmentAccountWorkflowImpl.class);

    // The activities are implemented in TypeScript, so they are called by name on the TypeScript task queue
    private final ActivityStub activities = Workflow.newUntypedActivityStub(
            ActivityOptions.newBuilder()
                    .setTaskQueue(ServerInfo.getTaskqueue())
                    .setStartToCloseTimeout(Duration.ofSeconds(30))
                    .build());

    private OpenInvestmentAccountInput input;
    private String state = "Initializing";
    private boolean kycApproved = false;
    private boolean complianceApproved = false;
    private WealthManagementClient clientDetails;

    @Override
    public void run(OpenInvestmentAccountInput input) {
        this.input = input;
        String accountName = input.accountName();

        // Step 1: Load client details
        log.info("OpenInvestmentAccountWorkflow started: {}", input);
        clientDetails = activities.execute("getClient", WealthManagementClient.class, input.clientId());
        state = "Waiting KYC";
        log.info("State: Waiting KYC for {}", accountName);
        signalParent(String.format("Account \"%s\" is waiting for KYC verification.", accountName));

        // Step 2: Wait for KYC approval
        Workflow.await(() -> kycApproved);
        state = "Waiting Compliance Review";
        log.info("State: Waiting Compliance Review for {}", accountName);
        signalParent(String.format("KYC approved. Account \"%s\" is waiting for compliance review.", accountName));

        // Step 3: Wait for compliance approval
        Workflow.await(() -> complianceApproved);
        state = "Complete";
        log.info("State: Complete for {}", accountName);

        // Step 4: Create the investment account
        activities.execute("openInvestment", InvestmentAccount.class,
                input.clientId(), accountName, input.initialAmount());
        log.info("Investment account {} opened successfully", accountName);
        signalParent(String.format("Account \"%s\" has been successfully opened.", accountName));
    }

    @Override
    public String getCurrentState() {
        return state;
    }

    @Override
    public WealthManagementClient getClientDetails() {
        return clientDetails;
    }

    // Allows the agent to update client details during KYC
    @Override
    public void updateClientDetails(Map<String, Object> fields) {
        if (clientDetails != null) {
            clientDetails = clientDetails.withUpdates(fields);
        }
    }

    @Override
    public void verifyKyc() {
        kycApproved = true;
    }

    @Override
    public void complianceApproved() {
        complianceApproved = true;
    }

    // Signals are routed by workflow ID, not task queue, so this reaches the TypeScript supervisor
    // even though it runs on a different task queue.
    private void signalParent(String status) {
        Workflow.newUntypedExternalWorkflowStub(input.parentWorkflowId())
                .signal("update_status", new UpdateStatusInput(status));
    }
}
