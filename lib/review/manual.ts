import { randomUUID, randomBytes } from 'node:crypto';
import { labDb, runFor, hash } from '@/lib/security-lab/store';
import { demoAccounts } from '@/lib/demo-permissions';
import {
  demoEnabled,
  workspaceId,
  demoOriginAllowed,
  demoScheme,
  attackHost,
} from '@/lib/demo-session';
import { currentAccount, boundIdentity } from '@/lib/demo-login';
import { exerciseByNumber, type Exercise } from '@/lib/security-lab/catalog';
import { responseFacts } from './facts';
import type { ReviewReport } from './report';

const names = new Set([
  'tools/list',
  'tools/call',
  'mail_read',
  'refund_request',
  'initialize',
  'enroll',
  'activate',
  'login',
  'logout',
  'record',
  'change',
]);
type Receipt = {
  id: string;
  at: string;
  actor: string;
  role: string;
  operation: string;
  http: number;
  facts: string[];
};
export function receipts(w: string, actor: string, all: boolean): Receipt[] {
  return labDb()
    .prepare(
      'SELECT payload FROM review_receipts WHERE w=? AND (? OR actor=?) ORDER BY seq',
    )
    .all(w, Number(all), actor)
    .map((r) => JSON.parse(String(r.payload)));
}
// Polls refresh the dashboard continuously. Keep receipts for deliberate reads and
// writes on the operational screens used by the account and revocation exercises.
export function observedOperations(req: Request, handler: (req: Request) => Response | Promise<Response>) {
  const url = new URL(req.url);
  const deployment = url.pathname === '/api/operations' && url.search === '?surface=cloudflare';
  const storage = url.pathname === '/api/backups' || url.pathname === '/api/backup-catalog';
  const explicitRead = req.method === 'GET' && req.headers.get('X-SecDash-Review') === '1';
  const preview = url.pathname === '/api/demo/deployments';
  if (((deployment || storage || preview) && explicitRead) || ((storage || preview) && req.method === 'POST'))
    return observed(req, handler, true);
  return handler(req);
}

