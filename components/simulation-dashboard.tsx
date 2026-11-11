'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Dashboard from './dashboard';
import type { DemoAccount } from '@/lib/demo-permissions';

export function SimulationWorkspace({ account, signOut, signingOut, checkSession }: {
  account: DemoAccount; signOut: () => void; signingOut: boolean; checkSession: () => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const revision = useRef(0);
  const pending = useRef(false);
  const advance = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/demo/events', {
        method: 'POST',
        headers: { 'If-Match': String(revision.current) },
        cache: 'no-store',
      });
      if (response.status === 401) { checkSession(); return; }
      if (!response.ok) throw Error('The providers could not deliver an update. Try again.');
      const result = (await response.json()) as { step: number };
      if (result.step !== revision.current) setUpdated(new Date().toLocaleTimeString());
      revision.current = result.step;
      setStep(result.step);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh the demo.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, [checkSession]);
  useEffect(() => {
    const initial = window.setTimeout(() => void advance(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void advance();
    }, 60000);
    return () => { window.clearTimeout(initial); clearInterval(timer); };
  }, [advance]);
  return (
    <>
      <section className="simulation-toolbar" aria-label="Demo data">
        <div>
          <strong>{account.name} · {account.role}</strong>
          <span role="status">
            {error || (updated ? 'Your workspace · Updated ' + updated : 'Preparing your workspace…')}
          </span>
        </div>
        <div className="demo-actions"><button className="outline-button" disabled={busy} onClick={() => void advance()}>
          {busy ? 'Updating…' : 'Generate new activity'}
        </button>
          <button className="outline-button" onClick={signOut} disabled={signingOut}>Sign out</button>
        </div>
      </section>
      {step > 0 && <Dashboard account={account} revision={step} />}
    </>
  );
}
