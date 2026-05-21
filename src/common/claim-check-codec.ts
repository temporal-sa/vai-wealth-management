import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import type { PayloadCodec } from '@temporalio/common';
import { temporal } from '@temporalio/proto';

type IPayload = temporal.api.common.v1.IPayload;
const Payload = temporal.api.common.v1.Payload;

const ENCODING_METADATA_KEY = 'temporal.io/claim-check-codec';
const ENCODING_METADATA_VALUE = Buffer.from('v1');
const CLAIM_CHECK_ENCODING = Buffer.from('binary/claim-check');

export class ClaimCheckCodec implements PayloadCodec {
  constructor(private readonly redis: Redis) {}

  async encode(payloads: IPayload[]): Promise<IPayload[]> {
    return Promise.all(payloads.map((p) => this.encodePayload(p)));
  }

  async decode(payloads: IPayload[]): Promise<IPayload[]> {
    return Promise.all(payloads.map((p) => this.decodePayload(p)));
  }

  private async encodePayload(payload: IPayload): Promise<IPayload> {
    const claimKey = randomUUID();
    const serialized = Buffer.from(Payload.encode(payload).finish());
    await this.redis.set(claimKey, serialized);
    return {
      metadata: {
        encoding: CLAIM_CHECK_ENCODING,
        [ENCODING_METADATA_KEY]: ENCODING_METADATA_VALUE,
      },
      data: Buffer.from(claimKey),
    };
  }

  private async decodePayload(payload: IPayload): Promise<IPayload> {
    const marker = payload.metadata?.[ENCODING_METADATA_KEY];
    if (!marker || !Buffer.from(marker).equals(ENCODING_METADATA_VALUE)) {
      return payload;
    }
    const claimKey = Buffer.from(payload.data ?? new Uint8Array()).toString();
    const raw = await this.redis.getBuffer(claimKey);
    if (!raw) {
      throw new Error(`Claim check payload not found in Redis for key ${claimKey}`);
    }
    return Payload.decode(raw);
  }
}