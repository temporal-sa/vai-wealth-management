package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonProperty;

// Result of the openInvestment activity (InvestmentAccount in src/common/investment-manager.ts)
public record InvestmentAccount(
        @JsonProperty("investment_id") String investmentId,
        String name,
        double balance) {
}
