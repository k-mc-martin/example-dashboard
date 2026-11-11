import { observed, outsideProof } from '@/lib/review/manual';
import { compareReceipts } from '@/lib/security-lab/receipts';
import { issueAccess } from '@/lib/security-lab/access-token';
import { NextResponse } from 'next/server';
import { currentAccount, loginBinding, disableMember } from '@/lib/demo-login';
import {
  demoEnabled,
  demoOriginAllowed,
  demoScheme,
  attackHost,
  workspaceId,
} from '@/lib/demo-session';
import { exerciseByNumber } from '@/lib/security-lab/catalog';
import {
  labDb,
  runFor,
  log,
  hash,
  LabError,
  fail,
} from '@/lib/security-lab/store';
import { authorize, exchange } from '@/lib/security-lab/connector';
import { staff, staffCookie } from '@/lib/security-lab/staff';
async function handlePOST(req: Request) {
  if (!demoEnabled() || !demoOriginAllowed(req))
    return new Response(null, { status: 403 });
  if (req.headers.get('content-type')?.split(';')[0] !== 'application/json')
    return new Response(null, { status: 415 });
  const text = await req.text();
  if (text.length > 8192) return new Response(null, { status: 413 });
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const a = currentAccount(req),
    w = workspaceId(req);
  if (!a || !w) return new Response(null, { status: 401 });
  const row = runFor(w),
    ex = exerciseByNumber(Number(row?.n));
  if (!row || !ex || typeof b?.action !== 'string')
    return Response.json(
      { error: 'Choose an exercise first.' },
      { status: 400 },
    );
  const op: string = b.action;
  if (!ex.actions.includes(op))
    return Response.json(
      { error: 'This action belongs to a different exercise.' },
      { status: 403 },
    );
  const db = labDb(),
    owner = a.role === 'Owner',
    origin = demoScheme() + req.headers.get('host');
  const outcome = (data: unknown, status = 200) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  try {
    let result: unknown;
    switch (op) {
      case 'mine':
      case 'other':
      case 'lookup': {
        const id =
          op === 'lookup'
            ? b.id
            : op === 'mine'
              ? a.id === 'theo'
                ? row.clientB
                : row.clientA
              : a.id === 'theo'
                ? row.clientA
                : row.clientB;
        if (typeof id !== 'string' || id.length > 80)
          fail(400, 'Enter a record ID.');
        const record = db
          .prepare(
            'SELECT clientA,clientB FROM runs WHERE w=? AND (clientA=? OR clientB=?)',
          )
          .get(w, id, id);
        const assigned = id === row.clientA ? 'mira' : 'theo';
        if (!record || (!owner && assigned !== a.id))
          fail(404, 'No accessible client record.');
        result = {
          id,
          client: assigned === 'mira' ? 'Fern Studio' : 'Moss Works',
          assigned,
          ...(owner
            ? { billingReference: assigned === 'mira' ? 'INV-410' : 'INV-532' }
            : {}),
        };
        break;
      }
      case 'ledger':
        result = {
          payment: 'PAY-104',
          state: row.payment,
          providerRefunds: row.receipt,
          receiptCheck: compareReceipts(
            row.payment === 'settled' ? 1 : 0,
            Array(Number(row.receipt)).fill('REF-104'),
          ),
          ...(owner ? { amountCents: 8400, billingReference: 'INV-410' } : {}),
        };
        break;
      case 'submit':
      case 'approve':
      case 'settle':
      case 'outage':
      case 'interrupt': {
        if (Object.keys(b).length !== 1)
          fail(400, 'Unexpected payment fields.');
        if (op !== 'submit' && !owner) fail(403, 'Owner permission required.');
        if (op === 'submit' || op === 'approve') {
          const before = op === 'submit' ? 'open' : 'submitted',
            after = op === 'submit' ? 'submitted' : 'approved';
          if (
            !db
              .prepare('UPDATE runs SET payment=? WHERE w=? AND payment=?')
              .run(after, w, before).changes
          )
            fail(409, 'This step is out of order or already complete.');
          result = { state: after, providerRefunds: row.receipt };
          break;
        }
        if (row.payment !== 'approved' && row.payment !== 'settled')
          fail(409, 'A submitted and approved refund is required.');
        if (op === 'outage')
          fail(
            503,
            'Fictional payment provider unavailable. Nothing was delivered.',
          );
        const changed = db
          .prepare(
            "UPDATE runs SET payment='settled',receipt=1 WHERE w=? AND payment='approved' AND receipt=0",
          )
          .run(w);
        if (op === 'interrupt' && changed.changes)
          fail(
            504,
            'The receipt was recorded, but the first reply was interrupted. Retry to retrieve it.',
          );
        result = {
          state: 'settled',
          receipt: 'REF-104',
          providerRefunds: 1,
          replayed: !changed.changes,
        };
        break;
      }
      case 'audit':
        if (!owner) fail(403, 'Only the Owner can read the audit trail.');
        result = {
          events: db
            .prepare(
              'SELECT id,at,actor,action,status FROM trail WHERE w=? ORDER BY id DESC LIMIT 100',
            )
            .all(w),
        };
        break;
      case 'disable':
      case 'enable':
        if (!owner) fail(403, 'Only the Owner can change account status.');
        disableMember(w, 'mira', op === 'disable');
        result = { member: 'Mira Chen', enabled: op === 'enable' };
        break;
      case 'control':
      case 'mutant': {
        const receipts =
          op === 'control' ? ['REF-104'] : ['REF-104', 'REF-104'];
        const { pass, duplicates } = compareReceipts(1, receipts);
        result = {
          fixtureReceipts: receipts,
          uniqueReceiptCheck: !pass
            ? 'FAIL – duplicate receipt detected'
            : 'PASS – one receipt',
          duplicates,
        };
        break;
      }
      case 'search': {
        if (typeof b.text !== 'string' || b.text.length > 500)
          fail(400, 'Search is limited to 500 characters.');
        result = {
          matches: db
            .prepare(
              "SELECT client FROM (SELECT 'Fern Studio' AS client,'mira' AS assignee UNION ALL SELECT 'Moss Works','theo') WHERE (? OR assignee=?) AND instr(lower(client),lower(?))>0",
            )
            .all(owner ? 1 : 0, a.id, b.text),
        };
        break;
      }
      case 'message':
        if (typeof b.text !== 'string' || b.text.length > 500)
          fail(400, 'Message is limited to 500 characters.');
        result = { preview: b.text };
        break;
      case 'tamper':
        fail(400, 'Use the payment endpoint to test unexpected fields.');
        break;
      case 'hostile':
        result = {
          url:
            demoScheme() +
            attackHost() +
            '/attack-site?entry=' +
            encodeURIComponent(req.headers.get('host')!)+'&probe='+outsideProof(w,a.id),
        };
        break;
      case 'isolation':
        result = {
          recordId: row.clientA,
          source: 'Fictional workspace',
          configuration: 'infra/simulation/compose.yml',
        };
        break;
      case 'staff': {
        const sid =
          req.headers
            .get('cookie')
            ?.split(/;\s*/)
            .find((x) => x.startsWith(staffCookie + '='))
            ?.slice(staffCookie.length + 1) || '';
        const value = staff(w, b.operation, b, sid, loginBinding(req));
        const r = outcome(
          'sid' in value ? { message: 'Staff signed in.' } : value,
        );
        if (value.sid || value.cleared)
          r.cookies.set(staffCookie, value.sid || '', {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            path: '/',
            maxAge: value.sid ? 900 : 0,
          });
        log(w, a.id, op + '.' + b.operation, 200);
        return r;
      }
      case 'foreign':
        result = {
          providerToken: issueAccess(origin, a.id, 'provider.read', 30, true),
        };
        break;
      case 'grant':
      case 'writegrant':
      case 'shortgrant':
      case 'badredirect':
      case 'wrongaudience':
        result = authorize(w, a, b, origin, loginBinding(req));
        break;
      case 'exchange':
      case 'rotate':
      case 'replayRefresh':
        result = exchange(w, a, b, origin, loginBinding(req));
        break;
      case 'revoke':
        db.prepare(
          'DELETE FROM grants WHERE w=? AND actor=? AND binding=? AND access=?',
        ).run(w, a.id, loginBinding(req), hash(String(b.access)));
        result = { revoked: true };
        break;
      default:
        fail(400, 'Use the indicated resource endpoint for this action.');
    }
    log(w, a.id, op, 200);
    return outcome(result);
  } catch (e) {
    if (e instanceof LabError) {
      log(w, a.id, op, e.status);
      return outcome({ error: e.message }, e.status);
    }
    throw e;
  }
}

export function POST(req:Request){return observed(req, handlePOST);}
