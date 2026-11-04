package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

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

    /**
     * A copy with the given fields replaced, keyed by their JSON names. This is what the agent sends
     * with update_client_details; unknown fields are ignored.
     */
    public WealthManagementClient withUpdates(Map<String, ?> fields) {
        return new WealthManagementClient(
                value(fields, "client_id", clientId),
                value(fields, "first_name", firstName),
                value(fields, "last_name", lastName),
                value(fields, "address", address),
                value(fields, "phone", phone),
                value(fields, "email", email),
                value(fields, "marital_status", maritalStatus));
    }

    private static String value(Map<String, ?> fields, String name, String current) {
        return fields.containsKey(name) ? String.valueOf(fields.get(name)) : current;
    }
}
