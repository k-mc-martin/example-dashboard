import { request as nodeRequest } from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from './account-evidence-cases.mjs';
import { base, visitor, json, request, postLogin, signIn, signOut } from './demo-http-client.mjs';

test(cases.roles.test, async () => {
  const workspace = await visitor();
  const status = async (cookie, path, expected, options) => {
    assert.equal((await request(cookie, path, options)).status, expected, path);
  };
  await status(workspace, '/api/dashboard', 401);
  const observer = await signIn(workspace, 'Owner');
  await json(observer, '/api/demo/events', { method: 'POST', headers: { Origin: base, 'If-Match': '0' } });
  const initialBackup = await json(observer, '/api/backups');
  await signOut(observer);
  let messages;
  for (const role of ['Employee', 'Administrator', 'Owner']) {
    const cookie = await signIn(workspace, role);
    const storage = role !== 'Employee', owner = role === 'Owner';
    assert.equal((await json(cookie, '/api/demo/session')).choices, undefined);
    const dashboard = await json(cookie, '/api/dashboard');
    assert.ok(dashboard.messages.length);
    if (messages) assert.deepEqual(dashboard.messages, messages);
    messages = dashboard.messages;
    for (const path of ['/api/releases','/api/feedback', '/api/demo/artifact?platform=Mac', '/api/messages/' + messages[0].id])
      await status(cookie, path, 200);
    for (const [channel, destination] of [['public', 'https://scalaeon.com/'], ['beta', 'https://beta.scalaeon.com/']]) {
      const link = await request(cookie, '/api/demo/site?channel=' + channel, { redirect: 'manual' });
      assert.equal(link.status, 302);
      assert.equal(link.headers.get('location'), destination);
    }
    for (const path of ['/api/drive-storage', '/api/backup-catalog', '/api/backups', '/api/operations?surface=cloudflare', '/api/operations?surface=recovery'])
      await status(cookie, path, storage ? 200 : 403);
    for (const path of ['/api/health', '/api/attention-dismissals','/api/operations','/api/operations?surface=azure','/api/operations?surface=lemonsqueezy','/api/operations?surface=godaddy'])
      await status(cookie, path, owner ? 200 : 403);
    await status(cookie, '/api/operations?surface=recovery&surface=azure', 403);
    await status(cookie, '/api/operations?surface=unknown', 403);
    const backupBefore = storage ? await json(cookie, '/api/backups') : undefined;
    if (role === 'Administrator') assert.deepEqual(backupBefore, initialBackup, 'Denied employee action had no effect');
    await status(cookie, '/api/backups', storage ? 200 : 403, {method: 'POST', headers: { Origin: base }});
    await status(cookie, '/api/n8n/operations', 403, {method: 'POST', headers: {Origin: base}});
    await signOut(cookie);
    await status(cookie, '/api/dashboard', 401);
  }
});

test(cases.login.test, async () => {
  const [a, b] = await Promise.all([visitor(), visitor()]);
  const { choices } = await json(a, '/api/demo/session');
  const [employee, , owner] = choices;
  for (const body of [{role:'Owner'}, {id:owner.id, pass:employee.pass}, {id:employee.id, pass:employee.pass, role:'Owner'}])
    assert.equal((await postLogin(a, body)).status, 401);
  assert.equal((await postLogin(b, {id:owner.id, pass:owner.pass})).status, 401);
  const high = await signIn(a, 'Owner');
  const other = await signIn(b, 'Employee');
  assert.equal((await postLogin(high, {id:employee.id, pass:employee.pass})).status, 409);
  assert.equal((await postLogin(a, {id:employee.id, pass:employee.pass})).status, 401);
  assert.equal((await request(a, '/api/demo/session')).status, 401);
  const recovery = await request(a, '/');
  const replacement = recovery.headers.get('set-cookie')?.split(';')[0];
  assert.match(replacement, /^__Host-secdash_workspace=/);
  assert.notEqual(replacement, a);
  const fresh = await signIn(replacement, 'Owner');
  assert.deepEqual((await json(fresh, '/api/dashboard')).messages, []);
  await signOut(fresh);
  const staleLogout = await request(a, '/api/demo/session', {method:'DELETE', headers:{Origin:base}});
  assert.equal(staleLogout.status, 401);
  assert.equal(staleLogout.headers.get('set-cookie'), null);
  assert.equal((await request(b + '; ' + high.split('; ')[1], '/api/health')).status, 401);
  assert.equal((await request(other + '; role=Owner', '/api/health', {headers:{'X-Role':'Owner'}})).status, 403);
  assert.equal((await request(high, '/api/demo/session', {method:'DELETE',headers:{Origin:'https://untrusted.invalid'}})).status, 401);
  assert.equal((await request(high, '/api/demo/session', {method:'DELETE'})).status, 401);
  await json(high, '/api/health');
  await json(high, '/api/demo/events', {method:'POST',headers:{Origin:base,'If-Match':'0'}});
  const { messages } = await json(high, '/api/dashboard');
  assert.equal((await request(other, '/api/messages/' + messages[0].id)).status, 404);
  assert.deepEqual((await json(other, '/api/dashboard')).messages, []);
  await signOut(high);
  const low = await signIn(a, 'Employee');
  assert.notEqual(high, low);
  assert.equal((await request(high, '/api/health')).status, 401);
  assert.equal((await request(low, '/api/health')).status, 403);
  await json(low, '/api/messages/' + messages[0].id);
  await signOut(low);
  await signOut(other);
});

