// The workflows for a worker whose Open Account workflow runs on another task queue
// (TEMPORAL_TASK_QUEUE_OPEN_ACCOUNT, e.g. the Java worker in /java): the supervisor only.
// index.ts adds the TypeScript OpenInvestmentAccountWorkflow; worker.ts picks one of the two.
export { WealthManagementWorkflow } from './wealth-management';
