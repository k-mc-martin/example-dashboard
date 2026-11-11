import assert from 'node:assert/strict';
import { base, request, json, visitor, signIn } from './demo-http-client.mjs';
const advance = (cookie, step) =>
  json(cookie, '/api/demo/events', {
    method: 'POST',
    headers: { Origin: base, 'If-Match': String(step) },
  });
// A fresh policy must reach both the browser and Next's rendered bootstrap scripts.
async function dashboardNonce() {
  const response = await fetch(base, {headers: {'Content-Security-Policy': "script-src 'nonce-caller'" }});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-powered-by'), null);
  const policy = response.headers.get('content-security-policy') ?? '';
  const nonce = policy.match(/script-src 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/)?.[1];
  assert.ok(nonce && nonce !== 'caller', 'Dashboard must provide its own nonce');
  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map(([, attributes]) => attributes);
  assert.ok(scripts.length > 0);
  for (const attributes of scripts) {
    assert.ok(attributes.includes('nonce="' + nonce + '"'), 'Bootstrap script must match the response policy');
  }
  return nonce;
}
assert.notEqual(await dashboardNonce(), await dashboardNonce());
const [a, b] = await Promise.all([visitor(), visitor()].map(async workspace => signIn(await workspace, 'Owner')));
await Promise.all([advance(a, 0), advance(b, 0)]);
const before = await json(b, '/api/dashboard');
assert.equal(before.messages.length, 7);
assert.equal(Object.keys(before.counts).length, 6);
assert.equal(Object.keys(before.providerConnections).length, 4);
assert.ok(before.feedback.counts.beta && before.feedback.counts.customer);
const race = await Promise.all([advance(a, 1), advance(a, 1)]);
assert.deepEqual(race, [{ step: 2 }, { step: 2 }]);
const after = await json(a, '/api/dashboard');
assert.equal(after.messages.length, 9);
assert.deepEqual(await json(b, '/api/dashboard'), before);
assert.equal((await request(b, '/api/messages/' + after.messages[0].id)).status, 404);
const ops = await json(a, '/api/operations');
for (const surface of ['cloudflare', 'azure', 'godaddy', 'lemonsqueezy', 'recovery'])
  assert.equal(ops.surfaces[surface].latest.status, 'ok');
assert.ok(ops.surfaces.recovery.latest.data.automation.aiUsage.today.calls > 0);
assert.equal((await json(a, '/api/drive-storage')).history.length, 2);
assert.equal((await json(a, '/api/backup-catalog')).libraries.length, 3);
const previous = await json(b, '/api/backups');
assert.equal(
  (await json(a, '/api/backups', { method: 'POST', headers: { Origin: base } })).state,
  'running',
);
assert.deepEqual(await json(b, '/api/backups'), previous);
const file = (await json(a, '/api/releases')).installers[0];
assert.equal((await json(a, file.url)).filename, file.filename);
assert.equal(
  (await request(a, '/api/n8n/messages', { method: 'POST', headers: { Origin: base } })).status,
  403,
);
assert.equal(
  (
    await request(a, '/api/demo/events', {
      method: 'POST',
      headers: { origin: 'https://example.invalid', 'if-match': '2' },
    })
  ).status,
  401,
);
assert.equal((await fetch(base + '/api/dashboard')).status, 401);
assert.equal(
  (await request(a.replace(/.$/, a.endsWith('a') ? 'b' : 'a'), '/api/dashboard')).status,
  401,
);
await new Promise((resolve) => setTimeout(resolve, 4100));
assert.equal((await json(a, '/api/backups')).state, 'succeeded');
console.log(
  'Verified provider delivery through n8n, all dashboard feeds, isolated visitors, safe retries and simulated backup completion.',
);
