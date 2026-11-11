'use client';
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { WorkspaceScreen, Exercise } from '@/lib/security-lab/catalog';
export const actionLabels: Record<string, string> = {
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
  previousAccess: 'Call mail_read with previous token',
  injection: 'Read untrusted message',
  wrongaudience: 'Try a different audience',
  badredirect: 'Try a different redirect',
  foreign: 'Present an upstream token',
  unsigned: 'Try an unsigned token',
  tampered: 'Tamper with the signature',
  revoke: 'Revoke access',
};
export type Observation = {
  screen: WorkspaceScreen;
  action: string;
  status: number;
  time: string;
  data: unknown;
};
type ExerciseSession = {
  exercise: Exercise;
  actor?: string;
  revision?: string;
};
function useExerciseSession({ exercise: e, actor, revision }: ExerciseSession) {
  const [pending, busy] = useState(false),
    [obs, setObs] = useState<Observation[]>([]),
    [inputs, setInputs] = useState<Partial<Record<WorkspaceScreen, string>>>(
      {},
    ),
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
    previousAccess: '',
    refresh: '',
    spent: '',
  });
  async function runAction(
    screen: WorkspaceScreen,
    action: string,
    operation?: string,
  ) {
    if (pending) return;
    busy(true);
    const c = credentials.current;
    const input = inputs[screen] ?? '';
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
          c.previousAccess = action === 'rotate' ? c.access : '';
          c.spent = action === 'rotate' ? c.refresh : '';
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
          'previousAccess',
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
                : action === 'previousAccess'
                  ? c.previousAccess
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
            screen,
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
          screen,
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
            screen: 'payments' as const,
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
          screen: 'payments' as const,
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
  function setInput(screen: WorkspaceScreen, text: string) {
    setInputs((previous) => ({ ...previous, [screen]: text }));
  }
  return {
    e,
    revision,
    obs,
    pending,
    inputs,
    setInput,
    url,
    raw,
    setRaw,
    copied,
    setCopied,
    password,
    pw,
    next,
    np,
    reveal,
    setReveal,
    credentials,
    runAction,
    sendRaw,
    download,
  };
}

const ExerciseContext = createContext<ReturnType<
  typeof useExerciseSession
> | null>(null);
export function ExerciseProvider({
  children,
  ...session
}: ExerciseSession & { children: ReactNode }) {
  const value = useExerciseSession(session);
  return (
    <ExerciseContext.Provider value={value}>
      {children}
    </ExerciseContext.Provider>
  );
}

export function useWorkspaceActivity() {
  const session = useContext(ExerciseContext);
  if (!session) throw Error('Dashboard actions need an active exercise.');
  return session;
}
