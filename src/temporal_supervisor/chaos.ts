// Failure injection for the chaos panel. These helpers do I/O, so they may only be
// called from activities (including the model activity), never from workflow code.
import { Context } from '@temporalio/activity';
import { ChaosFlag, ChaosManager } from '../common/chaos-manager';

const SLOW_STEP_MS = 4000;
const FLAG_READ_TIMEOUT_MS = 1000;

let manager: ChaosManager | undefined;

function chaosManager(): ChaosManager {
  manager ??= new ChaosManager();
  return manager;
}

/** Whether a flag is on. Fails open: if Redis is unreachable, chaos is off rather than breaking the demo. */
export async function isEnabled(flag: ChaosFlag): Promise<boolean> {
  try {
    return await Promise.race([
      chaosManager().isEnabled(flag),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FLAG_READ_TIMEOUT_MS).unref()),
    ]);
  } catch {
    return false;
  }
}

/** Throws `error` if `flag` is on, logging the hit for the chaos panel. The error's type decides whether Temporal retries. */
export async function injectFailure(flag: ChaosFlag, error: Error): Promise<void> {
  if (!(await isEnabled(flag))) return;
  const { activityType, attempt, workflowExecution } = Context.current().info;
  try {
    await chaosManager().recordEvent({ flag, source: activityType, attempt, workflow_id: workflowExecution?.workflowId });
  } catch {
    // The failure log is best effort
  }
  throw error;
}

/** Call at the top of each activity that stands for the core banking system. */
export async function coreBankingApi(): Promise<void> {
  await injectFailure(ChaosFlag.TOOL_DOWN, new Error('ConnectionError: Core banking API unavailable'));
}

/** Makes account-opening steps slow enough to watch, when the slow-steps flag is on. */
export async function maybeSlowDown(): Promise<void> {
  if (await isEnabled(ChaosFlag.SLOW_SAGA)) {
    await Context.current().sleep(SLOW_STEP_MS);
  }
}
