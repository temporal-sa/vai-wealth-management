"""
Minimal Python stub of WealthManagementWorkflow.

The actual workflow logic runs in the TypeScript Temporal worker.
This stub exists only so the Python API can reference signal/run definitions
by their Temporal-registered names.
"""
from temporalio import workflow

from common.user_message import ProcessUserMessageInput


@workflow.defn
class WealthManagementWorkflow:
    @workflow.run
    async def run(self) -> None:
        pass

    @workflow.signal
    async def process_user_message(self, message_input: ProcessUserMessageInput) -> None:
        pass

    @workflow.signal
    async def end_workflow(self) -> None:
        pass

    @workflow.signal
    async def update_status(self, status: str) -> None:
        pass
