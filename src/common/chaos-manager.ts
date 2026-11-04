import Redis from 'ioredis';
import { loadRedisConfig } from './redis-config';

export enum ChaosFlag {
  TOOL_DOWN = 'tool_down',
  LLM_DOWN = 'llm_down',
  LLM_RATE_LIMITED = 'llm_rate_limited',
  CUSTODIAN_REJECTS = 'custodian_rejects',
  SLOW_SAGA = 'slow_saga',
  WORKFLOW_BUG = 'workflow_bug',
}

export interface ChaosFlagInfo {
  flag: ChaosFlag;
  label: string;
  description: string;
}

export interface ChaosEvent {
  timestamp: number; // seconds since the epoch
  flag: ChaosFlag;
  source: string;
  attempt?: number;
  workflow_id?: string;
}

// Display metadata for the UI chaos panel, in the order it is shown.
export const CHAOS_FLAGS: ChaosFlagInfo[] = [
  {
    flag: ChaosFlag.TOOL_DOWN,
    label: 'Core banking API down',
    description:
      'Investment and beneficiary tools raise a connection error. Temporal retries until you turn this off.',
  },
  {
    flag: ChaosFlag.LLM_DOWN,
    label: 'Gemini API down',
    description:
      'Every model call raises a connection error. The agent pauses mid-turn and resumes when you turn this off.',
  },
  {
    flag: ChaosFlag.LLM_RATE_LIMITED,
    label: 'Gemini rate limited (429)',
    description:
      "Every model call is throttled. Retries wait for the server's Retry-After delay instead of the normal backoff.",
  },
  {
    flag: ChaosFlag.CUSTODIAN_REJECTS,
    label: 'Custodian rejects new accounts',
    description:
      'The last account-opening step fails non-retryably, so the saga rolls back the funds transfer and the account.',
  },
  {
    flag: ChaosFlag.SLOW_SAGA,
    label: 'Slow account-opening steps',
    description:
      'Each account-opening step takes a few extra seconds, so you can watch the saga (or kill the worker mid-way).',
  },
  {
    flag: ChaosFlag.WORKFLOW_BUG,
    label: 'Bug in workflow code',
    description:
      "New account openings get a welcome-bonus promo code, and the workflow's promo code path has a bug. " +
      'It pauses after compliance approval until you fix the code and restart the worker. ' +
      'Turning this off does not unstick openings that already have the promo code.',
  },
];

const FLAGS_KEY = 'chaos:flags';
const EVENTS_KEY = 'chaos:events';
const MAX_EVENTS = 50;

/**
 * Stores failure-injection flags, and a log of the failures they caused, in Redis.
 *
 * Flags are read at runtime by activities and the model wrapper, so a failure can
 * be switched on and off from the UI without restarting the worker.
 */
export class ChaosManager {
  private readonly redis: Redis;

  constructor() {
    // Give up quickly when Redis is down, so callers can fail open instead of hanging
    this.redis = new Redis({ ...loadRedisConfig(), maxRetriesPerRequest: 1 });
  }

  async isEnabled(flag: ChaosFlag): Promise<boolean> {
    return (await this.redis.hget(FLAGS_KEY, flag)) === '1';
  }

  async setEnabled(flag: ChaosFlag, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.redis.hset(FLAGS_KEY, flag, '1');
    } else {
      await this.redis.hdel(FLAGS_KEY, flag);
    }
  }

  async getFlags(): Promise<Array<ChaosFlagInfo & { enabled: boolean }>> {
    const enabled = await this.redis.hgetall(FLAGS_KEY);
    return CHAOS_FLAGS.map((info) => ({ ...info, enabled: enabled[info.flag] === '1' }));
  }

  async recordEvent(event: Omit<ChaosEvent, 'timestamp'>): Promise<void> {
    const entry: ChaosEvent = { timestamp: Date.now() / 1000, ...event };
    await this.redis.lpush(EVENTS_KEY, JSON.stringify(entry));
    await this.redis.ltrim(EVENTS_KEY, 0, MAX_EVENTS - 1);
  }

  async getEvents(limit = 20): Promise<ChaosEvent[]> {
    const raw = await this.redis.lrange(EVENTS_KEY, 0, limit - 1);
    return raw.map((e) => JSON.parse(e) as ChaosEvent);
  }

  // Turns every flag off and clears the failure log
  async reset(): Promise<void> {
    await this.redis.del(FLAGS_KEY, EVENTS_KEY);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

export function isChaosFlag(value: string): value is ChaosFlag {
  return (Object.values(ChaosFlag) as string[]).includes(value);
}
