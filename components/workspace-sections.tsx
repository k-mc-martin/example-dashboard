'use client';

import { useId, type ReactNode } from 'react';
import { ExternalLink, FileText, FolderOpen } from 'lucide-react';
import {
  workspaceScreens,
  type WorkspaceScreen,
} from '@/lib/security-lab/catalog';
import { VerificationResults } from './verification-results';
import { ActionResult, PaymentDetails } from './workspace-results';
import { actionLabels, useWorkspaceActivity } from './workspace-activity';

function Action({
  screen,
  id,
  primary = false,
}: {
  screen: WorkspaceScreen;
  id: string;
  primary?: boolean;
}) {
  const { e, pending, runAction } = useWorkspaceActivity();
  if (!e.actions.includes(id)) return null;
  return (
    <button
      data-workspace-action={id}
      className={primary ? 'primary-button' : 'outline-button'}
      disabled={pending}
      onClick={() => void runAction(screen, id)}
    >
      {actionLabels[id]}
    </button>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="ops-card workspace-card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function Payments() {
  const { e, obs, url, raw, setRaw, sendRaw, pending } = useWorkspaceActivity();
  const has = (id: string) => e.actions.includes(id);
  return (
    <>
      <PaymentDetails observation={obs.find((o) => o.screen === 'payments')}>
        <Action id="submit" screen="payments" primary />
        <Action id="approve" screen="payments" />
        <Action id="settle" screen="payments" />
        <Action id="ledger" screen="payments" />
      </PaymentDetails>
      {has('outage') && (
        <Card title="Provider delivery">
          <p>
            Test what happens if the refund provider goes offline or its reply
            is interrupted.
          </p>
          <div className="demo-actions">
            <Action id="outage" screen="payments" />
            <Action id="interrupt" screen="payments" />
          </div>
        </Card>
      )}
      {has('control') && (
        <Card title="Receipt reconciliation">
          <p>Compare a single receipt with a duplicate for the same refund.</p>
          <div className="demo-actions">
            <Action id="control" screen="payments" />
            <Action id="mutant" screen="payments" />
          </div>
        </Card>
      )}
      {has('burst') && (
        <Card title="Concurrent approvals">
          <Action id="burst" screen="payments" />
        </Card>
      )}
      {has('hostile') && (
        <Card title="External payment request">
          <p>
            Open a separate origin to try sending a refund request back to this
            payment.
          </p>
          <Action id="hostile" screen="payments" />
          {url && (
            <p>
              <a href={url} target="_blank" rel="noreferrer">
                Open the outside website <ExternalLink size={15} />
              </a>
            </p>
          )}
        </Card>
      )}
      {has('tamper') && (
        <Card title="Payment request editor">
          <label>
            Request body for POST /api/demo/lab
            <textarea
              value={raw}
              maxLength={8192}
              onChange={(event) => setRaw(event.target.value)}
            />
          </label>
          <div className="demo-actions">
            <button
              className="outline-button"
              disabled={pending}
              onClick={sendRaw}
            >
              Send my request
            </button>
            <Action id="tamper" screen="payments" />
          </div>
        </Card>
      )}
    </>
  );
}

function Clients() {
  const { e, inputs, setInput } = useWorkspaceActivity();
  return (
    <>
      {e.actions.includes('mine') && (
        <Card title="Client files">
          {(['mine', 'other'] as const)
            .filter((id) => e.actions.includes(id))
            .map((id) => (
              <div className="workspace-file" key={id}>
                <FolderOpen aria-hidden="true" size={21} />
                <strong>
                  {id === 'mine'
                    ? 'My assigned file'
                    : 'Another team member’s file'}
                </strong>
                <Action screen="clients" id={id} />
              </div>
            ))}
        </Card>
      )}
      {e.actions.includes('search') && (
        <Card title="Search the client directory">
          <label>
            Client name
            <input
              value={inputs.clients ?? ''}
              onChange={(e) => setInput('clients', e.target.value)}
              maxLength={500}
            />
          </label>
          <div className="demo-actions">
            <Action id="search" screen="clients" primary />
            <button
              className="text-link"
              onClick={() => setInput('clients', 'Fern')}
            >
              Load normal search
            </button>
            <button
              className="text-link"
              onClick={() => setInput('clients', "' OR 1=1 --")}
            >
              Load SQL probe
            </button>
          </div>
        </Card>
      )}
      {e.actions.includes('lookup') && (
        <Card title="Record lookup">
          <label>
            Client record ID
            <input
              value={inputs.clients ?? ''}
              onChange={(e) => setInput('clients', e.target.value)}
            />
          </label>
          <div className="demo-actions">
            <Action id="lookup" screen="clients" primary />
            <Action id="isolation" screen="clients" />
          </div>
          <p>
            <a
              href="https://github.com/k-mc-martin/example-dashboard/blob/main/infra/simulation/compose.yml"
              target="_blank"
              rel="noreferrer"
            >
              View provider isolation settings <ExternalLink size={15} />
            </a>
          </p>
        </Card>
      )}
    </>
  );
}

function ConnectorActions() {
  const { e, credentials, copied, setCopied } = useWorkspaceActivity();
  const groups = [
    {
      title: 'Application consent',
      actions: [
        'grant',
        'shortgrant',
        'writegrant',
        'badredirect',
        'wrongaudience',
      ],
    },
    {
      title: 'Access credentials',
      actions: ['exchange', 'rotate', 'replayRefresh', 'revoke'],
    },
    {
      title: 'Tool inspector',
      actions: [
        'tools',
        'toolread',
        'previousAccess',
        'injection',
        'toolwrite',
        'foreign',
        'unsigned',
        'tampered',
      ],
    },
  ];
  return (
    <>
      {groups.map((group) => {
        const available = group.actions.filter((id) => e.actions.includes(id));
        if (!available.length) return null;
        return (
          <Card key={group.title} title={group.title}>
            <div className="demo-actions">
              {available.map((id, index) => (
                <Action
                  key={id}
                  screen="connectors"
                  id={id}
                  primary={index === 0}
                />
              ))}
            </div>
          </Card>
        );
      })}
      <details className="workspace-guide">
        <summary>Use an external MCP client (optional)</summary>
        <p>
          Connect the client to <code>/api/demo/mcp</code> on this dashboard’s
          origin with the current demo access token.
        </p>
        <button
          className="outline-button"
          onClick={async () => {
            try {
              if (!credentials.current.access) {
                setCopied('Exchange a code first.');
                return;
              }
              await navigator.clipboard.writeText(credentials.current.access);
              setCopied('Copied the current demo token.');
            } catch {
              setCopied('Clipboard unavailable. Use the built-in inspector.');
            }
          }}
        >
          Copy demo access token
        </button>{' '}
        <span role="status">{copied}</span>
      </details>
    </>
  );
}

function MessagePreview() {
  const { inputs, setInput } = useWorkspaceActivity();
  return (
    <Card title="Message preview">
      <label>
        Message text
        <textarea
          value={inputs.communications ?? ''}
          maxLength={500}
          onChange={(e) => setInput('communications', e.target.value)}
        />
      </label>
      <div className="demo-actions">
        <Action id="message" screen="communications" primary />
        <button
          className="text-link"
          onClick={() =>
            setInput('communications', '<img src=x onerror=alert(1)>')
          }
        >
          Load markup
        </button>
      </div>
    </Card>
  );
}

function StaffAccess() {
  const { pending, runAction, password, pw, next, np, reveal, setReveal } =
    useWorkspaceActivity();
  const run = (op: string) => void runAction('staff', 'staff', op);
  function staffButton(op: string, name: string) {
    return (
      <button
        className="outline-button"
        type="button"
        disabled={pending}
        onClick={() => run(op)}
      >
        {name}
      </button>
    );
  }
  return (
    <>
      <Card title="Staff account">
        <p>
          Use a fictional password for this workspace. For first-time access,
          request an activation code, enter a new password, and select Set
          initial password.
        </p>
        <form
          data-workspace-action="staff"
          onSubmit={(ev) => {
            ev.preventDefault();
            run('login');
          }}
        >
          <div className="workspace-form-fields">
            <label>
              Current password
              <input
                type={reveal ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(ev) => pw(ev.target.value)}
              />
            </label>
            <label>
              New password
              <input
                type={reveal ? 'text' : 'password'}
                autoComplete="new-password"
                value={next}
                onChange={(ev) => np(ev.target.value)}
              />
            </label>
          </div>
          <label>
            <input
              type="checkbox"
              checked={reveal}
              onChange={(ev) => setReveal(ev.target.checked)}
            />{' '}
            Show passwords
          </label>
          <div className="demo-actions">
            <button className="primary-button" type="submit" disabled={pending}>
              Sign in as staff
            </button>
            {staffButton('logout', 'Sign out staff')}
            {staffButton('change', 'Change password')}
            {staffButton('enroll', 'Get activation code')}
            {staffButton('activate', 'Set initial password')}
          </div>
        </form>
      </Card>
      <Card title="Staff documents">
        <div className="workspace-file">
          <FileText aria-hidden="true" size={21} />
          <strong>Dispatch sheet</strong>
          {staffButton('record', 'Open staff record')}
        </div>
      </Card>
    </>
  );
}

export function ExerciseActions({ screen }: { screen: WorkspaceScreen }) {
  const { e, obs, download } = useWorkspaceActivity();
  const latest = obs.find((row) => row.screen === screen);
  return (
    <section className="workspace-actions ops-environment">
      <details className="workspace-guide">
        <summary>
          Exercise {e.n} · {e.title}
        </summary>
        <p>{e.guide}</p>
      </details>
      {screen === 'payments' && <Payments />}
      {screen === 'clients' && <Clients />}
      {screen === 'connectors' && <ConnectorActions />}
      {screen === 'communications' && <MessagePreview />}
      {screen === 'teams' && (
        <Card title="Mira’s account access">
          <div className="demo-actions">
            <Action id="disable" screen="teams" />
            <Action id="enable" screen="teams" />
          </div>
        </Card>
      )}
      {screen === 'audit' && (
        <Card title="Workspace events">
          <p>Review who performed each action and how the server responded.</p>
          <Action id="audit" screen="audit" primary />
        </Card>
      )}
      {screen === 'staff' && <StaffAccess />}
      {screen === 'evidence' && <VerificationResults />}
      {latest && <ActionResult observation={latest} />}
      {obs.length > 0 && (
        <div className="workspace-receipts">
          <details>
            <summary>Session activity ({obs.length})</summary>
            <ol>
              {obs.map((o, i) => (
                <li key={o.time + i}>
                  {workspaceScreens[o.screen].title} ·{' '}
                  {actionLabels[o.action] || o.action} ·{' '}
                  {o.status || 'Network error'}
                </li>
              ))}
            </ol>
          </details>
          <button className="text-link" onClick={download}>
            Download observations
          </button>
        </div>
      )}
    </section>
  );
}
