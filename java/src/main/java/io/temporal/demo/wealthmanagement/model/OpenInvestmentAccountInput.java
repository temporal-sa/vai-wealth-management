package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonProperty;

// Matches OpenInvestmentAccountInput in src/temporal_supervisor/shared.ts
public record OpenInvestmentAccountInput(
        @JsonProperty("client_id") String clientId,
        @JsonProperty("account_name") String accountName,
        @JsonProperty("initial_amount") double initialAmount,
        // The supervisor workflow that receives the status updates; empty when the workflow is started on its own
        @JsonProperty("parent_workflow_id") String parentWorkflowId,
        // Set when a promotion is running for the new account (e.g. "WELCOME-BONUS")
        @JsonProperty("promo_code") String promoCode) {
}
