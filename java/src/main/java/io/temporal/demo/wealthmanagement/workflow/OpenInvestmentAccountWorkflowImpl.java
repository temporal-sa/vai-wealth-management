package io.temporal.demo.wealthmanagement.workflow;

import io.temporal.activity.ActivityOptions;
import io.temporal.common.RetryOptions;
import io.temporal.demo.wealthmanagement.common.ServerInfo;
import io.temporal.demo.wealthmanagement.model.InvestmentAccount;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountInput;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountOutput;
import io.temporal.demo.wealthmanagement.model.UpdateAccountOpeningStateInput;
import io.temporal.demo.wealthmanagement.model.WealthManagementClient;
import io.temporal.failure.ActivityFailure;
import io.temporal.failure.ApplicationFailure;
import io.temporal.workflow.ActivityStub;
import io.temporal.workflow.Saga;
import io.temporal.workflow.Workflow;
import org.slf4j.Logger;

import java.time.Duration;
import java.util.Locale;
import java.util.Map;

public class OpenInvestmentAccountWorkflowImpl implements OpenInvestmentAccountWorkflow {
    private static final Logger log = Workflow.getLogger(OpenInvestmentAccountWorkflowImpl.class);

    // Welcome-bonus promotion: a percentage of the initial deposit, up to MAX_BONUS.
    // *** Bug-In-Workflow-Code ***
    // Intentional bug for the "Bug in workflow code" demo: the promo code is "WELCOME-BONUS" (hyphen),
    // but BONUS_RATES is keyed by "WELCOME_BONUS" (underscore), so the lookup in welcomeBonus returns
    // null and unboxing it throws a NullPointerException.
    // To fix it, uncomment the first line below and comment out the second. See README "Failure scenarios".
    // private static final Map<String, Double> BONUS_RATES = Map.of("WELCOME-BONUS", 0.01);
    private static final Map<String, Double> BONUS_RATES = Map.of("WELCOME_BONUS", 0.01);
    private static final double MAX_BONUS = 500.0;

    // Matches TOOL_RETRY_POLICY in retry-policies.ts: retry until the dependency recovers,
    // with a short maximum interval so recovery shows up within seconds.
    private static final RetryOptions RETRY_OPTIONS = RetryOptions.newBuilder()
            .setInitialInterval(Duration.ofSeconds(1))
            .setBackoffCoefficient(2)
            .setMaximumInterval(Duration.ofSeconds(5))
            .build();

    // The activities are implemented in TypeScript, so they are called by name on the TypeScript task queue.
    // The start-to-close timeout bounds a single attempt only, so an outage is retried for as long as it lasts.
    private final ActivityStub activities = Workflow.newUntypedActivityStub(
            ActivityOptions.newBuilder()
                    .setTaskQueue(ServerInfo.getTaskqueue())
                    .setStartToCloseTimeout(Duration.ofSeconds(30))
                    .setRetryOptions(RETRY_OPTIONS)
                    .build());

    private OpenInvestmentAccountInput input;
    private String state = "Initializing";
    private boolean initialized = false;
    private boolean kycApproved = false;
    private boolean complianceApproved = false;
    private WealthManagementClient clientDetails;

    @Override
    public OpenInvestmentAccountOutput run(OpenInvestmentAccountInput input) {
        this.input = input;
        String accountName = input.accountName();

        // Step 1: Load client details
        log.info("OpenInvestmentAccountWorkflow started: {}", input);
        clientDetails = activities.execute("getClient", WealthManagementClient.class, input.clientId());
        initialized = true;
        setState("Waiting KYC");

        // Step 2: Wait for KYC approval
        Workflow.await(() -> kycApproved);
        setState("Waiting Compliance Review");

        // Step 3: Wait for compliance approval
        Workflow.await(() -> complianceApproved);
        setState("Compliance review has been approved. Creating Investment Account");

        // Step 4: Create, fund and register the investment account
        return openAccount();
    }

