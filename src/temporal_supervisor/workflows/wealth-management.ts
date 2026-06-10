import {
  defineSignal,
  setHandler,
  condition,
  proxyActivities,
  workflowInfo,
  log,
} from '@temporalio/workflow';
import type {
  ProcessUserMessageInput,
  UpdateStatusInput,
  StatusUpdate,
} from '../shared';
import {
  PROCESS_USER_MESSAGE_SIGNAL,
  END_WORKFLOW_SIGNAL,
  UPDATE_STATUS_SIGNAL,
} from '../shared';
import type * as eventStreamActivities from '../activities/event-stream';
import type { ModelMessage } from 'ai';
import { runAgentTurn, AgentName } from './agent-loop';

const { appendChatInteraction, appendStatusUpdate, deleteConversation } =
  proxyActivities<typeof eventStreamActivities>({
    startToCloseTimeout: '30s',
  });

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const processUserMessageSignal = defineSignal<[ProcessUserMessageInput]>(PROCESS_USER_MESSAGE_SIGNAL);
const endWorkflowSignal = defineSignal(END_WORKFLOW_SIGNAL);
const updateStatusSignal = defineSignal<[UpdateStatusInput]>(UPDATE_STATUS_SIGNAL);

// ---------------------------------------------------------------------------
// Workflow — agent loop now runs in workflow context via @temporalio/ai-sdk
// ---------------------------------------------------------------------------

export async function WealthManagementWorkflow(): Promise<void> {
  const { workflowId } = workflowInfo();

  const pendingMessages: ProcessUserMessageInput[] = [];
  const pendingStatuses: UpdateStatusInput[] = [];
  let done = false;
  let messages: ModelMessage[] = [];
  let clientId: string | undefined;
  let childWorkflowId: string | undefined;
  let activeAgent: AgentName | undefined;

  setHandler(processUserMessageSignal, (input: ProcessUserMessageInput) => {
    log.info('Signal received: process_user_message', { userInput: input.user_input });
    pendingMessages.push(input);
  });

  setHandler(endWorkflowSignal, () => {
    log.info('Signal received: end_workflow');
    done = true;
  });

  setHandler(updateStatusSignal, (input: UpdateStatusInput) => {
    log.info('Signal received: update_status', { status: input.status });
    pendingStatuses.push(input);
  });

  log.info('WealthManagementWorkflow started', { workflowId });

  while (!done) {
    await condition(() => pendingMessages.length > 0 || pendingStatuses.length > 0 || done);

    while (pendingStatuses.length > 0) {
      const update = pendingStatuses.shift()!;
      log.info('Processing status update', { status: update.status });
      const statusUpdate: StatusUpdate = { status: update.status };
      await appendStatusUpdate(workflowId, statusUpdate);
    }

    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift()!;
      log.info('Processing user message', { userInput: msg.user_input });

      const result = await runAgentTurn({
        workflowId,
        userInput: msg.user_input,
        messages,
        clientId,
        childWorkflowId,
        activeAgent,
      });

      messages = result.messages;
      clientId = result.clientId;
      childWorkflowId = result.childWorkflowId;
      activeAgent = result.activeAgent;
      log.info('Agent turn complete', { clientId: result.clientId, agentTrace: result.interaction.agent_trace });

      await appendChatInteraction(workflowId, result.interaction);
    }
  }

  log.info('WealthManagementWorkflow ending', { workflowId });
  await deleteConversation(workflowId);
}