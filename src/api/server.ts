import express, { Request, Response } from 'express';
import cors from 'cors';
import { WorkflowIdReusePolicy } from '@temporalio/common';
import { ClientHelper } from '../common/client-helper';
import { EventStreamManager } from '../temporal_supervisor/redis/event-stream-manager';
import { ChaosManager, isChaosFlag } from '../common/chaos-manager';
import {
  ProcessUserMessageInput,
  PROCESS_USER_MESSAGE_SIGNAL,
  END_WORKFLOW_SIGNAL,
} from '../temporal_supervisor/shared';

const HOST = process.env.API_HOST ?? '127.0.0.1';
const PORT = Number(process.env.API_PORT ?? 8000);

function logClaimCheckStatus(): void {
  if (process.env.USE_CLAIM_CHECK === 'true') {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = process.env.REDIS_PORT ?? '6379';
    console.log(`Claim check enabled (redis at ${host}:${port})`);
  } else {
    console.log('Claim check disabled');
  }
}

async function run(): Promise<void> {
  console.log('API is starting up...');
  logClaimCheckStatus();

  const helper = new ClientHelper();
  const { client } = await helper.connectClient();
  const taskQueue = helper.taskQueue;
  const events = new EventStreamManager();
  const chaos = new ChaosManager();

  const app = express();

  app.use(
    cors({
      origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      credentials: true,
    }),
  );

  app.get('/', (_req: Request, res: Response) => {
    res.json({ message: 'Vercel AI + Temporal Agent!' });
  });

  app.get('/get-chat-history', async (req: Request, res: Response) => {
    const workflowId = String(req.query.workflow_id ?? '');
    const fromIndex = Number(req.query.from_index ?? 0);
    if (!workflowId) {
      res.status(400).json({ detail: 'workflow_id is required' });
      return;
    }
    try {
      const history = await events.getEventsFromIndex(workflowId, fromIndex);
      res.json(history);
    } catch (err) {
      const message = (err as Error).message;
      console.error('Redis error retrieving chat history:', message);
      res.status(500).json({ detail: `Internal server error while querying workflow. ${message}` });
    }
  });

  app.post('/send-prompt', async (req: Request, res: Response) => {
    const workflowId = String(req.query.workflow_id ?? '');
    const prompt = String(req.query.prompt ?? '');
    console.log(`Received prompt ${prompt}`);

    const message: ProcessUserMessageInput = { user_input: prompt };

    try {
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal(PROCESS_USER_MESSAGE_SIGNAL, message);
      console.log(`Sent message ${JSON.stringify(message)}`);
      res.json({ response: 'Message sent' });
    } catch (err) {
      res.json({ response: `Error: ${(err as Error).message}` });
    }
  });

  app.post('/end-chat', async (req: Request, res: Response) => {
    const workflowId = String(req.query.workflow_id ?? '');
    try {
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal(END_WORKFLOW_SIGNAL);
      res.json({ message: 'End chat signal sent.' });
    } catch (err) {
      console.error(err);
      res.json({});
    }
  });

  app.post('/start-workflow', async (req: Request, res: Response) => {
    const workflowId = String(req.query.workflow_id ?? '');
    try {
      await client.workflow.start('WealthManagementWorkflow', {
        taskQueue,
        workflowId,
        args: [],
        workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
      });
      res.json({ message: 'Workflow started.' });
    } catch (err) {
      const message = (err as Error).message;
      console.error('Exception occurred starting workflow', message);
      res.json({ message: `An error occurred starting the workflow ${message}` });
    }
  });

  // Chaos panel: failure-injection flags and the log of failures they caused.
  // The worker reads the flags from Redis inside activities; the API never talks to Temporal about chaos.
  app.get('/chaos', async (_req: Request, res: Response) => {
    try {
      res.json({ flags: await chaos.getFlags(), events: await chaos.getEvents() });
    } catch (err) {
      res.status(500).json({ detail: `Could not read chaos flags. ${(err as Error).message}` });
    }
  });

  app.post('/chaos', async (req: Request, res: Response) => {
    const flag = String(req.query.flag ?? '');
    const enabled = String(req.query.enabled ?? '') === 'true';
    if (!isChaosFlag(flag)) {
      res.status(400).json({ detail: `Unknown chaos flag: ${flag}` });
      return;
    }
    try {
      await chaos.setEnabled(flag, enabled);
      console.log(`Chaos flag ${flag} ${enabled ? 'on' : 'off'}`);
      res.json({ flag, enabled });
    } catch (err) {
      res.status(500).json({ detail: `Could not set chaos flag. ${(err as Error).message}` });
    }
  });

  app.post('/chaos/reset', async (_req: Request, res: Response) => {
    try {
      await chaos.reset();
      console.log('Chaos flags reset');
      res.json({ message: 'All chaos flags are off.' });
    } catch (err) {
      res.status(500).json({ detail: `Could not reset chaos flags. ${(err as Error).message}` });
    }
  });

  app.listen(PORT, HOST, () => {
    console.log(`API listening on http://${HOST}:${PORT}`);
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});