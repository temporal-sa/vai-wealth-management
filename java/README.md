# Open Account Workflow in Java

A Java version of [open-account.ts](../src/temporal_supervisor/workflows/open-account.ts).
It shows a polyglot Temporal application. The supervisor (AI) workflow and every activity run in TypeScript,
and only the Open Account child workflow runs here.

How the two sides fit together:

* When the TypeScript worker has `TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT` set, the supervisor starts
  `OpenInvestmentAccountWorkflow` as a child workflow on that task queue, which this worker polls, and the
  TypeScript worker doesn't register its own version of the workflow (unless the queue is its own).
  Without it, the child runs in TypeScript on the supervisor's task queue.
* This workflow calls the TypeScript activities (`getClient`, `updateClient` when the customer corrects their
  details during KYC, and the saga steps `openInvestment`, `debitLinkedAccount`, `registerAccount` with their
  compensations `removeInvestment` and `creditLinkedAccount`) by name on the TypeScript task queue
  (`TEMPORAL_TASK_QUEUE`, default `VAISupervisor`).
  The chaos panel's flags are read inside those activities, so every failure scenario works with this worker too
  (see [Failure scenarios](../src/temporal_supervisor/README.md#failure-scenarios-chaos-panel)).
* It reports each state change by signalling `update_account_opening_state` on the parent workflow with
  `{account_name, state, workflow_id}`, as the TypeScript version does. Signals are routed by workflow ID,
  so the different task queue doesn't matter.
* The workflow type, query (`get_current_state`), updates (`get_client_details`, which waits until the client
  details are loaded, and `update_client_details`, which saves corrected details and approves KYC) and signals
  (`verify_kyc`, which waits until the client details are loaded, and `compliance_approved`, which also waits
  until KYC is approved) match the TypeScript version, so the agent tools and
  `localsendcomplianceapproval.sh` drive either implementation unchanged.
* When `USE_CLAIM_CHECK=true`, payloads go through the same Redis claim check as the TypeScript worker, in the
  same format, so either side (and the codec server) can decode them.

## Prerequisites

* JDK 25 or later, as `JAVA_HOME` or `java` on the `PATH` (Gradle 9.8.2 is provided by the wrapper, so no separate
  Gradle install is needed)
* Everything the TypeScript demo needs (see [the Temporal README](../src/temporal_supervisor/README.md)),
  including a running TypeScript worker: it hosts the activities this workflow calls

## Running

Pass the same task queue name to the TypeScript worker and to this worker. The argument is required; the
script sets `TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT` from it, builds the jar with the Gradle wrapper and starts it
(`runworker.sh`). The scripts can be run from any directory.

```bash
# terminal 1
cd src/temporal_supervisor
./startlocalworker.sh OpenAccount

# terminal 2
cd java
./startlocalworker.sh OpenAccount
```

To try the Java workflow without the chat, API or UX, run the open-account scenarios against it with the
same task queue name (see
[Testing the open-account workflow on its own](../src/temporal_supervisor/README.md#testing-the-open-account-workflow-on-its-own)):

```bash
# terminal 1
java/startlocalworker.sh OpenAccount

# terminal 2 (starts its own TypeScript worker for the activities)
src/temporal_supervisor/startlocalopenaccount.sh OpenAccount
```

For Temporal Cloud, use `startcloudworker.sh` in both places. It reads the connection settings (API key or mTLS)
from `setcloudenv.sh` in the project root, the same file the TypeScript worker uses (see
[Running the demo in Temporal Cloud](../src/temporal_supervisor/README.md#running-the-demo-in-temporal-cloud)).

With mTLS, Java's TLS needs the client key as an unencrypted PKCS8 key (`-----BEGIN PRIVATE KEY-----`). If
`TEMPORAL_TLS_CLIENT_KEY_PATH` points to a different format (keys from tcld or openssl are often PKCS1,
`-----BEGIN RSA PRIVATE KEY-----`), `startcloudworker.sh` stops and prints the command to convert it, for
example:

```bash
openssl pkcs8 -topk8 -nocrypt -in /path/to/key.key -out /path/to/key.pkcs8.key
```

Then add the converted key to `setcloudenv.sh` (the TypeScript components keep using
`TEMPORAL_TLS_CLIENT_KEY_PATH`):

```bash
export TEMPORAL_KEY_PKCS8_PATH="/path/to/key.pkcs8.key"
```

The `mtls` profile ([application-mtls.yaml](src/main/resources/application-mtls.yaml)) reads the key from
`TEMPORAL_KEY_PKCS8_PATH` when it is set, and from `TEMPORAL_TLS_CLIENT_KEY_PATH` otherwise.

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
| TEMPORAL_KEY_PKCS8_PATH | empty | The client key in unencrypted PKCS8 format, when TEMPORAL_TLS_CLIENT_KEY_PATH is in another format (checked by `startcloudworker.sh`) |
| TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT | required | Task queue this worker polls |
| TEMPORAL_TASK_QUEUE | VAISupervisor | TypeScript task queue that hosts the activities |
| USE_CLAIM_CHECK, REDIS_HOST, REDIS_PORT | false, localhost, 6379 | Claim check codec |

An API key turns on TLS automatically. If you run the jar yourself with mTLS, add the profile:
`java -jar build/libs/open-account-worker.jar --spring.profiles.active=mtls`.

Keep API keys and certificates out of the repository.

## The workflow bug

With the **Bug in workflow code** chaos flag on, new openings get a `WELCOME-BONUS` promo code, but `BONUS_RATES`
in [OpenInvestmentAccountWorkflowImpl.java](src/main/java/io/temporal/demo/wealthmanagement/workflow/OpenInvestmentAccountWorkflowImpl.java)
is keyed by `WELCOME_BONUS`, so the workflow task fails with a `NullPointerException` after compliance approval
and the workflow stays Running. To fix it, swap the two `BONUS_RATES` lines and restart this worker. To re-arm the
bug afterwards, `git checkout` the file. See
[Failure scenarios](../src/temporal_supervisor/README.md#failure-scenarios-chaos-panel).

## Tests

From the `java` directory:

```bash
./gradlew test
```

The workflow tests run against the Temporal test server, with fake TypeScript activities registered under the
real activity names and a test parent workflow that records the status signals. They cover the saga (happy path,
rollback in reverse order, undoing only completed steps, transient retries), approval signals sent early
waiting for the steps before them, the promo-code bug pausing the workflow, and the JSON shapes the TypeScript supervisor sends and receives.
