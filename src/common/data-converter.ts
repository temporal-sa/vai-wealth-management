import type { DataConverter } from '@temporalio/common';
import { ClaimCheckCodec } from './claim-check-codec';
import { createRedisClient } from './redis-config';

/**
 * Whether USE_CLAIM_CHECK turns the claim check on. Accepts the same values as the Python
 * versions' str_to_bool, ignoring case: true, t, yes, y or 1.
 */
export function useClaimCheck(value = process.env.USE_CLAIM_CHECK): boolean {
  return ['true', 't', 'yes', 'y', '1'].includes((value ?? '').trim().toLowerCase());
}

export function buildDataConverter(): DataConverter {
  if (!useClaimCheck()) return {};
  return { payloadCodecs: [new ClaimCheckCodec(createRedisClient())] };
}