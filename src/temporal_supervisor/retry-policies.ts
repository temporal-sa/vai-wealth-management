import type { RetryPolicy } from '@temporalio/common';

// Outage demos only work if retries outlast the outage and recovery shows up within
// seconds: no attempt limit, and a short maximum interval (the default is 100 seconds).
// Pair these with startToCloseTimeout (one attempt), never scheduleToCloseTimeout
// (all attempts), or an outage times out instead of being waited out.
export const TOOL_RETRY_POLICY: RetryPolicy = {
  initialInterval: '1s',
  backoffCoefficient: 2,
  maximumInterval: '5s',
};

export const LLM_RETRY_POLICY: RetryPolicy = {
  initialInterval: '1s',
  backoffCoefficient: 2,
  maximumInterval: '10s',
};
