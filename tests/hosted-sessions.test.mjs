import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { demoCookie, demoOriginAllowed, newDemoCookie, signedWorkspace } from '../lib/demo-session.ts';
import { createMemberTab, currentAccount, enterMemberTab, loginCookie, revokeLogin } from '../lib/demo-login.ts';

test('HTTPS member sessions on shared DNS names remain independent across visitors', t => {
  const dir = mkdtempSync(join(tmpdir(), 'secdash-https-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  process.env.SECDASH_PUBLIC_HOST = 'review.example';
  process.env.SECDASH_MEMBER_DOMAIN = 'members.example';
  process.env.SECDASH_WORKSPACES = dir;
  process.env.SECDASH_SESSION_SECRET = randomBytes(32).toString('hex');
  const first = newDemoCookie().split('.')[0];
  const second = newDemoCookie().split('.')[0];
  const one = createMemberTab(first, 'mira');
  const two = createMemberTab(second, 'mira');
  assert.equal(one.host, 'mira.members.example');
  assert.equal(two.host, one.host);
  assert.equal(enterMemberTab('theo.members.example', one.ticket), undefined);
  const a = enterMemberTab(one.host, one.ticket);
  const b = enterMemberTab(two.host, two.ticket);
  assert.equal(a.workspace, first);
  assert.equal(b.workspace, second);
  assert.equal(enterMemberTab(one.host, one.ticket), undefined);
  const request = (workspace, token, origin = 'https://' + one.host) =>
    new Request('https://' + one.host + '/api/demo/session', { method: 'DELETE', headers: {
      host: one.host, origin, cookie: demoCookie + '=' + signedWorkspace(workspace, one.host) + '; ' + loginCookie + '=' + token,
    } });
  const firstLogin = request(first, a.token);
  const secondLogin = request(second, b.token);
  assert.equal(demoOriginAllowed(firstLogin), true);
  assert.equal(demoOriginAllowed(request(first, a.token, 'http://' + one.host)), false);
  assert.equal(demoOriginAllowed(request(first, a.token, 'https://review.example')), false);
  assert.equal(currentAccount(firstLogin)?.id, 'mira');
  assert.equal(currentAccount(request(first, b.token)), undefined);
  revokeLogin(firstLogin, first);
  assert.equal(currentAccount(firstLogin), undefined);
  assert.equal(currentAccount(secondLogin)?.id, 'mira');
});
