import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from './account-evidence-cases.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { demoCookie, lifetimeSeconds, newDemoCookie, workspaceId } from '../lib/demo-session.ts';
import { demoAccounts } from '../lib/demo-permissions.ts';
import { currentAccount, demoPass, hasActiveLogin, issueLogin, loginCookie } from '../lib/demo-login.ts';

test(cases.expiry.test, t => {
  const dir = mkdtempSync(join(tmpdir(), 'dupdash-login-test-'));
  process.env.DUPDASH_WORKSPACES = dir;
  process.env.DUPDASH_SESSION_SECRET = randomBytes(32).toString('hex');
  t.after(() => {
    delete process.env.DUPDASH_WORKSPACES;
    delete process.env.DUPDASH_SESSION_SECRET;
    rmSync(dir, { recursive: true, force: true });
  });
  const start = Date.now();
  let now = start;
  t.mock.method(Date, 'now', () => now);
  const cookie = demoCookie + '=' + newDemoCookie();
  const request = (value) => new Request('http://localhost:5286/api/dashboard', {headers:{cookie:value}});
  const id = workspaceId(request(cookie));
  const owner = demoAccounts.find(account => account.role === 'Owner');
  now += (lifetimeSeconds - 1) * 1000;
  const login = issueLogin(id, owner.id, demoPass(id, owner));
  assert.match(login.token, /^[0-9a-f]{64}$/);
  const authenticated = request(cookie + '; ' + loginCookie + '=' + login.token);
  assert.equal(currentAccount(authenticated)?.role, 'Owner');
  now += 1000;
  assert.equal(workspaceId(authenticated), null);
  assert.equal(currentAccount(authenticated), undefined);
  assert.equal(hasActiveLogin(id), false);
});
