package io.temporal.demo.wealthmanagement.model;

// Payload of the supervisor's update_status signal (UpdateStatusInput in src/temporal_supervisor/shared.ts)
public record UpdateStatusInput(String status) {
}
