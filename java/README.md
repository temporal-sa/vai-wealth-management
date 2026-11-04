# Open Account Workflow in Java

A Java version of [open-account.ts](../src/temporal_supervisor/workflows/open-account.ts).
It shows a polyglot Temporal application. The supervisor (AI) workflow and every activity run in TypeScript,
and only the Open Account child workflow runs here.

How the two sides fit together:

* When the TypeScript worker has `TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT` set, the supervisor starts
  `OpenInvestmentAccountWorkflow` as a child workflow on that task queue, which this worker polls.
  Without it, the child runs in TypeScript on the supervisor's task queue.
* This workflow calls the TypeScript activities (`getClient`, `openInvestment`) by name on the TypeScript
  task queue (`TEMPORAL_TASK_QUEUE`, default `VAISupervisor`).
* It reports progress by signalling `update_status` on the parent workflow, as the TypeScript version does.
  Signals are routed by workflow ID, so the different task queue doesn't matter.
* The workflow type, queries (`get_current_state`, `get_client_details`), update (`update_client_details`)
  and signals (`verify_kyc`, `compliance_approved`) match the TypeScript version, so the agent tools and
  `localsendcomplianceapproval.sh` drive either implementation unchanged.
* When `USE_CLAIM_CHECK=true`, payloads go through the same Redis claim check as the TypeScript worker, in the
  same format, so either side (and the codec server) can decode them.

## Prerequisites

* Java 21 or later (Gradle is provided by the wrapper)
* Everything the TypeScript demo needs (see [the Temporal README](../src/temporal_supervisor/README.md))

## Running

Pass the same task queue name to the TypeScript worker and to this worker.

```bash
# terminal 1
cd src/temporal_supervisor
./startlocalworker.sh OpenAccount

# terminal 2
cd java
./startlocalworker.sh OpenAccount
```

For Temporal Cloud, use `startcloudworker.sh` in both places. It reads the connection settings from
`setcloudenv.sh` in the project root, the same file the TypeScript worker uses.

Both scripts load `../setclaimcheck.sh` if it exists. The worker logs the connection and auth mode it
uses at startup. If a connection setting seems to be ignored, check that line.

## Connecting

Connection settings come from the same `TEMPORAL_*` variables the Temporal CLI and the TypeScript worker use.

| Variable | Default | Purpose |
|---|---|---|
| TEMPORAL_ADDRESS | localhost:7233 | Frontend address |
| TEMPORAL_NAMESPACE | default | Namespace |
| TEMPORAL_API_KEY | empty | API key auth (enables TLS) |
| TEMPORAL_TLS_CLIENT_CERT_PATH, TEMPORAL_TLS_CLIENT_KEY_PATH | empty | mTLS auth (the start scripts then activate the `mtls` profile) |
| TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT | required | Task queue this worker polls |
| TEMPORAL_TASK_QUEUE | VAISupervisor | TypeScript task queue that hosts the activities |
| USE_CLAIM_CHECK, REDIS_HOST, REDIS_PORT | false, localhost, 6379 | Claim check codec |

An API key turns on TLS automatically. If you run the jar yourself with mTLS, add the profile:
`java -jar build/libs/open-account-worker.jar --spring.profiles.active=mtls`.

Keep API keys and certificates out of the repository.

## Tests

```bash
./gradlew test
```

The workflow tests run against the Temporal test server, with fake TypeScript activities registered under the
real activity names and a test parent workflow that records the status signals. They also check the JSON shapes
the TypeScript supervisor sends and receives.
