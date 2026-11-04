package io.temporal.demo.wealthmanagement.workflow;

import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountInput;
import io.temporal.demo.wealthmanagement.model.OpenInvestmentAccountOutput;
import io.temporal.demo.wealthmanagement.model.WealthManagementClient;
import io.temporal.workflow.QueryMethod;
import io.temporal.workflow.SignalMethod;
import io.temporal.workflow.UpdateMethod;
import io.temporal.workflow.WorkflowInterface;
import io.temporal.workflow.WorkflowMethod;

import java.util.Map;

/**
 * Java version of src/temporal_supervisor/workflows/open-account.ts.
 * The workflow type and the handler names match the TypeScript version, so the TypeScript
 * supervisor and activities can start and drive either implementation.
 */
@WorkflowInterface
public interface OpenInvestmentAccountWorkflow {
    @WorkflowMethod(name = "OpenInvestmentAccountWorkflow")
    OpenInvestmentAccountOutput run(OpenInvestmentAccountInput input);

    @QueryMethod(name = "get_current_state")
    String getCurrentState();

    @QueryMethod(name = "get_client_details")
    WealthManagementClient getClientDetails();

    @UpdateMethod(name = "update_client_details")
    void updateClientDetails(Map<String, Object> fields);

    @SignalMethod(name = "verify_kyc")
    void verifyKyc();

    @SignalMethod(name = "compliance_approved")
    void complianceApproved();
}
