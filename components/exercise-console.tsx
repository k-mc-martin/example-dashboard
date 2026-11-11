'use client';
import { useRef, useState } from 'react';
import { ExerciseHeading } from './exercise-picker';
import type { Exercise } from '@/lib/security-lab/catalog';
const labels: Record<string, string> = {
  mine: 'Open my client',
  other: 'Open the other client',
  lookup: 'Open record by ID',
  ledger: 'Read the payment ledger',
  submit: 'Submit refund',
  approve: 'Approve refund',
  settle: 'Deliver refund',
  audit: 'Read audit trail',
  disable: 'Disable Mira',
  enable: 'Re-enable Mira',
  outage: 'Simulate provider outage',
  interrupt: 'Interrupt first delivery',
  burst: 'Send 4 approval requests together',
  control: 'Check healthy fixture',
  mutant: 'Check duplicated receipt',
  search: 'Search client records',
  message: 'Preview message as text',
  tamper: 'Submit with a forged amount',
  hostile: 'Prepare outside website',
  isolation: 'Inspect my environment',
  grant: 'Consent: read mail',
  writegrant: 'Consent: request refunds',
  shortgrant: 'Consent: five-second token',
  exchange: 'Exchange last code',
  rotate: 'Rotate refresh token',
  replayRefresh: 'Replay previous refresh token',
  tools: 'List visible tools',
  toolread: 'Call mail_read',
  toolwrite: 'Call refund_request directly',
  injection: 'Read untrusted message',
  wrongaudience: 'Try a different audience',
  badredirect: 'Try a different redirect',
  foreign: 'Present an upstream token',
  unsigned: 'Try an unsigned token',
  tampered: 'Tamper with the signature',
  revoke: 'Revoke access',
};
const repo = 'https://github.com/k-mc-martin/example-dashboard';
type Obs = { action: string; status: number; time: string; data: unknown };
export function ExerciseConsole({
  exercise: e,
  member,
  actor,
  revision,
  choose,
}: {
  exercise: Exercise;
  member: boolean;
  actor?: string;
  revision?: string;
  choose: () => void;
}) {
  const [open, setOpen] = useState(true),
    [pending, busy] = useState(false),
    [obs, setObs] = useState<Obs[]>([]),
    [input, setInput] = useState(''),
    [url, setUrl] = useState('');
  const [raw, setRaw] = useState('{"action":"submit","amountCents":1}');
  const [copied, setCopied] = useState('');
  const [password, pw] = useState(''),
    [next, np] = useState(''),
    [activation, setActivation] = useState(''),
    [reveal, setReveal] = useState(false);
  const credentials = useRef({
    code: '',
    verifier: '',
    access: '',
    refresh: '',
    spent: '',
  });
  async function attempt(action: string, operation?: string) {
    if (pending) return;
    busy(true);
    const c = credentials.current;
    const send = async (path: string, body: unknown, bearer?: string) => {
      const r = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = (await r
        .json()
        .catch(() => ({ message: 'No readable response body.' }))) as {
        providerToken?: string;
        code?: string;
        access?: string;
        refresh?: string;
        scope?: string;
        expiresIn?: number;
        activation?: string;
        url?: string;
        message?: string;
      };
      return { status: r.status, data };
    };
    try {
      let r;
      const endpoint = '/api/demo/lab',
        base = location.origin;
      const lab = (extra: Record<string, unknown> = {}) =>
        send(endpoint, { action, ...extra });
      if (
        [
          'grant',
          'shortgrant',
          'writegrant',
          'badredirect',
          'wrongaudience',
        ].includes(action)
      ) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const b64 = (v: Uint8Array) =>
          btoa(Array.from(v, (x) => String.fromCharCode(x)).join(''))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', '');
        const verifier = b64(bytes),
          challenge = b64(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(verifier),
              ),
            ),
          );
        r = await lab({
          client: 'secdash-reviewer',
          responseType: 'code',
          redirect:
            action === 'badredirect' ? 'https://outside.invalid/' : base + '/',
          audience:
            action === 'wrongaudience'
              ? 'https://other.invalid/mcp'
              : base + '/api/demo/mcp',
          method: 'S256',
          challenge,
          scope: action === 'writegrant' ? 'refund.request' : 'mail.read',
          short: action === 'shortgrant',
        });
        if (r.data.code) {
          c.code = r.data.code;
          c.verifier = verifier;
          r.data = {
            message: 'One-time consent code issued.',
            expiresIn: r.data.expiresIn,
          };
        }
      } else if (['exchange', 'rotate', 'replayRefresh'].includes(action)) {
        const refresh = action !== 'exchange';
        r = await lab({
          client: 'secdash-reviewer',
          redirect: base + '/',
          grantType: refresh ? 'refresh_token' : 'authorization_code',
          credential: !refresh
            ? c.code
            : action === 'rotate'
              ? c.refresh
              : c.spent,
          verifier: c.verifier,
        });
        if (r.data.access) {
          c.spent = c.refresh;
          c.access = r.data.access;
          c.refresh = r.data.refresh || '';
          r.data = {
            message: 'Credentials issued to this client.',
            scope: r.data.scope,
            expiresIn: r.data.expiresIn,
          };
        }
      } else if (
        [
          'tools',
          'injection',
          'toolread',
          'toolwrite',
          'foreign',
          'unsigned',
          'tampered',
        ].includes(action)
      ) {
        const key =
          action === 'foreign'
            ? (await lab()).data.providerToken
            : action === 'unsigned'
              ? 'eyJhbGciOiJub25lIn0.' + c.access.split('.')[1] + '.AA'
              : action === 'tampered'
                ? c.access + '.'
                : c.access;
        r = await send(
          '/api/demo/mcp',
          {
            jsonrpc: '2.0',
            id: 1,
            method: action === 'tools' ? 'tools/list' : 'tools/call',
            ...(action === 'tools'
              ? {}
              : {
                  params: {
                    name:
                      action === 'toolwrite' ? 'refund_request' : 'mail_read',
                    arguments: {},
                  },
                }),
          },
          key || 'no-token',
        );
      } else if (action === 'revoke') r = await lab({ access: c.access });
      else if (action === 'staff') {
        r = await lab({ operation, password, next, code: activation });
        if (r.data.activation) {
          setActivation(r.data.activation);
          r.data = {
            message:
              'Five-minute activation code received. Choose a fictional password and activate the account.',
          };
        }
        pw('');
        np('');
      } else if (action === 'burst') {
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            send(endpoint, { action: 'approve' }),
          ),
        );
        r = { status: results[0].status, data: { attempts: results } };
      } else if (action === 'tamper')
        r = await send(endpoint, {
          action: 'submit',
          amountCents: 1,
          role: 'Owner',
        });
      else {
        r = await lab(
          action === 'lookup'
            ? { id: input }
            : action === 'message' || action === 'search'
              ? { text: input }
              : {},
        );
        if (action === 'hostile' && r.data.url) setUrl(r.data.url);
      }
      setObs((prev) =>
        [
          {
            action: operation || action,
            status: r.status,
            time: new Date().toISOString(),
            data: r.data,
          },
          ...prev,
        ].slice(0, 50),
      );
    } catch {
      setObs((prev) => [
        {
          action,
          status: 0,
          time: new Date().toISOString(),
          data: 'No response. Check the connection and retry.',
        },
        ...prev,
      ]);
    } finally {
      busy(false);
    }
  }
  async function sendRaw() {
    busy(true);
    try {
      const r = await fetch('/api/demo/lab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
      });
      const data = await r
        .json()
        .catch(() => ({ message: 'Request rejected before processing.' }));
      setObs((prev) =>
        [
          {
            action: 'Custom request',
            status: r.status,
            time: new Date().toISOString(),
            data,
          },
          ...prev,
        ].slice(0, 50),
      );
    } catch {
      setObs((prev) => [
        {
          action: 'Custom request',
          status: 0,
          time: new Date().toISOString(),
          data: 'Network error',
        },
        ...prev,
      ]);
    } finally {
      busy(false);
    }
  }
  function download() {
    const a = document.createElement('a'),
      u = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                exercise: e.n,
                actor,
                revision: revision || 'local',
                observations: obs,
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      );
    a.href = u;
    a.download = 'secdash-exercise-' + e.n + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  return (
    <section className="exercise-console">
      <div className="exercise-tools">
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide' : 'Open'} exercise {e.n}
        </button>
        {!member && <button onClick={choose}>Choose another exercise</button>}
      </div>
      {open && (
        <>
          <ExerciseHeading exercise={e} />
          {actor && (
            <p>
              <strong>Acting as {actor}</strong>
            </p>
          )}
          {e.category === 'Connector' && (
            <details>
              <summary>Use an external MCP client (optional)</summary>
              <p>
                After exchanging a code, connect a client that accepts a Bearer
                token to <code>/api/demo/mcp</code> on this dashboard’s origin.
                The short-lived token authorizes only the scope you consented
                to.
              </p>
              <button
                onClick={async () => {
                  try {
                    if (!credentials.current.access) {
                      setCopied('Exchange a code first.');
                      return;
                    }
                    await navigator.clipboard.writeText(
                      credentials.current.access,
                    );
                    setCopied('Copied the current demo token.');
                  } catch {
                    setCopied(
                      'Clipboard unavailable. Use the built-in inspector.',
                    );
                  }
                }}
              >
                Copy demo access token
              </button>{' '}
              <span role="status">{copied}</span>
            </details>
          )}
          {e.n === 16 && (
            <details>
              <summary>Try a request yourself</summary>
              <label>
                Request body for POST /api/demo/lab
                <textarea
                  value={raw}
                  maxLength={8192}
                  onChange={(ev) => setRaw(ev.target.value)}
                />
              </label>
              <button disabled={pending} onClick={sendRaw}>
                Send my request
              </button>
            </details>
          )}
          {e.category === 'Evidence' && (
            <p>
              {e.n === 13
                ? 'Inspect gitleaks-git.json, gitleaks-dir.json and semgrep.json in the security-tool-evidence artifact. '
                : e.n === 8
                  ? 'Inspect OSV and ZAP in the security-tool-evidence artifact and TLS in the hosted boundary report. '
                  : 'Open the workflow source and compare its commit with the evidence artifact. '}
              <a
                href={
                  repo +
                  (e.n === 15
                    ? '/actions/workflows/campaign.yml'
                    : '/actions/workflows/security-tools.yml')
                }
                target="_blank"
                rel="noreferrer"
              >
                View GitHub runs
              </a>
              ,{' '}
              <a href="/version" target="_blank" rel="noreferrer">
                deployed revision
              </a>
              , and{' '}
              <a
                href={repo + '/blob/main/docs/security/campaign/README.md'}
                target="_blank"
                rel="noreferrer"
              >
                review worksheet
              </a>
              .{' '}
              <a
                href={repo + '/actions/workflows/hosted-boundary.yml'}
                target="_blank"
                rel="noreferrer"
              >
                Hosted boundary report
              </a>
              . Match the commit before recording a verdict.
            </p>
          )}
          {e.n === 14 && (
            <p>
              <a
                href={repo + '/blob/main/infra/simulation/compose.yml'}
                target="_blank"
                rel="noreferrer"
              >
                Inspect the isolated provider configuration
              </a>
            </p>
          )}
          {e.n === 16 && (
            <div className="lab-input">
              <label>
                Message or search text{' '}
                <input
                  value={input}
                  maxLength={500}
                  onChange={(ev) => setInput(ev.target.value)}
                />
              </label>
              <button onClick={() => setInput('<img src=x onerror=alert(1)>')}>
                Load markup
              </button>
              <button onClick={() => setInput("' OR 1=1 --")}>
                Load SQL probe
              </button>
              <button onClick={() => setInput('Fern')}>
                Load normal search
              </button>
            </div>
          )}
          {e.n === 14 && (
            <label>
              Client record ID{' '}
              <input
                value={input}
                onChange={(ev) => setInput(ev.target.value)}
              />
            </label>
          )}
          {e.n === 18 ? (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                void attempt('staff', 'login');
              }}
            >
              <p>
                Use a made-up password only. This is a separate staff account in
                your disposable workspace.
              </p>
              <label>
                Current password{' '}
                <input
                  type={reveal ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(ev) => pw(ev.target.value)}
                />
              </label>
              <label>
                New password{' '}
                <input
                  type={reveal ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={next}
                  onChange={(ev) => np(ev.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={reveal}
                  onChange={(ev) => setReveal(ev.target.checked)}
                />{' '}
                Show passwords
              </label>
              <div className="exercise-tools">
                {Object.entries({
                  enroll: '1. Get activation code',
                  activate: '2. Set initial password',
                  login: 'Sign in as staff',
                  record: 'Open staff record',
                  change: 'Change password',
                  logout: 'Sign out staff',
                }).map(([key, title]) => (
                  <button
                    type="button"
                    disabled={pending}
                    key={key}
                    onClick={() => void attempt('staff', key)}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </form>
          ) : (
            <div className="exercise-tools">
              {e.actions.map((action) => (
                <button
                  key={action}
                  disabled={pending}
                  onClick={() => void attempt(action)}
                >
                  {labels[action]}
                </button>
              ))}
            </div>
          )}
          {url && (
            <p>
              <a href={url} target="_blank" rel="noreferrer">
                Open the outside website ↗
              </a>
            </p>
          )}
          {obs.length > 0 && (
            <div aria-live="polite" className="lab-results">
              <strong>
                Latest server response · {obs[0].status || 'Network error'}
              </strong>
              <p>
                {obs[0].status === 200
                  ? 'The server accepted the request.'
                  : obs[0].status === 403
                    ? 'This identity lacks permission.'
                    : obs[0].status === 404
                      ? 'The server did not disclose this record.'
                      : obs[0].status === 409
                        ? 'The payment cannot move to that state.'
                        : obs[0].status === 401
                          ? 'The supplied credentials do not give access.'
                          : obs[0].status === 429
                            ? 'The server limited repeated attempts.'
                            : obs[0].status === 400
                              ? 'The server rejected the request as invalid.'
                              : 'Compare the response below with the recorded state.'}
              </p>
              <pre>{JSON.stringify(obs[0].data, null, 2)}</pre>
              <details>
                <summary>Earlier attempts ({obs.length - 1})</summary>
                {obs.slice(1).map((o, i) => (
                  <p key={i}>
                    {o.action} · {o.status} · {o.time}
                  </p>
                ))}
              </details>
              <button onClick={download}>Download observations</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
