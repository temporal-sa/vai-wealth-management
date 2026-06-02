# API for Vercel AI SDK + Temporal Workflow

Exposes the Temporal `WealthManagementWorkflow` over a small HTTP API.

The API is implemented in TypeScript using Express and shares the `ClientHelper` and `EventStreamManager` modules with the Temporal worker. Claim-check codec support is inherited automatically from `ClientHelper`.

## Prerequisites

* [Node.js 20+](https://nodejs.org/)
* A running Temporal server (local dev server or Temporal Cloud)
* A running Redis instance (used by `EventStreamManager` and the claim-check codec)

## Install dependencies

From the project root:

```bash
npm install
```

## Set up Claim Check (optional)

An optional configuration is to substitute the data sent to Temporal (e.g. function/method parameters and return values)
with an ID. This is known as the [Claim Check Pattern](https://www.enterpriseintegrationpatterns.com/patterns/messaging/StoreInLibrary.html).
The original data is stored in Redis. This uses a
[Custom Payload Codec](https://docs.temporal.io/develop/python/converters-and-encryption#custom-payload-codec)
that intercepts data going to Temporal Cloud, replaces it with a GUID. When the data is retrieved, it looks up the GUID
replaces it with the data stored in Redis.

```bash
cd <project root>
cp setclaimcheck.example setclaimcheck.sh
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
./startcodecserver.sh
```

And of course, make sure that your Redis Server is up and running.

Once it's up and running, the default endpoint is http://127.0.0.1:8081.

Open up your browser and navigate to the Temporal UI. Locally that is usually localhost:8233.
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

The API logs whether claim check is enabled on startup.

## Configuration

| Env var               | Default            | Purpose                            |
| --------------------- | ------------------ | ---------------------------------- |
| `API_HOST`            | `127.0.0.1`        | Bind address                       |
| `API_PORT`            | `8000`             | Bind port                          |
| `TEMPORAL_ADDRESS`    | `localhost:7233`   | Temporal server address            |
| `TEMPORAL_NAMESPACE`  | `default`          | Temporal namespace                 |
| `TEMPORAL_TASK_QUEUE` | `VAISupervisor`    | Task queue name                    |
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