function checkInboxFields(dashboard, owner) {
  assert.equal('providerConnections' in dashboard, owner, 'Provider account inventory must be owner-only');
  assert.equal('attentionFeedbackObstructions' in dashboard, owner);
}

test(cases.fields.test, async () => {
  const workspace = await visitor();
  for (const role of ['Employee', 'Administrator', 'Owner']) {
    const cookie = await signIn(workspace, role);
    if (role === 'Employee') await json(cookie, '/api/demo/events', {method:'POST', headers:{Origin:base,'If-Match':'0'}});
    const owner = role === 'Owner', storage = role !== 'Employee';
    checkInboxFields(await json(cookie, '/api/dashboard'), owner);
    if (storage) {
      const recovery = (await json(cookie, '/api/operations?surface=recovery')).surfaces;
      assert.deepEqual(Object.keys(recovery), ['recovery']);
      assert.ok(recovery.recovery.latestSuccess.data.backupFolder);
      assert.doesNotMatch(JSON.stringify(recovery), /"automation"|"latestAiUsage"|"aiUsage"/);
      const edge = (await json(cookie, '/api/operations?surface=cloudflare')).surfaces;
      assert.deepEqual(Object.keys(edge), ['cloudflare']);
      assert.ok(edge.cloudflare.latestSuccess.data.pages.length);
    }
    if (owner) assert.ok((await json(cookie, '/api/operations')).surfaces.recovery.latestSuccess.data.automation);
    await signOut(cookie);
  }
});

test(cases.isolation.test, async () => {
  const first = await signIn(await visitor(), 'Owner');
  const second = await signIn(await visitor(), 'Owner');
  await json(first, '/api/demo/events', {method:'POST',headers:{Origin:base,'If-Match':'0'}});
  const {messages} = await json(first, '/api/dashboard');
  await json(first, '/api/messages/' + messages[0].id);
  assert.equal((await request(second, '/api/messages/' + messages[0].id)).status, 404);
  assert.deepEqual((await json(second, '/api/dashboard')).messages, []);
  await signOut(first);
  await json(second, '/api/health');
  await signOut(second);
});

test(cases.cookies.test, async () => {
  const workspace = await visitor();
  // The client checks both Set-Cookie headers, including the names, attributes and lack of a Domain.
  const cookie = await signIn(workspace, 'Employee');
  await json(cookie, '/api/dashboard');
  await signOut(cookie);
});

test(cases.fault.test, async () => {
  const cookie = await signIn(await visitor(), 'Employee');
  const normal = await json(cookie, '/api/dashboard');
  checkInboxFields(normal, false);
  const faulty = { ...normal, providerConnections: { sample: {} } };
  assert.throws(() => checkInboxFields(faulty, false), {code:'ERR_ASSERTION', message:/Provider account inventory must be owner-only/});
  await signOut(cookie);
});

