import Redis from 'ioredis';
import { ChatInteraction, StatusUpdate } from '../shared';

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? '6379', 10);

export type EventType = 'chat_interaction' | 'status_update';

export interface ChatInteractionEvent {
  type: 'chat_interaction';
  content: ChatInteraction;
}

export interface StatusUpdateEvent {
  type: 'status_update';
  content: StatusUpdate;
}

export type StreamEvent = ChatInteractionEvent | StatusUpdateEvent;

/**
 * TypeScript port of Python's EventStreamManager.
 * Same Redis key format and JSON event structure so the Python API can read it.
 *
 * Key: events:{workflowId}   (Redis list, RPUSH / LRANGE)
 */
export class EventStreamManager {
  private client: Redis;

  constructor(host = REDIS_HOST, port = REDIS_PORT) {
    this.client = new Redis({ host, port, lazyConnect: true });
  }

  private streamKey(workflowId: string): string {
    return `events:${workflowId}`;
  }

  async appendChatInteraction(workflowId: string, interaction: ChatInteraction): Promise<number> {
    const event: ChatInteractionEvent = { type: 'chat_interaction', content: interaction };
    return this.client.rpush(this.streamKey(workflowId), JSON.stringify(event));
  }

  async appendStatusUpdate(workflowId: string, update: StatusUpdate): Promise<number> {
    const event: StatusUpdateEvent = { type: 'status_update', content: update };
    return this.client.rpush(this.streamKey(workflowId), JSON.stringify(event));
  }

  async getEventsFromIndex(workflowId: string, fromIndex = 0): Promise<StreamEvent[]> {
    const raw = await this.client.lrange(this.streamKey(workflowId), fromIndex, -1);
    const events: StreamEvent[] = [];
    for (const item of raw) {
      try {
        events.push(JSON.parse(item) as StreamEvent);
      } catch {
        // skip malformed
      }
    }
    return events;
  }

  async deleteStream(workflowId: string): Promise<boolean> {
    const deleted = await this.client.del(this.streamKey(workflowId));
    return deleted > 0;
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
