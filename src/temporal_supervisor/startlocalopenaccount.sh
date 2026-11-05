#!/bin/bash
# Run the open-account workflow's three scenarios without the chat or the LLM
# (see run_open_account_workflow.ts). Starts a local TypeScript worker in the background for the
# activities (and, without a task queue argument, the workflow too), and stops it when the
# scenarios finish.
# Usage: startlocalopenaccount.sh [open-account-task-queue] [run_open_account_workflow.ts args]
# With a task queue name, the workflow runs on that queue: start the Java worker with the same
# name first (java/startlocalworker.sh <queue>).
# Extra arguments after the queue go to run_open_account_workflow.ts
# (e.g. --scenario 1 --amount 300000).
cd "$(dirname "$0")/../.." || exit 1
[ -f setclaimcheck.sh ] && source ./setclaimcheck.sh
if [ -n "$1" ] && [ "${1#-}" = "$1" ]; then
  export TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT="$1"
  echo "*** Running the open-account workflow on task queue $1 (the Java worker must poll it). ***"
  shift
fi
echo "Starting the worker and running the scenarios for the open-account workflow."
# No LLM key needed: these scenarios make no model calls. ts-node is started directly (not through
# npm run temporal:worker) so that $! is the worker's own PID and the trap can stop it.
node_modules/.bin/ts-node src/temporal_supervisor/worker.ts &
WORKER_PID=$!
trap 'kill $WORKER_PID 2>/dev/null; wait $WORKER_PID 2>/dev/null' EXIT
npm run --silent open-account.scenarios -- "$@"
