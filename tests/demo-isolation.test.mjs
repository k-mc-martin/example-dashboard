import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const directory = new URL('../infra/n8n/workflows/', import.meta.url);
const files = readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.json'));

test('the demo includes workflow exports', () => assert.ok(files.length > 0));
for (const file of files) {
  test(file.name + ' contains an inactive demo workflow', () => {
    const workflow = JSON.parse(readFileSync(join(file.parentPath, file.name), 'utf8'));
    assert.match(workflow.id, /^Dupdash/);
    assert.equal(workflow.active, false);
    for (const field of ['pinData', 'staticData']) {
      assert.deepEqual(Object.keys(workflow[field] ?? {}), [], field);
    }
    for (const node of workflow.nodes) {
      for (const [type, credential] of Object.entries(node.credentials ?? {})) {
        assert.equal(type, 'httpHeaderAuth', node.name);
        assert.match(credential.id, /^Dupdash/);
      }
      // n8n expressions can contain additional URLs, including pagination checks.
      const parameters = JSON.stringify(node.parameters).replaceAll('[.]', '.').replace(/\\+\./g, '.');
      for (const match of parameters.matchAll(/https?:\/\/([a-z0-9.:-]+)/gi)) {
        const destination = match[1];
        assert.ok(destination === 'dashboard:3000' || destination === 'recovery-feed:8080'
          || (workflow.id === 'DupdashSimulation' && destination === 'providers:5791')
          || /^[a-z0-9-]+\.dupdash\.invalid$/i.test(destination), node.name + ' has an unexpected destination');
      }
    }
    if (workflow.id === 'DupdashMailboxContinuityPrepared') {
      assert.doesNotMatch(JSON.stringify(workflow.nodes), /[a-f0-9]{64}/i, 'embedded historical record fingerprints');
    }
  });
}
