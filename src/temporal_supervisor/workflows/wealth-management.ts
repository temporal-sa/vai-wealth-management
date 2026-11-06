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
  UpdateAccountOpeningStateInput,
  StatusUpdate,
} from '../shared';
import {
  PROCESS_USER_MESSAGE_SIGNAL,
  END_WORKFLOW_SIGNAL,
  UPDATE_ACCOUNT_OPENING_STATE_SIGNAL,
  accountStatusText,
} from '../shared';
import type * as eventStreamActivities from '../activities/event-stream';
import type * as openAccountActivities from '../activities/open-account';
import type { ModelMessage } from 'ai';
import { runAgentTurn, AgentName } from './agent-loop';

const { appendChatInteraction, appendStatusUpdate, deleteConversation } =
  proxyActivities<typeof eventStreamActivities>({
    startToCloseTimeout: '30s',
  });
const { getLlmTaskQueue } = proxyActivities<typeof openAccountActivities>({
  startToCloseTimeout: '30s',
});

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const processUserMessageSignal = defineSignal<[ProcessUserMessageInput]>(PROCESS_USER_MESSAGE_SIGNAL);
const endWorkflowSignal = defineSignal(END_WORKFLOW_SIGNAL);
const updateAccountOpeningStateSignal = defineSignal<[UpdateAccountOpeningStateInput]>(
  UPDATE_ACCOUNT_OPENING_STATE_SIGNAL,
);

// ---------------------------------------------------------------------------
// Workflow — agent loop now runs in workflow context via @temporalio/ai-sdk
// ---------------------------------------------------------------------------

export async function WealthManagementWorkflow(): Promise<void> {
  const { workflowId } = workflowInfo();

  const pendingMessages: ProcessUserMessageInput[] = [];
  // Status text waiting to be written to the UI's status area
  const pendingStatuses: string[] = [];
  let done = false;
  let messages: ModelMessage[] = [];
  let clientId: string | undefined;
  let childWorkflowId: string | undefined;
  let activeAgent: AgentName | undefined;
  // Number of customer messages processed so far, and the message in which each account
  // opening's client details were shown (for the approve_kyc check)
  let turn = 0;
  let kycDetailsShownTurn: Record<string, number> = {};
  // Latest state of each account opening started in this conversation, keyed by its workflow ID
  const accountOpeningStates: Record<string, string> = {};
  // Number of account openings started in this conversation: each one gets the next number in its
  // workflow ID, so every request to open an account starts a new opening, even for the same name
  let accountOpeningsStarted = 0;
  let llmTaskQueue: string | undefined;

  setHandler(processUserMessageSignal, (msg: ProcessUserMessageInput) => {
    log.info('Signal received: process_user_message', { userInput: msg.user_input });
    pendingMessages.push(msg);
  });

  setHandler(endWorkflowSignal, () => {
    log.info('Signal received: end_workflow');
    done = true;
  });

  setHandler(updateAccountOpeningStateSignal, (update: UpdateAccountOpeningStateInput) => {
    log.info('Account opening state changed', { accountName: update.account_name, state: update.state });
    if (update.workflow_id) {
      accountOpeningStates[update.workflow_id] = update.state;
    }
    pendingStatuses.push(accountStatusText(update.account_name, update.state));
  });

  log.info('WealthManagementWorkflow started', { workflowId });

  // The demo reuses chat workflow IDs (e.g. a chat started again after its workflow was terminated,
  // which skips the delete at the end), so clear any conversation left in Redis under this ID first.
  await deleteConversation(workflowId);

  while (!done) {
    await condition(() => pendingMessages.length > 0 || pendingStatuses.length > 0 || done);

    while (pendingStatuses.length > 0) {
      const statusUpdate: StatusUpdate = { status: pendingStatuses.shift()! };
      log.info('Processing status update', { status: statusUpdate.status });
      await appendStatusUpdate(workflowId, statusUpdate);
    }

    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift()!;
      log.info('Processing user message', { userInput: msg.user_input });

      // The model calls' task queue can be overridden on the worker (TEMPORAL_TASK_QUEUE_LLM)
      llmTaskQueue ??= await getLlmTaskQueue();
      turn += 1;
      const result = await runAgentTurn({
        workflowId,
        userInput: msg.user_input,
        messages,
        clientId,
        childWorkflowId,
        activeAgent,
        turn,
        kycDetailsShownTurn,
        llmTaskQueue,
        accountOpeningStates,
        accountOpeningsStarted,
      });

      messages = result.messages;
      clientId = result.clientId;
      childWorkflowId = result.childWorkflowId;
      activeAgent = result.activeAgent;
      kycDetailsShownTurn = result.kycDetailsShownTurn;
      accountOpeningsStarted = result.accountOpeningsStarted;
      log.info('Agent turn complete', { clientId: result.clientId, agentTrace: result.interaction.agent_trace });

      await appendChatInteraction(workflowId, result.interaction);
    }

    // TODO: Continue-As-New.
    // This demo keeps the whole conversation in one workflow run. A production system
    // would call continueAsNew when workflowInfo().continueAsNewSuggested is true,
    // because Temporal limits a run's event history (warnings at 10K events / 10 MB,
    // terminated at 50K events / 50 MB) and every LLM call and tool call adds events,
    // so a long-running chat would eventually hit those limits.
    // To do it safely:
    //   - Wait for allHandlersFinished() and drain the pending message and
    //     status queues first, so no customer message or status update is lost.
    //   - Carry the conversation state into the new run: the message history, the
    //     active agent, the client ID, the account-opening states, the number of
    //     account openings started, and the KYC guard's turn tracking.
    //   - Open-account child workflows are started with ParentClosePolicy.TERMINATE,
    //     which also applies when the parent continues-as-new, so an opening waiting
    //     for KYC or compliance would be terminated. Use ParentClosePolicy.ABANDON and
    //     have the end_workflow handler cancel/terminate any openings still running,
    //     or defer continue-as-new until no opening is in progress.
  }

  log.info('WealthManagementWorkflow ending', { workflowId });
  await deleteConversation(workflowId);
}
