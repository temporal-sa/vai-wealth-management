package io.temporal.demo.wealthmanagement.workflow;

import io.temporal.activity.ActivityOptions;
import io.temporal.common.RetryOptions;
import io.temporal.demo.wealthmanagement.common.ServerInfo;
import io.temporal.demo.wealthmanagement.model.InvestmentAccount;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountInput;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountOutput;
import io.temporal.demo.wealthmanagement.model.UpdateStatusInput;
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
        // Idempotency key: stable across activity retries and worker restarts
        String transferId = Workflow.getInfo().getWorkflowId() + "-initial-deposit";

        Saga saga = new Saga(new Saga.Options.Builder().setParallelCompensation(false).build());
        try {
            setStepState("Creating the account record.");
            InvestmentAccount account = activities.execute("openInvestment", InvestmentAccount.class,
                    clientId, accountName, amount + bonus);
            saga.addCompensation(() -> compensate("removing the account record",
                    "closeInvestment", clientId, account.investmentId()));

            setStepState(String.format("Transferring %s from the linked bank account.", formatUsd(amount)));
            activities.execute("debitLinkedAccount", Map.class, clientId, amount, transferId);
            saga.addCompensation(() -> compensate(
                    String.format("refunding %s to the linked bank account", formatUsd(amount)),
                    "creditLinkedAccount", clientId, amount, transferId + "-refund"));

            setStepState("Registering the account with the custodian.");
            activities.execute("registerAccount", String.class, clientId, account.investmentId(), amount);
        } catch (ActivityFailure e) {
            String reason = reason(e);
            setStepState("Failed: " + reason + ". Rolling back.");
            saga.compensate();
            state = "Rolled back. The account was not opened: " + reason + ".";
            log.info("State: {} for {}", state, accountName);
            signalParent(String.format("Account \"%s\" was not opened: %s. All changes were rolled back.",
                    accountName, reason));
            return new OpenInvestmentAccountOutput(false, "The account was not opened: " + reason);
        }

        state = "Complete";
        log.info("Investment account {} opened successfully", accountName);
        signalParent(String.format("Account \"%s\" has been successfully opened.", accountName));
        return new OpenInvestmentAccountOutput(true, "investment account created");
    }

    private static double welcomeBonus(String promoCode, double initialAmount) {
        double rate = BONUS_RATES.get(promoCode);
        return Math.min(initialAmount * rate, MAX_BONUS);
    }

    private void compensate(String description, String activityName, Object... args) {
        setStepState("Rolling back: " + description + ".");
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

    // A saga step: visible to get_account_status and in the UI's status area
    private void setStepState(String step) {
        state = step;
        log.info("State: {} for {}", step, input.accountName());
        signalParent(String.format("Opening account \"%s\": %s", input.accountName(), step));
    }

    // Signals are routed by workflow ID, not task queue, so this reaches the TypeScript supervisor
    // even though it runs on a different task queue.
    private void signalParent(String status) {
        Workflow.newUntypedExternalWorkflowStub(input.parentWorkflowId())
                .signal("update_status", new UpdateStatusInput(status));
    }
}