    /**
     * Saga: create, fund, and register the account.
     *
     * Each completed step registers how to undo it. If a later step fails with a non-retryable
     * error, the compensations run in reverse order. Transient failures never get here:
     * activities retry until they succeed.
     */
    private OpenInvestmentAccountOutput openAccount() {
        String clientId = input.clientId();
        String accountName = input.accountName();
        double amount = input.initialAmount();
        double bonus = input.promoCode() != null ? welcomeBonus(input.promoCode(), amount) : 0.0;
        // Idempotency key: stable across activity retries and worker restarts. It includes the run ID
        // because the workflow ID is reused when the customer opens an account with the same name again
        // in the same chat (e.g. after a rollback), and a reused key would return the earlier transfer
        // without moving any money.
        String transferId = Workflow.getInfo().getWorkflowId() + "-" + Workflow.getInfo().getRunId()
                + "-initial-deposit";

        Saga saga = new Saga(new Saga.Options.Builder().setParallelCompensation(false).build());
        try {
            setState("Creating the account record.");
            InvestmentAccount account = activities.execute("openInvestment", InvestmentAccount.class,
                    clientId, accountName, amount + bonus);
            saga.addCompensation(() -> compensate("removing the account record",
                    "removeInvestment", clientId, account.investmentId()));

            setState(String.format("Transferring %s from the linked bank account.", formatUsd(amount)));
            activities.execute("debitLinkedAccount", Map.class, clientId, amount, transferId);
            saga.addCompensation(() -> compensate(
                    String.format("refunding %s to the linked bank account", formatUsd(amount)),
                    "creditLinkedAccount", clientId, amount, transferId + "-refund"));

            setState("Registering the account with the custodian.");
            activities.execute("registerAccount", String.class, clientId, account.investmentId(), amount);
        } catch (ActivityFailure e) {
            String reason = reason(e);
            setState("Failed: " + reason + ". Rolling back.");
            saga.compensate();
            setState("Rolled back. The account was not opened: " + reason + ".");
            return new OpenInvestmentAccountOutput(false, "The account was not opened: " + reason);
        }

        log.info("Investment account {} opened successfully", accountName);
        setState("Complete");
        return new OpenInvestmentAccountOutput(true, "investment account created");
    }

    private static double welcomeBonus(String promoCode, double initialAmount) {
        double rate = BONUS_RATES.get(promoCode);
        return Math.min(initialAmount * rate, MAX_BONUS);
    }

    private void compensate(String description, String activityName, Object... args) {
        setState("Rolling back: " + description + ".");
        // Compensations are activities too, so they are retried until they succeed
        activities.execute(activityName, Object.class, args);
    }

    // The business reason for a non-retryable activity failure, such as the custodian rejecting the account
    private static String reason(ActivityFailure e) {
        Throwable cause = e.getCause();
        if (cause instanceof ApplicationFailure applicationFailure) {
            return applicationFailure.getOriginalMessage();
        }
        return cause != null ? cause.getMessage() : e.getMessage();
    }

    // Same format as formatUsd in open-account.ts, e.g. $1,000.00
    private static String formatUsd(double amount) {
        return String.format(Locale.US, "$%,.2f", amount);
    }

    @Override
    public String getCurrentState() {
        return state;
    }

    @Override
    public WealthManagementClient getClientDetails() {
        Workflow.await(() -> initialized);
        return clientDetails;
    }

    // The customer corrected their details during KYC: save them, which also approves KYC
    @Override
    public WealthManagementClient updateClientDetails(Map<String, Object> fields) {
        WealthManagementClient result = activities.execute("updateClient", WealthManagementClient.class,
                input.clientId(), fields);
        if (result != null) {
            clientDetails = result;
        }
        kycApproved = true;
        return result;
    }

    // Each signal waits for the steps before it, so an early signal takes effect only once the workflow
    // gets there: KYC once the client details are loaded, compliance once KYC is approved.
    @Override
    public void verifyKyc() {
        Workflow.await(() -> initialized);
        log.info("KYC has been verified");
        kycApproved = true;
    }

    @Override
    public void complianceApproved() {
        Workflow.await(() -> initialized && kycApproved);
        log.info("Compliance has been approved");
        complianceApproved = true;
    }

    // Every state change is visible to the get_current_state query and reported to the parent, which
    // keeps it for the agent's get_account_opening_status tool and shows it in the UI's status area. Signals are routed by workflow ID, not task queue, so this reaches the
    // TypeScript supervisor even though it runs on a different task queue. Without a parent (the workflow
    // was started on its own, e.g. by run_open_account_workflow.ts) there is no one to report to.
    private void setState(String newState) {
        state = newState;
        log.info("State: {} for {}", newState, input.accountName());
        String parentWorkflowId = input.parentWorkflowId();
        if (parentWorkflowId == null || parentWorkflowId.isEmpty()) {
            return;
        }
        Workflow.newUntypedExternalWorkflowStub(parentWorkflowId)
                .signal("update_account_opening_state", new UpdateAccountOpeningStateInput(
                        input.accountName(), newState, Workflow.getInfo().getWorkflowId()));
    }
}
