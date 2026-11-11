import { writeFileSync, renameSync } from 'node:fs';
import { responseFacts } from '../../lib/review/facts.ts';

const output = process.env.SECDASH_SUITE_OUTPUT;
const cases = [],
  pending = new Set(),
  seen = new WeakSet();
let current;
function publish() {
  if (!output) return;
  writeFileSync(output + '.tmp', JSON.stringify(cases), { mode: 0o600 });
  renameSync(output + '.tmp', output);
}
export function beginCase(n, title, criterion) {
  if (!output) return;
  current = { n, title, criterion, verdict: 'running', records: [] };
  cases.push(current);
  publish();
}
export async function finishCase(passed, note) {
  if (!output) return;
  await Promise.all([...pending]);
  current.verdict = passed ? 'passed' : 'failed';
  if (note) current.note = note;
  if (!current.records.length && passed) {
    current.verdict = 'failed';
    current.note = 'No network evidence was captured.';
  }
  publish();
}
export function observeContext(context) {
  if (!output || seen.has(context)) return;
  seen.add(context);
  const owners = new Map(),
    lastSessions = new Map();
  const exercise = current;
  async function capture(response) {
    const request = response.request(),
      url = new URL(response.url()),
      path = url.pathname,
      method = request.method();
    const headerCheck = path === '/launch' && method === 'HEAD';
    if (
      !headerCheck &&
      ![
        '/api/demo/session',
        '/api/demo/lab',
        '/api/demo/mcp',
        '/api/demo/teams',
        '/api/demo/evidence',
        '/api/demo/enter',
        '/api/demo/member-tab',
        '/version',
      ].includes(path)
    )
      return;
    const identity = owners.get(url.host) || 'Visitor';
    const status = response.status();
    const at = new Date().toISOString();
    let data, timer;
    try {
      if (response.headers()['content-type']?.includes('application/json')) {
        data = await Promise.race([
          response.json(),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(null), 1800);
          }),
        ]);
      }
    } catch {
      /* A form, redirect or refused preflight can have an empty body. */
    }
    clearTimeout(timer);
    let actor = identity;
    if (path.endsWith('/session')) {
      if (data?.account) {
        actor = data.account.name + ' (' + data.account.role + ')';
        owners.set(url.host, actor);
      } else if (data?.account === null) owners.delete(url.host);
      if (method === 'GET') {
        const key = status + ':' + (data?.account?.id || 'signed out');
        if (lastSessions.get(url.host) === key) return;
        lastSessions.set(url.host, key);
      }
    }
    if (path.endsWith('/teams') && method === 'GET') return;
    let body;
    try {
      body = request.postDataJSON();
    } catch {
      /* No structured request. */
    }
    // Only known operation names are eligible for persistence. Never retain request bodies.
    const safe = (v) =>
      typeof v === 'string' && /^[a-zA-Z][a-zA-Z_.\/]{0,32}$/.test(v) ? v : '';
    const operation = [
      safe(body?.action),
      safe(body?.operation),
      safe(body?.method),
      safe(body?.params?.name),
    ]
      .filter(Boolean)
      .join(' ');
    const facts = responseFacts(path, data, exercise.n);
    if (response.headers()['x-secdash-ledger'])
      facts.push(
        'Backend ledger after request: ' +
          response.headers()['x-secdash-ledger'],
      );
    const principal = response.headers()['x-secdash-principal'];
    if (principal) actor = principal;
    else if (
      request.headers().origin &&
      request.headers().origin !== url.origin
    )
      actor = 'Outside origin (no authenticated caller)';
    if (path === '/version' && typeof data?.commit === 'string')
      facts.push('Deployed revision ' + data.commit);
    if (headerCheck)
      for (const name of [
        'strict-transport-security',
        'content-security-policy',
        'x-content-type-options',
        'referrer-policy',
      ]) {
        const value = response.headers()[name];
        facts.push(
          name +
            ' = ' +
            (value || '(absent)').replace(
              /'nonce-[^']+'/g,
              "'nonce-[redacted]'",
            ),
        );
      }
    exercise.records.push({
      at,
      method,
      path,
      operation,
      identity: actor,
      status,
      receipt: response.headers()['x-secdash-receipt'],
      facts,
    });
  }
  context.on('response', (r) => {
    const p = capture(r).catch(() => {
      exercise.note = 'One response could not be inspected.';
    });
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  context.on('requestfailed', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/demo/lab')
      exercise.records.push({
        at: new Date().toISOString(),
        method: r.method(),
        path: url.pathname,
        operation: '',
        identity: owners.get(url.host) || 'Outside origin',
        status: null,
        facts: [
          'Browser transport: ' + (r.failure()?.errorText || 'request failed'),
        ],
      });
  });
}
