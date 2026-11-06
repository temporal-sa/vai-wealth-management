package io.temporal.demo.wealthmanagement.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Payload of the supervisor's update_account_opening_state signal (UpdateAccountOpeningStateInput in
 * src/temporal_supervisor/shared.ts). The Open Account workflow sends one on every state change; the
 * supervisor keeps the latest state per workflow ID and shows it in the UI.
 */
public record UpdateAccountOpeningStateInput(
        @JsonProperty("account_name") String accountName,
        String state,
        @JsonProperty("workflow_id") String workflowId) {
}
