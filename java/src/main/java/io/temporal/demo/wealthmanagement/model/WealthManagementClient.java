package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

// Matches WealthManagementClient in src/temporal_supervisor/shared.ts
@JsonIgnoreProperties(ignoreUnknown = true)
public record WealthManagementClient(
        @JsonProperty("client_id") String clientId,
        @JsonProperty("first_name") String firstName,
        @JsonProperty("last_name") String lastName,
        String address,
        String phone,
        String email,
        @JsonProperty("marital_status") String maritalStatus) {
}
