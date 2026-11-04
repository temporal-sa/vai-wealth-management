package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonProperty;

// Matches OpenInvestmentAccountOutput in src/temporal_supervisor/shared.ts
public record OpenInvestmentAccountOutput(
        @JsonProperty("account_created") boolean accountCreated,
        String message) {
}
