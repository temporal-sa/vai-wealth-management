package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Payload of the supervisor's update_status signal (UpdateStatusInput in src/temporal_supervisor/shared.ts).
 * The Open Account workflow reports each state change with accountName, state and workflowId; the
 * supervisor turns that into the status text shown in the UI. Other senders can set status instead.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UpdateStatusInput(
        String status,
        @JsonProperty("account_name") String accountName,
        String state,
        @JsonProperty("workflow_id") String workflowId) {

    public static UpdateStatusInput accountState(String accountName, String state, String workflowId) {
        return new UpdateStatusInput(null, accountName, state, workflowId);
    }
}
