import { EventStreamManager } from '../redis/event-stream-manager';
import { ChatInteraction, StatusUpdate } from '../shared';

export async function appendChatInteraction(
  workflowId: string,
  interaction: ChatInteraction,
): Promise<number> {
  const mgr = new EventStreamManager();
  try {
    return await mgr.appendChatInteraction(workflowId, interaction);
  } finally {
    await mgr.close();
  }
}

export async function appendStatusUpdate(
  workflowId: string,
  update: StatusUpdate,
): Promise<number> {
  const mgr = new EventStreamManager();
  try {
    return await mgr.appendStatusUpdate(workflowId, update);
  } finally {
    await mgr.close();
  }
}

export async function deleteConversation(workflowId: string): Promise<boolean> {
  const mgr = new EventStreamManager();
  try {
    return await mgr.deleteStream(workflowId);
  } finally {
    await mgr.close();
  }
}
