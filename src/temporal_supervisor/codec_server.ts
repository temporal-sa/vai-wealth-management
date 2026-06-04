import { createServer, IncomingMessage, ServerResponse } from 'http';
import { temporal } from '@temporalio/proto';
import { ClaimCheckCodec } from '../common/claim-check-codec';
import { createRedisClient } from '../common/redis-config';

const Payloads = temporal.api.common.v1.Payloads;

const HOST = process.env.CODEC_SERVER_HOST ?? '127.0.0.1';
const PORT = Number(process.env.CODEC_SERVER_PORT ?? 8081);
const TEMPORAL_UI_ORIGIN = process.env.TEMPORAL_UI_ORIGIN ?? 'http://localhost:8233';

const ALLOWED_ORIGINS = new Set([TEMPORAL_UI_ORIGIN, 'https://cloud.temporal.io']);

const codec = new ClaimCheckCodec(createRedisClient());

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-namespace, authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

async function apply(
  fn: (payloads: temporal.api.common.v1.IPayload[]) => Promise<temporal.api.common.v1.IPayload[]>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  const incoming = Payloads.fromObject(JSON.parse(body));
  const transformed = await fn(incoming.payloads ?? []);
  const out = Payloads.create({ payloads: transformed });
  setCorsHeaders(req, res);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(Payloads.toObject(out, { bytes: String })));
}

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
    if (req.method === 'OPTIONS') {
      setCorsHeaders(req, res);
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === 'POST' && pathname === '/encode') {
      await apply((p) => codec.encode(p), req, res);
      return;
    }
    if (req.method === 'POST' && pathname === '/decode') {
      await apply((p) => codec.decode(p), req, res);
      return;
    }
    setCorsHeaders(req, res);
    res.statusCode = 404;
    res.end('Not found');
  } catch (err) {
    console.error('Codec server error', err);
    setCorsHeaders(req, res);
    res.statusCode = 500;
    res.end((err as Error).message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codec server listening on http://${HOST}:${PORT}`);
});