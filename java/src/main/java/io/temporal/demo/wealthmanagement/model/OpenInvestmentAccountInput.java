package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonProperty;

// Matches OpenInvestmentAccountInput in src/temporal_supervisor/shared.ts
public record OpenInvestmentAccountInput(
        @JsonProperty("client_id") String clientId,
        @JsonProperty("account_name") String accountName,
        @JsonProperty("initial_amount") double initialAmount,
        @JsonProperty("parent_workflow_id") String parentWorkflowId) {
}
