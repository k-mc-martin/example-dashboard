'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Observation } from './workspace-activity';

type Ledger = {
  payment: string;
  state: 'open' | 'submitted' | 'approved' | 'settled';
  providerRefunds: number;
  amountCents?: number;
  billingReference?: string;
};

const refundStates = {
  open: 'No refund requested',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  settled: 'Delivered',
};

export function PaymentDetails({
  observation,
  children,
}: {
  observation?: Observation;
  children: ReactNode;
}) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch('/api/demo/lab', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ledger' }),
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw Error();
        const data: Ledger = await response.json();
        if (!controller.signal.aborted) {
          setLedger(data);
          setError('');
        }
      } catch {
        if (!controller.signal.aborted) {
          setLedger(null);
          setError(
            'The payment ledger could not be loaded. Select Read the payment ledger to try again.',
          );
        }
      }
    }
    void read();
    return () => controller.abort();
  }, [observation]);
  return (
    <section className="ops-card workspace-record" aria-label="Payment details">
      <p className="eyebrow">Payment ledger</p>
      {ledger ? (
        <>
          <h2>{ledger.payment}</h2>
          <dl>
            <div>
              <dt>Refund status</dt>
              <dd>{refundStates[ledger.state]}</dd>
            </div>
            <div>
              <dt>Refunds delivered</dt>
              <dd>{ledger.providerRefunds}</dd>
            </div>
            {ledger.amountCents !== undefined && (
              <div>
                <dt>Payment amount</dt>
                <dd>
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                  }).format(ledger.amountCents / 100)}
                </dd>
              </div>
            )}
            {ledger.billingReference && (
              <div>
                <dt>Invoice</dt>
                <dd>{ledger.billingReference}</dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <p role="status">{error || 'Loading payment…'}</p>
      )}
      <div className="demo-actions">{children}</div>
    </section>
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function ResultFields({ data }: { data: Record<string, unknown> }) {
  const fields = Object.entries(data).filter(
    ([, v]) =>
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
  );
  return (
    <dl>
      {fields.map(([key, value]) => (
        <div key={key}>
          <dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ActionResult({ observation }: { observation: Observation }) {
  const { status, data, action } = observation;
  const fields = record(data);
  const result = record(fields.result);
  let message = '';
  if (!status) message = 'The server could not be reached.';
  else if (status >= 400) {
    message = String(
      fields.error && typeof fields.error === 'string'
        ? fields.error
        : record(fields.error).message ||
            fields.message ||
            'The request was refused.',
    );
  } else if (typeof fields.client === 'string') message = String(fields.client);
  else if (typeof fields.message === 'string') message = fields.message;
  else if (action === 'submit') message = 'Refund submitted for approval.';
  else if (action === 'approve') message = 'Refund approved.';
  else if (action === 'settle') message = 'Refund delivery confirmed.';
  else if (action === 'audit') message = 'Audit log loaded.';
  else if (action === 'ledger') message = 'Payment ledger loaded.';
  else if (action === 'disable' || action === 'enable')
    message = fields.enabled
      ? 'Mira’s access is enabled.'
      : 'Mira’s access is disabled.';
  const rows =
    fields.attempts ?? fields.matches ?? result.tools ?? result.content;
  return (
    <section
      className="workspace-record"
      aria-live="polite"
      aria-label="Action result"
    >
      <strong
        className="workspace-status"
        data-denied={status === 0 || status >= 400}
      >
        {message || 'Request completed.'}
      </strong>
      {status < 400 && (!message || typeof fields.client === 'string') && (
        <ResultFields data={fields} />
      )}
      {Array.isArray(fields.events) && (
        <div className="workspace-audit">
          <table>
            <caption className="sr-only">
              Workspace audit events, most recent first
            </caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>Team member</th>
                <th>Action</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {fields.events.map((raw) => {
                const event = record(raw);
                return (
                  <tr key={String(event.id)}>
                    <td>{new Date(Number(event.at)).toLocaleString()}</td>
                    <td>{String(event.actor)}</td>
                    <td>{String(event.action)}</td>
                    <td>{String(event.status)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!fields.events.length && <p>No events recorded yet.</p>}
        </div>
      )}
      {Array.isArray(rows) &&
        (rows.length ? (
          <ol className="workspace-result-list">
            {rows.map((row, i) => (
              <li key={i}>
                <ResultFields data={record(row)} />
              </li>
            ))}
          </ol>
        ) : (
          <p>No entries.</p>
        ))}
      <details>
        <summary>Latest server response · {status || 'Network error'}</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </section>
  );
}
