import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertModelBudget, buildWorkflow, checkpointAfter, contentFingerprint, graphStartUrl, planContinuity, validateNextLink, validateRunConfig, verifyHistoricalSeed } from '../infra/n8n/workflows/mailbox-continuity.mjs';
import { dashboardRecordId } from '../infra/n8n/workflows/mailbox-routing-preview.mjs';

const message = (overrides = {}) => ({ source: 'secdash-mail', messageId: '<new@example.test>', sender: 'person@example.test', subject: 'Hello', body: 'Body', receivedAt: '2026-09-30T06:00:00.000Z', sourceUrl: null, ...overrides });

test('defaults fail closed with no reusable model budget', () => {
  const config = validateRunConfig();
  assert.equal(config.classificationMode, 'disabled');
  assert.deepEqual([config.approvedMaxCalls, config.approvedMaxInputTokens, config.approvedMaxOutputTokens, config.approvedMaxCostUsd], [0, 0, 0, 0]);
  assert.throws(() => assertModelBudget(config, { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.001 }), /historical authorization is not reusable/);
  assert.throws(() => validateRunConfig({ classificationMode: 'approved-model', approvedMaxCalls: 1 }), /explicit positive/);
});

test('fresh approval enforces every ceiling before a call', () => {
  const config = { classificationMode: 'approved-model', approvedMaxCalls: 2, approvedMaxInputTokens: 100, approvedMaxOutputTokens: 20, approvedMaxCostUsd: 0.1 };
  assert.deepEqual(assertModelBudget(config, { calls: 1, inputTokens: 60, outputTokens: 10, costUsd: 0.04 }), { calls: 1, inputTokens: 60, outputTokens: 10, costUsd: 0.04 });
  assert.throws(() => assertModelBudget(config, { calls: 1, inputTokens: 50, outputTokens: 1, costUsd: 0.01 }, { calls: 1, inputTokens: 60, outputTokens: 10, costUsd: 0.04 }), /would be exceeded/);
});

test('checkpoint query overlaps the prior watermark and nextLinks stay on exact Inbox collection', () => {
  const url = new URL(graphStartUrl({ watermark: '2026-09-30T06:00:00.000Z' }));
  assert.equal(url.searchParams.get('$filter'), 'receivedDateTime ge 2026-09-30T05:50:00.000Z');
  const next = 'https://mail.secdash.invalid/v1.0/me/mailFolders/inbox/messages?$skiptoken=abc';
  assert.equal(validateNextLink(next), next);
  assert.throws(() => validateNextLink('https://mail.secdash.invalid/v1.0/me/messages?$skiptoken=abc'), /pagination path/);
  assert.throws(() => validateNextLink('https://example.com/v1.0/me/mailFolders/inbox/messages'), /pagination origin/);
});

test('historical seed and ledger deduplicate by stable record ID and verify content', () => {
  const current = message();
  const imported = { recordId: 'placeholder', contentDigest: contentFingerprint(current), state: 'delivered' };
  const planned = planContinuity([current, current], [], [{ ...imported, recordId: dashboardRecordId(current) }]);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].state, 'already-terminal');
  const original = { ...planned[0].existing, contentDigest: '0'.repeat(64) };
  const newer = message({ messageId: '<other@example.test>' });
  const [conflict, next] = planContinuity([current, newer], [original], []);
  assert.equal(conflict.state, 'quarantined');
  assert.notEqual(conflict.recordId, original.recordId);
  assert.equal(conflict.message.body, current.body);
  assert.equal(next.state, 'staged-awaiting-approval');
  assert.equal(planContinuity([current], [original, conflict], [])[0].state, 'already-terminal');
});

test('unapproved unseen mail is durably staged without classification', () => {
  const planned = planContinuity([message()], [], []);
  assert.equal(planned[0].state, 'staged-awaiting-approval');
  assert.equal(planned[0].decision, null);
  assert.equal(planned[0].provenance.reasonCode, 'model_spend_not_authorized');
});

test('historical compatibility proof is exact and emits no identifiers or content', () => {
  const messages = Array.from({ length: 96 }, (_, index) => message({ messageId: `<${index}@example.test>`, body: `body-${index}` }));
  const seed = messages.map(value => ({ recordId: dashboardRecordId(value), contentDigest: contentFingerprint(value) }));
  const proof = verifyHistoricalSeed(messages, seed);
  assert.deepEqual(proof, { verified: true, expected: 96, matched: 96, sourceMessagesChanged: false, contentEmitted: false });
  assert.equal(JSON.stringify(proof).includes('example.test'), false);
  assert.throws(() => verifyHistoricalSeed(messages.slice(1), seed), /matched 95 of 96/);
  assert.throws(() => verifyHistoricalSeed(messages.map((value, index) => index === 0 ? { ...value, body: 'changed' } : value), seed), /changed content or immutable-ID mapping/);
});

test('checkpoint advances only over durable terminal intake states', () => {
  const plans = planContinuity([message()], [], []);
  assert.equal(checkpointAfter({ watermark: null }, plans).watermark, message().receivedAt);
  assert.throws(() => checkpointAfter({}, [{ recordId: 'x', state: 'requires-approved-model' }]), /cannot advance/);
});

test('prepared workflow is a real inactive durable staging pipeline with no model or dashboard writes', async () => {
  const workflow = buildWorkflow();
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.some(node => node.type === 'n8n-nodes-base.manualTrigger'));
  assert.equal(workflow.nodes.some(node => node.type === 'n8n-nodes-base.scheduleTrigger'), true);
  assert.equal(workflow.nodes.find(node => node.name === 'Every 15 minutes').parameters.rule.interval[0].minutesInterval, 15);
  assert.equal(JSON.stringify(workflow).includes('routing.secdash.invalid'), false);
  assert.equal(JSON.stringify(workflow).includes('api/n8n/messages'), false);
  assert.equal(workflow.nodes.filter(node => node.type === 'n8n-nodes-base.dataTable').length, 6);
  assert.equal(workflow.nodes.find(node => node.name === 'Upsert durable staged messages').parameters.operation, 'upsert');
  assert.equal(workflow.nodes.find(node => node.name === 'Commit Inbox checkpoint').parameters.operation, 'upsert');
  assert.equal(workflow.nodes.find(node => node.name === 'Read Inbox checkpoint').alwaysOutputData, true);
  const freshLedgerColumns=workflow.nodes.find(node => node.name === 'Create or reuse continuity ledger').parameters.columns.column.map(column=>column.name);
  for(const name of ['feedbackEnvironment','feedbackInterpretation','feedbackEvidenceQuotes','feedbackRationale','feedbackContext','intendedExperienceReference']) assert.ok(freshLedgerColumns.includes(name));
  const graph = workflow.nodes.find(node => node.name === 'Read complete overlapped Inbox pages');
  assert.equal(graph.parameters.url, '={{ $json.startUrl }}');
  assert.match(JSON.stringify(graph.parameters.headerParameters), /ImmutableId/);
  assert.equal(graph.parameters.options.pagination.pagination.maxRequests, 100);
  const saved = JSON.parse(await readFile(new URL('../infra/n8n/workflows/mailbox-continuity-prepared.json', import.meta.url), 'utf8'));
  assert.equal(saved.id, workflow.id);
  assert.equal(saved.active, false);
});
