# API for Vercel AI SDK + Temporal Workflow

Exposes the Temporal `WealthManagementWorkflow` over a small HTTP API.

The API is implemented in TypeScript using Express and shares the `ClientHelper` and `EventStreamManager` modules with the Temporal worker. Claim-check codec support is inherited automatically from `ClientHelper`.

## Prerequisites

* [Node.js 20+](https://nodejs.org/) and npm
* A running Temporal server (local dev server or Temporal Cloud)
* A running Redis instance (used by `EventStreamManager`, the chaos flags and the claim-check codec)
* A running worker (see [the Temporal README](../src/temporal_supervisor/README.md#start-the-worker)); the API
  only starts and signals workflows, so without a worker the chat gets no answers

## Install dependencies

From the project root:

```bash
npm install
```

## Set up Claim Check (optional)

An optional configuration is to substitute the data sent to Temporal (e.g. function/method parameters and return values)
with an ID. This is known as the [Claim Check Pattern](https://www.enterpriseintegrationpatterns.com/patterns/messaging/StoreInLibrary.html).
The original data is stored in Redis. This uses a
[Custom Payload Codec](https://docs.temporal.io/develop/typescript/converters-and-encryption)
that intercepts data going to Temporal Cloud, replaces it with a GUID. When the data is retrieved, it looks up the GUID
replaces it with the data stored in Redis.

From the project root:

```bash
cp setclaimcheck.sh.example setclaimcheck.sh
chmod +x setclaimcheck.sh
```

Now edit the setclaimcheck.sh file and fill in the location of Redis
It should look something like this:
```bash
export USE_CLAIM_CHECK=true
export REDIS_HOST=localhost
export REDIS_PORT=6379
```

Save the file and be sure that you have Redis running. For example:

```bash
redis-server
```

Claim check is optional. If you don't create `setclaimcheck.sh`, the start scripts print a harmless
`setclaimcheck.sh: No such file or directory` message and run without claim check.

Note that the application assumes you only have one Redis server that is used by the application for storing the
conversation history and is also used if Claim Check has been enabled.

Be aware that using a claim check pattern introduces performance costs by doing remote calls to Redis for every payload.
Also, make sure your Redis implementation is rock solid as any downtime will directly affect your workflows.

## Run Codec Server for Claim Check (optional)
If you have decided to set up the Claim Check above, you will
most likely want to also run a Codec Server to be able to see the actual sent to
the workflow and activities.

Be sure you have updated the setclaimcheck.sh as mentioned above.

To run the Codec Server:
```bash
cd src/temporal_supervisor
./startcodecserver.sh
```

And of course, make sure that your Redis Server is up and running.

Once it's up and running, the default endpoint is http://127.0.0.1:8081.

Open up your browser and navigate to the Temporal UI. Locally, open it at exactly http://localhost:8233 (the
codec server only allows requests from that origin).
For Temporal Cloud that will be https://cloud.temporal.io

In the upper right, there is an icon that looks like glasses. Click on that and you
can configure your codec server.

Change the drop down to "Use my browser setting and ignore Cluster-level setting".

Use the endpoint of your codec server (default is http://127.0.0.1:8081). Be sure there are no
extra spaces at the end of the URL or it will not work. You can turn off the two options - Pass the
user access token and Include cross-origin credentials. Click on apply and you have configured
the codec server.


## Start API server Locally

From the project root:

```bash
cd api
./startlocalapi.sh
```

## Start API server for Temporal Cloud

From the project root:

```bash
cd api
./startcloudapi.sh
```

`startcloudapi.sh` reads the Temporal Cloud connection settings from `setcloudenv.sh` in the project root (see
[Running the demo in Temporal Cloud](../src/temporal_supervisor/README.md#running-the-demo-in-temporal-cloud)).
Both scripts source `../setclaimcheck.sh` and run `npm run api`. The API logs whether claim check is enabled on startup.

The API listens on http://127.0.0.1:8000 and allows CORS requests from the React UX at
`http://localhost:3000` and `http://127.0.0.1:3000`.

## Endpoints

All parameters are query parameters.

| Method | Path | Parameters | Purpose |
|---|---|---|---|
| GET | `/` | none | Health check |
| POST | `/start-workflow` | `workflow_id` | Start a `WealthManagementWorkflow` (chat) with that ID |
| POST | `/send-prompt` | `workflow_id`, `prompt` | Send a customer message (`process_user_message` signal) |
| GET | `/get-chat-history` | `workflow_id`, `from_index` (default 0) | Chat messages and status updates from Redis, starting at `from_index` |
| POST | `/end-chat` | `workflow_id` | End the chat (`end_workflow` signal) |
| GET | `/chaos` | none | Chaos flags and recently injected failures |
| POST | `/chaos` | `flag`, `enabled` (`true` or anything else for off) | Turn a chaos flag on or off |
| POST | `/chaos/reset` | none | Turn every chaos flag off and clear the failure log |

## Configuration

| Env var               | Default            | Purpose                            |
| --------------------- | ------------------ | ---------------------------------- |
| `API_HOST`            | `127.0.0.1`        | Bind address                       |
| `API_PORT`            | `8000`             | Bind port                          |
| `TEMPORAL_ADDRESS`    | `localhost:7233`   | Temporal server address            |
| `TEMPORAL_NAMESPACE`  | `default`          | Temporal namespace                 |
| `TEMPORAL_API_KEY`    | empty              | API key for Temporal Cloud         |
| `TEMPORAL_TLS_CLIENT_CERT_PATH`, `TEMPORAL_TLS_CLIENT_KEY_PATH` | empty | mTLS certificate and key for Temporal Cloud |
| `TEMPORAL_TASK_QUEUE` | `VAISupervisor`    | Task queue the chat workflow is started on (must match the worker) |
| `USE_CLAIM_CHECK`     | `false`            | Enable claim-check payload codec   |
| `REDIS_HOST`          | `localhost`        | Redis host (events + claim check)  |
| `REDIS_PORT`          | `6379`             | Redis port                         |

## Smoke test

Confirm the API is running:

```bash
curl http://127.0.0.1:8000
```

Start a workflow:

```bash
curl -X POST 'http://127.0.0.1:8000/start-workflow?workflow_id=<your-workflow-id>'
```

Send a prompt:

```bash
curl -X POST 'http://127.0.0.1:8000/send-prompt?workflow_id=<your-workflow-id>&prompt=Who%20are%20my%20beneficiaries%3F'
```

Respond with a client ID:

```bash
curl -X POST 'http://127.0.0.1:8000/send-prompt?workflow_id=<your-workflow-id>&prompt=123'
```

Ask about investment accounts:

```bash
curl -X POST 'http://127.0.0.1:8000/send-prompt?workflow_id=<your-workflow-id>&prompt=What%20investment%20accounts%20do%20I%20have%3F'
```

Query the chat history:

```bash
curl "http://127.0.0.1:8000/get-chat-history?workflow_id=<your-workflow-id>&from_index=<index>"
```

End the chat:

```bash
curl -X POST "http://127.0.0.1:8000/end-chat?workflow_id=<your-workflow-id>"
```

## Chaos endpoints

The [chaos panel](../src/temporal_supervisor/README.md#failure-scenarios-chaos-panel) uses these to
inject failures. List the flags and recent injected failures:

```bash
curl http://127.0.0.1:8000/chaos
```

Turn a flag on or off (`tool_down`, `llm_down`, `llm_rate_limited`, `custodian_rejects`, `slow_saga`, `workflow_bug`):

```bash
curl -X POST 'http://127.0.0.1:8000/chaos?flag=tool_down&enabled=true'
```

Turn every flag off and clear the failure log:

```bash
curl -X POST http://127.0.0.1:8000/chaos/reset
```
