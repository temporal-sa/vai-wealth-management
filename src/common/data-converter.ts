import type { DataConverter } from '@temporalio/common';
import { ClaimCheckCodec } from './claim-check-codec';
import { createRedisClient } from './redis-config';

export function buildDataConverter(): DataConverter {
  if (process.env.USE_CLAIM_CHECK !== 'true') return {};
  return { payloadCodecs: [new ClaimCheckCodec(createRedisClient())] };
}