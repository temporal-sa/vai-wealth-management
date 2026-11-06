import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  SUPERVISOR_INSTRUCTIONS,
  BENE_INSTRUCTIONS,
  INVEST_INSTRUCTIONS,
  STANDALONE_INVEST_INSTRUCTIONS,
  OPEN_ACCOUNT_INSTRUCTIONS,
  INVEST_AGENT_NAME,
} from '../../common/agent-constants';

const DECLINE_BLOCK = `You only help with wealth management: the customer's beneficiaries and investment accounts.
If the customer asks about anything else (for example general knowledge, weather, news, or
other financial products), politely decline, say that you can only help with beneficiaries
and investment accounts, and do not answer the question. Then ask how you can help with
their beneficiaries or investment accounts.`;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.ts$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

describe('agent instructions', () => {
  it('supervisor declines off-topic questions right after its first line', () => {
    const lines = SUPERVISOR_INSTRUCTIONS.split('\n');
    assert.strictEqual(lines.slice(1, 6).join('\n'), DECLINE_BLOCK);
    assert.strictEqual(lines[6], '# Routine');
  });

  it('specialists transfer off-topic questions back', () => {
    for (const instructions of [BENE_INSTRUCTIONS, INVEST_INSTRUCTIONS]) {
      assert.ok(
        instructions.includes(
          'If the customer asks a question that is not related to the routine, transfer back to the supervisor agent.',
        ),
      );
    }
    assert.ok(OPEN_ACCOUNT_INSTRUCTIONS.includes(`immediately hand off to the ${INVEST_AGENT_NAME}`));
  });

  it('Investment Agent hands off to open an account, except in the standalone version', () => {
    assert.ok(
      INVEST_INSTRUCTIONS.includes(
        'If they wish to open a new account, hand off to the Open Account Agent with the handoff_to_open_account_agent tool.',
      ),
    );
    // The standalone Investment Agent opens accounts itself and has no Open Account Agent
    assert.ok(STANDALONE_INVEST_INSTRUCTIONS.includes('If they wish to open a new account, use the open_investment tool.'));
    assert.ok(!/Open Account Agent|handoff_to_open_account_agent/.test(STANDALONE_INVEST_INSTRUCTIONS));
  });

  it('Open Account Agent checks the status with get_account_opening_status', () => {
    assert.ok(OPEN_ACCOUNT_INSTRUCTIONS.includes('get_account_opening_status'));
    assert.ok(!OPEN_ACCOUNT_INSTRUCTIONS.includes('get_account_status'));
  });

  it('has no guardrail code', () => {
    const srcDir = path.resolve(__dirname, '../..');
    for (const file of sourceFiles(srcDir)) {
      assert.ok(!/guardrail|tripwire/i.test(fs.readFileSync(file, 'utf8')), `guardrail code found in ${file}`);
    }
  });
});