// Label the submitted operation separately from the actor, status and outcome, which
// come from the authenticated session, actual response and server-side ledger.
export async function observed(
  req: Request,
  handler: (req: Request) => Response | Promise<Response>,
  operational = false,
) {
  if (!demoEnabled()) return handler(req);
  const path = new URL(req.url).pathname;
  let w = demoOriginAllowed(req) && workspaceId(req);
  let actor = w ? currentAccount(req) : undefined;
  if (path.endsWith('/mcp')) {
    const bearer = req.headers
      .get('authorization')
      ?.match(/^Bearer ([A-Za-z0-9_.-]{1,2048})$/)?.[1];
    // A valid resource token can belong to a different workspace than a browser cookie.
    const grant =
      bearer &&
      labDb()
        .prepare(
          'SELECT w,actor,binding FROM grants WHERE access=? AND aud=? AND access_end>? AND expires>?',
        )
        .get(
          hash(bearer),
          demoScheme() + req.headers.get('host') + '/api/demo/mcp',
          Date.now(),
          Date.now(),
        );
    if (grant) {
      w = String(grant.w);
      actor = boundIdentity(w, String(grant.actor), String(grant.binding));
    }
  }
  const row = w && runFor(w);
  if (!w || !row) return handler(req);
  const exercise = exerciseByNumber(Number(row.n));
  if (!exercise || (operational && (!actor || ![1, 5, 6].includes(exercise.n)))) return handler(req);
  const body =
    req.method === 'POST' && (path.endsWith('/lab') || path.endsWith('/mcp'))
      ? ((await req
          .clone()
          .json()
          .catch(() => null)) as {
          action?: string;
          operation?: string;
          method?: string;
          params?: { name?: string };
        } | null)
      : null;
  let action = operational && path === '/api/operations' ? 'cloudflare' : '';
  if (body?.action && exercise.actions.includes(body.action))
    action = body.action;
  if (action === 'staff' && body?.operation && names.has(body.operation))
    action += '.' + body.operation;
  if (path.endsWith('/mcp') && body?.method && names.has(body.method))
    action = [
      body.method,
      body.params?.name && names.has(body.params.name) ? body.params.name : '',
    ]
      .filter(Boolean)
      .join(' ');
  const response = await handler(req);
  const data = await response
    .clone()
    .json()
    .catch(() => null);
  const facts = responseFacts(path, data, exercise.n);
  const signedIn = data as { account?: { id: string; role: string } } | null;
  const account =
    actor ||
    (path.endsWith('/session') && req.method === 'POST'
      ? signedIn?.account
      : null);
  const principal = account?.id || 'reviewer';
  const after = runFor(w);
  const paymentActions = [
    'ledger',
    'submit',
    'approve',
    'settle',
    'outage',
    'interrupt',
    'mutant',
    'control',
  ];
  if (
    after &&
    exercise.actions.includes('ledger') &&
    (paymentActions.includes(action) ||
      action === 'tools/call refund_request') &&
    actor
  )
    facts.push(
      'Ledger after request: ' +
        after.payment +
        '; provider refunds=' +
        after.receipt,
    );
  if (
    after &&
    actor &&
    exercise.actions.includes('ledger') &&
    paymentActions.includes(action)
  )
    response.headers.set(
      'X-SecDash-Ledger',
      String(after.payment) + '; provider refunds=' + after.receipt,
    );
  if (account)
    response.headers.set(
      'X-SecDash-Principal',
      account.id + ' / ' + account.role,
    );
  const receipt: Receipt = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: principal,
    role: account?.role || 'No dashboard login',
    operation: [req.method, path, action].filter(Boolean).join(' '),
    http: response.status,
    facts,
  };
  storeReceipt(w, receipt);
  response.headers.set('X-SecDash-Receipt', receipt.id);
  return response;
}
function storeReceipt(w: string, receipt: Receipt) {
  const db = labDb();
  db.prepare('INSERT INTO review_receipts(w,actor,payload) VALUES(?,?,?)').run(
    w,
    receipt.actor,
    JSON.stringify(receipt),
  );
  db.prepare(
    'DELETE FROM review_receipts WHERE w=? AND seq<(SELECT seq FROM review_receipts WHERE w=? ORDER BY seq DESC LIMIT 1 OFFSET 499)',
  ).run(w, w);
}
// The outside page gets an opaque correlation handle for two refused requests. It confers no access.
export function outsideProof(w: string, actor: string) {
  const key = randomBytes(20).toString('hex');
  labDb()
    .prepare(
      'INSERT OR REPLACE INTO review_probes(w,actor,handle) VALUES(?,?,?)',
    )
    .run(w, actor, key);
  return key;
}
export function recordOutsideDenial(req: Request, response: Response) {
  const url = new URL(req.url),
    key = url.searchParams.get('probe');
  if (
    !key ||
    !/^[a-f0-9]{40}$/.test(key) ||
    (req.headers.get('origin') !== demoScheme() + attackHost() &&
      !(
        req.headers.get('origin') === 'null' &&
        ['same-site', 'cross-site'].includes(
          req.headers.get('sec-fetch-site') || '',
        )
      )) ||
    !['POST', 'OPTIONS'].includes(req.method)
  )
    return;
  const row = labDb()
    .prepare('SELECT w,actor FROM review_probes WHERE handle=?')
    .get(key);
  const run = row && runFor(String(row.w));
  if (!run || run.n !== 17) return;
  const receipt = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: String(row.actor),
    role: 'Outside origin (no authenticated caller)',
    operation: req.method + ' /api/demo/lab',
    http: response.status,
    facts: [
      'Cross-origin request stopped at the authorization boundary.',
      'Ledger observed: ' + run.payment + '; provider refunds=' + run.receipt,
    ],
  };
  storeReceipt(String(row.w), receipt);
  response.headers.set('X-SecDash-Receipt', receipt.id);
}
// A disabled member can still ask its own host for session status. Preserve the
// first signed-out response for the Owner without filling the log on every poll.
export function memberEnded(w: string, response: Response) {
  if (runFor(w)?.n !== 6) return response;
  const db = labDb();
  if (
    db
      .prepare(
        "SELECT 1 FROM review_receipts WHERE w=? AND actor='signed-out-member' LIMIT 1",
      )
      .get(w)
  )
    return response;
  const receipt: Receipt = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: 'signed-out-member',
    role: 'No active member session',
    operation: 'GET /api/demo/session',
    http: response.status,
    facts: ['account=null; memberTab=true; sign-in choices=0'],
  };
  storeReceipt(w, receipt);
  response.headers.set('X-SecDash-Receipt', receipt.id);
  return response;
}
export function launchHeaderReceipt(req: Request, response: Response) {
  const w = demoOriginAllowed(req) && workspaceId(req);
  if (!w || runFor(w)?.n !== 8) return response;
  const names = [
    'content-security-policy',
    'referrer-policy',
    'x-content-type-options',
    'x-frame-options',
  ];
  const receipt: Receipt = {
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: 'reviewer',
    role: 'Evidence viewer',
    operation: 'HEAD /launch',
    http: response.status,
    facts: names.map(
      (name) =>
        name +
        ' = ' +
        (response.headers.get(name) || 'absent').replace(
          /'nonce-[^']+'/g,
          "'nonce-[redacted]'",
        ),
    ),
  };
  storeReceipt(w, receipt);
  response.headers.set('X-SecDash-Receipt', receipt.id);
  return response;
}
export function manualReport(
  ex: Exercise,
  w: string,
  viewer: string,
  role: string,
  revision: string,
): ReviewReport {
  const items = receipts(w, viewer, role === 'Owner');
  return {
    title: 'Exercise ' + ex.n + ' - ' + ex.title,
    revision,
    generated: new Date().toISOString(),
    introduction: ex.question,
    sections: [
      {
        title: 'Evidence scope',
        lines: [
          ex.guide,
          'Recorded ' +
            items.length +
            ' backend responses. The HTTP codes identify request outcomes; this visitor-led report makes no automatic pass determination.',
          'Verification policy and test mapping: https://github.com/k-mc-martin/example-dashboard/blob/' +
            (/^[a-f0-9]{40}$/.test(revision) ? revision : 'main') +
            '/docs/security/campaign/README.md',
          role === 'Owner'
            ? 'Includes all recorded exercise identities in this visitor workspace.'
            : 'Includes responses for this identity in this visitor workspace.',
          'Each receipt was written by the dashboard backend when it handled the request. The HTTP status and redacted response fields below came from that response. Ledger observations are database reads after handling the request. The newest 500 receipts are retained per workspace. Requests blocked before a workspace is identified cannot be attributed here.',
        ],
      },
      ...(items.length
        ? items.map((r, i) => ({
            title: i + 1 + '. ' + r.operation,
            lines: [
              r.at +
                ' | ' +
                (demoAccounts.find((a) => a.id === r.actor)?.name ||
                  'Visitor') +
                ' | ' +
                r.role +
                ' | HTTP ' +
                r.http,
              'Receipt ' + r.id,
              ...r.facts,
            ],
          }))
        : [
            {
              title: 'No recorded responses',
              lines: [
                'Perform an action in this exercise and download the report again.',
              ],
            },
          ]),
    ],
  };
}
