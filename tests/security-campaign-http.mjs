import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  base,
  visitor,
  request,
  signIn,
  signOut,
} from './demo-http-client.mjs';
const cookie = (r, k) =>
  r.headers
    .getSetCookie()
    .find((v) => v.startsWith(k + '='))
    ?.split(';')[0];
const post = (s, path, body, extra = {}) =>
  request(s, path, {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
async function run(n) {
  const old = await visitor(),
    r = await post(old, '/api/demo/exercise', { exercise: n });
  assert.equal(r.status, 200);
  return cookie(r, '__Host-secdash_workspace');
}
async function lab(s, action, fields = {}, expected = 200) {
  const r = await post(s, '/api/demo/lab', { action, ...fields });
  assert.equal(
    r.status,
    expected,
    action + ': expected ' + expected + ', received ' + r.status,
  );
  return r.json();
}
async function role(n, r = 'Owner') {
  const w = await run(n);
  return { w, s: await signIn(w, r) };
}
test('Independent exercise runs enforce row and field access; reject valid privileged operations', async () => {
  const { w, s } = await role(2, 'Employee');
  const mine = await lab(s, 'mine');
  assert.equal(mine.assigned, 'mira');
  assert.equal('billingReference' in mine, false);
  await lab(s, 'other', {}, 404);
  await lab(s, 'submit');
  await lab(s, 'approve', {}, 403);
  assert.equal((await lab(s, 'ledger')).state, 'submitted');
  await signOut(s);
  const owner = await signIn(w, 'Owner');
  assert.ok((await lab(owner, 'other')).billingReference);
  await lab(owner, 'approve');
  const switched = await post(owner, '/api/demo/exercise', { exercise: 19 });
  assert.equal(switched.status, 200);
  assert.equal(
    (await post(owner, '/api/demo/lab', { action: 'mine' })).status,
    401,
  );
  assert.equal((await request(w, '/api/demo/session')).status, 401);
  const fresh = await signIn(
    cookie(switched, '__Host-secdash_workspace'),
    'Owner',
  );
  assert.equal((await lab(fresh, 'ledger')).state, 'open');
  await lab(fresh, 'settle', {}, 409);
});
test('Preview launch is workspace-bound and requires deployment access and an authorized role', async () => {
  const { w, s: owner } = await role(1);
  const path = '/api/demo/deployments';
  assert.equal((await post(owner, '/api/demo/events', {}, { 'If-Match': '0' })).status, 200);
  const { version } = await (await request(owner, '/api/releases')).json();
  const { members } = await (await request(owner, '/api/demo/teams')).json();
  const grant = async (id, deployments) => {
    const member = members.find(m => m.id === id);
    const edit = await request(owner, '/api/demo/teams', {
      method: 'PUT', headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, role: member.role, permissions: { ...member.permissions, deployments } }),
    });
    assert.equal(edit.status, 200);
  };
  await grant('mira', true);
  await grant('theo', false);
  await signOut(owner);
  const mira = await signIn(w, 'Employee');
  assert.equal((await request(mira, path)).status, 200);
  assert.equal((await post(mira, path, { version }, { 'X-Role': 'Owner' })).status, 403);
  await signOut(mira);
  const theo = await signIn(w, 'Administrator');
  assert.equal((await request(theo, path)).status, 403);
  assert.equal((await post(theo, path, { version })).status, 403);
  await signOut(theo);
  const inez = await signIn(w, 'Owner');
  assert.equal((await post(inez, path, { version, environment: 'production' })).status, 400);
  assert.equal((await post(inez, path, { version: '9.9.9' })).status, 409);
  assert.equal((await post(inez, path, { version }, { Origin: 'https://outside.invalid' })).status, 401);
  assert.equal((await (await request(inez, path)).json()).deploymentCount, 0);
  assert.equal((await post(inez, path, { version })).status, 201);
  assert.equal((await (await request(inez, path)).json()).current.launchedBy, 'Inez Park');
  const independent = await role(1, 'Administrator');
  assert.equal((await (await request(independent.s, path)).json()).deploymentCount, 0);
});
test('Concurrent approval and interrupted delivery record one receipt; audit and fault detection retain scope', async () => {
  const { s } = await role(5);
  await lab(s, 'submit');
  const batch = await Promise.all(
    Array.from({ length: 4 }, () =>
      post(s, '/api/demo/lab', { action: 'approve' }),
    ),
  );
  assert.deepEqual(batch.map((r) => r.status).sort(), [200, 409, 409, 409]);
  assert.equal(
    (await lab(s, 'audit')).events.filter((x) => x.action === 'approve').length,
    4,
  );
  const r = (await role(7)).s;
  await lab(r, 'submit');
  await lab(r, 'approve');
  await lab(r, 'outage', {}, 503);
  assert.equal((await lab(r, 'ledger')).providerRefunds, 0);
  await lab(r, 'interrupt', {}, 504);
  assert.equal((await lab(r, 'settle')).replayed, true);
  assert.equal((await lab(r, 'ledger')).providerRefunds, 1);
  const f = (await role(9)).s;
  assert.equal((await lab(f, 'control')).duplicates, 0);
  assert.equal((await lab(f, 'mutant')).duplicates, 1);
  await lab(f, 'settle', {}, 403);
});
test('Tenant isolation, bound query, inert preview, strict payload, form and preflight', async () => {
  const first = (await role(14)).s,
    second = (await role(14)).s;
  const { id } = await lab(first, 'mine');
  await lab(first, 'lookup', { id });
  await lab(second, 'lookup', { id }, 404);
  const { s } = await role(16);
  assert.equal(
    (await lab(s, 'search', { text: "' OR 1=1 --" })).matches.length,
    0,
  );
  assert.equal((await lab(s, 'search', { text: 'Fern' })).matches.length, 1);
  const payload = '<img src=x onerror=alert(1)>';
  assert.equal((await lab(s, 'message', { text: payload })).preview, payload);
  await lab(s, 'submit', { amountCents: 1 }, 400);
  assert.equal((await lab(s, 'ledger')).state, 'open');
  const v = (await role(17)).s;
  for (const method of ['POST', 'OPTIONS']) {
    const r = await request(v, '/api/demo/lab', {
      method,
      headers: {
        Origin: 'https://outside.invalid',
        'Sec-Fetch-Site': 'cross-site',
        'Content-Type': 'text/plain',
      },
      ...(method === 'POST' ? { body: 'action=submit' } : {}),
    });
    assert.ok([401, 403, 405].includes(r.status));
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
  assert.equal((await lab(v, 'ledger')).state, 'open');
  await lab(v, 'submit');
});
test('Disable invalidates an issued member login and an unredeemed ticket, including after re-enabling', async () => {
  const { s } = await role(6);
  async function ticket() {
    const r = await request(s, '/api/demo/member-tab', {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'member=mira',
    });
    assert.equal(r.status, 200);
    const html = await r.text();
    return {
      host: new URL(html.match(/action="([^"]+)"/)[1]).host,
      ticket: html.match(/name="ticket" value="([^"]+)"/)[1],
    };
  }
  function memberRequest(host, path, method, headers, body) {
    return new Promise((resolve, reject) => {
      const r = http.request(
        base + path,
        { method, headers: { ...headers, Host: host } },
        (res) => {
          res.resume();
          resolve({
            status: res.statusCode,
            cookies: res.headers['set-cookie'] || [],
          });
        },
      );
      r.on('error', reject);
      r.end(body);
    });
  }
  const redeem = (t) =>
    memberRequest(
      t.host,
      '/api/demo/enter',
      'POST',
      { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' },
      'ticket=' + t.ticket,
    );
  const one = await ticket(),
    two = await ticket(),
    opened = await redeem(one);
  assert.equal(opened.status, 200);
  const member = opened.cookies.map((x) => x.split(';')[0]).join('; ');
  const read = () =>
    memberRequest(one.host, '/api/dashboard', 'GET', { Cookie: member });
  assert.equal((await read()).status, 200);
  await lab(s, 'disable');
  assert.equal((await read()).status, 401);
  await lab(s, 'enable');
  assert.equal((await read()).status, 401);
  assert.ok((await redeem(two)).status >= 400);
});
test('Staff activation, exact password handling, blocklist, rotation, throttling and revoked session', async () => {
  const { s } = await role(18);
  const cred = randomBytes(18).toString('hex') + ' é';
  const exec = (s, operation, fields = {}) =>
    post(s, '/api/demo/lab', { action: 'staff', operation, ...fields });
  const { activation: code } = await (await exec(s, 'enroll')).json();
  assert.equal(
    (await exec(s, 'activate', { code, next: 'password' })).status,
    400,
  );
  assert.equal((await exec(s, 'activate', { code, next: cred })).status, 200);
  assert.equal((await exec(s, 'activate', { code, next: cred })).status, 401);
  assert.equal((await exec(s, 'record')).status, 401);
  assert.equal(
    (await exec(s, 'login', { password: cred.trimEnd().toUpperCase() })).status,
    401,
  );
  const r = await exec(s, 'login', { password: cred });
  assert.equal(r.status, 200);
  const authed = s + '; ' + cookie(r, '__Host-secdash_staff');
  assert.equal((await exec(authed, 'record')).status, 200);
  assert.equal(
    (await exec(authed, 'change', { password: 'wrong', next: cred + 'a' }))
      .status,
    401,
  );
  assert.equal(
    (await exec(authed, 'change', { password: cred, next: cred + 'a' })).status,
    200,
  );
  assert.equal((await exec(authed, 'record')).status, 401);
  for (let i = 0; i < 5; i++)
    assert.equal((await exec(s, 'login', { password: cred })).status, 401);
  assert.equal((await exec(s, 'login', { password: cred + 'a' })).status, 429);
});
test('Connector enforces PKCE, audience, scope, lifetime, grant reuse, refresh replay and logout', async () => {
  const { s } = await role(4);
  const verifier = randomBytes(32).toString('base64url'),
    client = 'secdash-reviewer',
    redirect = base + '/',
    params = {
      client,
      redirect,
      responseType: 'code',
      audience: base + '/api/demo/mcp',
      challenge: createHash('sha256').update(verifier).digest('base64url'),
      method: 'S256',
      scope: 'mail.read',
    };
  async function issue(short = false) {
    return (await lab(s, 'grant', { ...params, short })).code;
  }
  function trade(code, expected = 200, override = {}) {
    return lab(
      s,
      'exchange',
      {
        grantType: 'authorization_code',
        client,
        redirect,
        credential: code,
        verifier,
        ...override,
      },
      expected,
    );
  }
  const call = (secret, name = 'mail_read') =>
    post(
      '',
      '/api/demo/mcp',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: {} },
      },
      { Authorization: 'Bearer ' + secret },
    );
  await lab(s, 'grant', { ...params, redirect: base + '/else' }, 400);
  await lab(s, 'grant', { ...params, audience: 'upstream' }, 400);
  const code = await issue();
  await trade(code, 400, { verifier: 'x'.repeat(43) });
  const t = await trade(code);
  assert.equal((await call(t.access)).status, 200);
  assert.equal((await call(t.access, 'refund_request')).status, 403);
  await trade(code, 400);
  assert.equal((await call(t.access)).status, 401);
  const u = await trade(await issue());
  const rot = {
    grantType: 'refresh_token',
    client,
    redirect,
    credential: u.refresh,
  };
  const next = await lab(s, 'rotate', rot);
  assert.equal((await call(u.access)).status, 401);
  assert.equal((await call(next.access)).status, 200);
  await lab(s, 'replayRefresh', rot, 400);
  assert.equal((await call(next.access)).status, 401);
  const exp = await trade(await issue(true));
  await new Promise((r) => setTimeout(r, 5100));
  assert.equal((await call(exp.access)).status, 401);
  const z = await trade(await issue());
  await signOut(s);
  assert.equal((await call(z.access)).status, 401);
});
