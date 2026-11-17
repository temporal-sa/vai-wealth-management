import { EventStreamManager } from '../redis/event-stream-manager';
import { ChatInteraction, StatusUpdate } from '../shared';

export async function append_chat_interaction(workflowId: string, interaction: ChatInteraction): Promise<number> {
  const mgr = new EventStreamManager();
  try {
    return await mgr.appendChatInteraction(workflowId, interaction);
  } finally {
    await mgr.close();
  }
}

export async function append_status_update(workflowId: string, update: StatusUpdate): Promise<number> {
  const mgr = new EventStreamManager();
  try {
    return await mgr.appendStatusUpdate(workflowId, update);
  } finally {
    await mgr.close();
  }
}

export async function delete_conversation(workflowId: string): Promise<boolean> {
  const mgr = new EventStreamManager();
  try {
    return await mgr.deleteStream(workflowId);
  } finally {
    await mgr.close();
  }
}