test(cases.memberTabs.test, async () => {
  const owner = await signIn(await visitor(), 'Owner');
  const other = await signIn(await visitor(), 'Owner');
  await json(owner, '/api/demo/events', { method: 'POST', headers: { Origin: base, 'If-Match': '0' } });
  const edit = (cookie, account) => request(cookie, '/api/demo/teams', {
    method: 'PUT', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(account),
  });
  const { members } = await json(owner, '/api/demo/teams');
  const mira = members.find(member => member.id === 'mira');
  const form = await request(owner, '/api/demo/member-tab', {
    method: 'POST', headers: { Origin: base }, body: new URLSearchParams({ member: mira.id }),
  });
  assert.equal(form.status, 200);
  // Chrome suppresses the source Origin for the cross-host form if the launch page only allows same-origin referrers.
  assert.equal(form.headers.get('referrer-policy'), 'origin');
  const html = await form.text();
  const address = new URL(html.match(/action="([^"]+)"/)[1]);
  const ticket = html.match(/name="ticket" value="([a-f0-9]{64})"/)[1];
  // Send the real member Host over loopback, independently of the test runner's wildcard DNS resolver.
  const memberRequest = (cookie, path, options = {}) => new Promise((resolve, reject) => {
    const req = nodeRequest(new URL(path, base), { method: options.method ?? 'GET', headers: {
      Host: address.host, Cookie: cookie, ...options.headers,
    } }, response => {
      const parts = [];
      response.on('data', chunk => parts.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(parts).toString(), headers: response.headers }));
    });
    req.on('error', reject); req.end(options.body);
  });
  const enter = { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'ticket=' + ticket };
  assert.equal((await memberRequest('', address.pathname, { ...enter, headers: { ...enter.headers, Origin: 'https://untrusted.invalid' } })).status, 403);
  const joined = await memberRequest('', address.pathname, enter);
  assert.equal(joined.status, 200);
  assert.equal((await memberRequest('', address.pathname, enter)).status, 403);
  const cookies = joined.headers['set-cookie'].map(field => field.split(';')[0]).join('; ');
  const edge = '/api/operations?surface=cloudflare';
  const backup = { method: 'POST', headers: { Origin: address.origin } };
  const readMember = async path => JSON.parse((await memberRequest(cookies, path)).text);
  const writeMember = opts => memberRequest(cookies, '/api/demo/teams', opts);
  assert.equal((await readMember('/api/demo/session')).account.id, mira.id);
  assert.deepEqual((await readMember('/api/dashboard')).messages, (await json(owner, '/api/dashboard')).messages);
  assert.equal((await memberRequest(cookies, edge)).status, 403);
  assert.equal((await memberRequest(cookies, '/api/demo/teams')).status, 403);
  assert.equal((await writeMember({ method: 'PUT', headers: { Origin: address.origin } })).status, 403);
  assert.equal((await request(cookies, '/api/demo/teams')).status, 401);
  assert.equal((await memberRequest(owner, '/api/demo/teams')).status, 401);
  assert.equal((await edit(owner, { ...mira, role: 'Owner' })).status, 400);
  const grants = { ...mira, role: 'Administrator', permissions: { deployments: true, storage: true, startBackup: true, syncBackups: true } };
  assert.equal((await edit(owner, grants)).status, 200);
  assert.equal((await memberRequest(cookies, edge)).status, 200);
  assert.equal((await readMember('/api/demo/session')).account.role, 'Administrator');
  assert.equal((await edit(owner, { ...mira, permissions: { ...mira.permissions, storage: true } })).status, 200);
  assert.equal((await memberRequest(cookies, edge)).status, 403);
  const before = (await memberRequest(cookies, '/api/backups')).text;
  const libraryBefore = (await memberRequest(cookies, '/api/backup-catalog')).text;
  assert.equal(JSON.parse(before).state, 'succeeded');
  assert.equal((await memberRequest(cookies, edge, { headers: { 'X-Role': 'Owner' } })).status, 403);
  assert.equal((await memberRequest(cookies, '/api/backups', backup)).status, 403);
  assert.equal((await memberRequest(cookies, '/api/backup-catalog', { ...backup, body: '{"action":"sync"}' })).status, 403);
  assert.equal((await memberRequest(cookies, '/api/backups')).text, before);
  assert.equal((await memberRequest(cookies, '/api/backup-catalog')).text, libraryBefore);
  const onlyBackup = { ...mira, permissions: { ...mira.permissions, storage: true, startBackup: true } };
  assert.equal((await edit(owner, onlyBackup)).status, 200);
  const started = await memberRequest(cookies, '/api/backups', backup);
  assert.equal(started.status, 200);
  assert.equal(JSON.parse(started.text).state, 'running');
  assert.equal((await memberRequest(cookies, '/api/backup-catalog')).text, libraryBefore);
  const onlySync = { ...mira, permissions: { ...mira.permissions, storage: true, syncBackups: true } };
  assert.equal((await edit(owner, onlySync)).status, 200);
  const synced = await memberRequest(cookies, '/api/backup-catalog', { ...backup, body: '{"action":"sync"}' });
  assert.equal(synced.status, 200);
  assert.equal(JSON.parse(synced.text).update.state, 'running');
  assert.equal((await readMember('/api/backups')).jobId, JSON.parse(started.text).jobId);
  assert.deepEqual((await json(other, '/api/demo/teams')).members, members);
  await signOut(owner);
  assert.equal((await memberRequest(cookies, '/api/dashboard')).status, 200);
  assert.equal((await request(cookies, '/api/demo/session')).status, 401);
  assert.equal((await memberRequest(cookies, '/api/demo/session', { method: 'DELETE', headers: { Origin: address.origin } })).status, 200);
  assert.equal((await memberRequest(cookies, '/api/dashboard')).status, 401);
  await signOut(other);
});
