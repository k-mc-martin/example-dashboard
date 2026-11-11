import assert from 'node:assert/strict';

export const base = 'http://127.0.0.1:' + (process.env.DUPDASH_DEMO_PORT || '5286');
export const request = (cookie, path, options = {}) =>
  fetch(base + path, { ...options, headers: { cookie, ...options.headers } });
export async function json(cookie, path, options = {}) {
  const response = await request(cookie, path, options);
  assert.ok(response.ok, path + ' returned ' + response.status);
  return response.json();
}
export async function visitor() {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  return readCookie(response, '__Host-dupdash_workspace');
}
function readCookie(response, name) {
  const header = response.headers.getSetCookie().find(value => value.startsWith(name + '='));
  assert.ok(header, 'Expected demo cookie ' + name);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=strict', 'Path=/'])
    assert.ok(header.toLowerCase().includes(flag.toLowerCase()), 'Missing flag ' + flag);
  assert.equal(/;\s*domain=/i.test(header), false);
  return header.split(';')[0];
}
export function postLogin(workspace, body) {
  return request(workspace, '/api/demo/session', { method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
export async function signIn(workspace, role) {
  const { choices } = await json(workspace, '/api/demo/session');
  const { id, pass } = choices.find(choice => choice.role === role);
  const response = await postLogin(workspace, { id, pass });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).account.role, role);
  return workspace + '; ' + readCookie(response, '__Host-dupdash_login');
}
export async function signOut(cookie) {
  const response = await request(cookie, '/api/demo/session', { method: 'DELETE', headers: { Origin: base } });
  assert.equal(response.status, 200);
}
