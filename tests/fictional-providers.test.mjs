import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { providerEvent, feedNames } from '../infra/simulation/providers.mjs';
import { simulationWorkflow } from '../infra/simulation/workflow.mjs';
import { advance, state } from '../lib/demo-events.ts';
import { SQLiteDatabase } from '../db/index.ts';

const start = Date.now() - 60000;
const scenario = { seed: 27, step: 1, start, time: start + 10000 };
test('all nine feeds replay exactly and release assets agree with the bucket inventory', async () => {
  const events = feedNames.map((name) => providerEvent(name, scenario));
  assert.equal(events.length, 9);
  assert.deepEqual(
    events,
    feedNames.map((name) => providerEvent(name, scenario)),
  );
  const files = events.find((e) => e.name === 'releases').value.installers;
  const bucket = events.find((e) => e.name === 'edge').value.data.r2;
  assert.equal(
    bucket.totalBytes,
    files.reduce((sum, f) => sum + f.bytes, 0),
  );
  assert.ok(
    files.every((f) =>
      bucket.objects.some((o) => o.key.endsWith('/' + f.filename) && o.sizeBytes === f.bytes),
    ),
  );
  const workflow = JSON.parse(
    await readFile(new URL('../infra/n8n/workflows/demo-events.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(workflow, simulationWorkflow());
});
test('sales, refunds and mail receipts agree as a workspace evolves', () => {
  for (const step of [2, 3]) {
    const input = { ...scenario, step };
    const current = providerEvent('sales', input).value.data.live;
    const prior = providerEvent('sales', { ...input, step: step - 1 }).value.data.live;
    const receipt = providerEvent('mail', input).value.at(-1);
    const cents = Number(/USD ([\d.]+)/.exec(receipt.body)[1]) * 100;
    assert.equal(current.orderCount, prior.orderCount + 1);
    assert.equal(current.grossCents - prior.grossCents, cents);
    assert.equal(
      current.refundedCents - prior.refundedCents,
      receipt.subject.startsWith('Refund') ? cents : 0,
    );
  }
});
test('a failed or corrupted provider delivery leaves the prior revision intact', async (t) => {
  const original = process.env.SECDASH_N8N_WEBHOOK;
  process.env.SECDASH_N8N_WEBHOOK = 'http://127.0.0.1:5790/webhook/secdash-events';
  t.after(() => {
    if (original === undefined) delete process.env.SECDASH_N8N_WEBHOOK;
    else process.env.SECDASH_N8N_WEBHOOK = original;
  });
  const db = new SQLiteDatabase(':memory:');
  t.after(() => db.close());
  let broken = false;
  t.mock.method(globalThis, 'fetch', async (_url, { body }) => {
    const input = JSON.parse(body);
    const feeds = feedNames.map((name) => providerEvent(name, input));
    if (broken) feeds.find((f) => f.name === 'drive').value = { status: 'ok' };
    return Response.json({ feeds });
  });
  const workspace = start + '-0123456789abcdef0123456789abcdef';
  assert.deepEqual(await advance(db, workspace, 0), { step: 1 });
  broken = true;
  await assert.rejects(advance(db, workspace, 1));
  assert.equal(state(db).step, 1);
  assert.equal(db.native.prepare('SELECT count(*) AS n FROM messages').get().n, 7);
  broken = false;
  const concurrent = await Promise.all([advance(db, workspace, 1), advance(db, workspace, 1)]);
  assert.deepEqual(concurrent, [{ step: 2 }, { step: 2 }]);
  assert.equal(db.native.prepare('SELECT count(*) AS n FROM messages').get().n, 9);
});
