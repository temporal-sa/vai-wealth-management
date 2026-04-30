import { ClientHelper } from '../common/client-helper';

async function approve(workflowId: string): Promise<void> {
  const helper = new ClientHelper();
  const { connection, client } = await helper.connectClient();

  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal('compliance_approved');
    console.log(`Compliance approval sent to workflow: ${workflowId}`);
  } finally {
    await connection.close();
  }
}

function parseArgs(): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--workflow-id');
  if (idx === -1 || !args[idx + 1]) {
    console.error( 'args are ' + args);
    console.error('Usage: ts-node run_send_compliance_approval.ts --workflow-id <workflow-id>');
    process.exit(1);
  }
  return args[idx + 1];
}

approve(parseArgs()).catch((err) => {
  console.error(err);
  process.exit(1);
});