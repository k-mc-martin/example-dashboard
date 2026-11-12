'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { SimulationWorkspace } from './simulation-dashboard';
import type { DemoAccount, DemoRole } from '@/lib/demo-permissions';

import { ExercisePicker, ExerciseHeading } from './exercise-picker';
import { ExerciseProvider } from './workspace-activity';
import Dashboard from './dashboard';
import { exerciseByNumber } from '@/lib/security-lab/catalog';
type Choice = DemoAccount & { pass: string };
type Session = (
  | { account: DemoAccount; expiresAt: number }
  | { account: null; choices: Choice[]; memberTab?: boolean }
) & { exercise?: number; revision?: string; memberTab?: boolean };
const details = {
  Employee: {
    icon: BriefcaseBusiness,
    access:
      'Read communications, review feedback, and check websites and releases.',
  },
  Administrator: {
    icon: ShieldCheck,
    access:
      'Launch preview deployments, inspect deployment history, start backups, and sync the backup library.',
  },
  Owner: {
    icon: KeyRound,
    access:
      'The full dashboard, including provider accounts, revenue, and automation.',
  },
} satisfies Record<DemoRole, { icon: typeof KeyRound; access: string }>;

export function DemoSignIn() {
  const [session, setSession] = useState<Session | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const channel = useRef<BroadcastChannel | null>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const response = await fetch('/api/demo/session', { cache: 'no-store' });
      if (!response.ok)
        throw Error('Reload the dashboard to open a fresh demo workspace.');
      const next: Session = await response.json();
      if (version === generation.current) {
        setSession(next);
        setError('');
      }
    } catch (cause) {
      if (version === generation.current) {
        setSession(null);
        setError(
          cause instanceof Error
            ? cause.message
            : 'The workspace could not be opened.',
        );
      }
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const updates = new BroadcastChannel('secdash-login');
    channel.current = updates;
    updates.onmessage = () => {
      setSession(null);
      void load();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      window.clearTimeout(initial);
      updates.close();
      channel.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [load]);
  const activeMember = session?.account && session.account.role !== 'Owner';
  useEffect(() => {
    if (!activeMember) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeMember, load]);
  const expiresAt = session?.account && session.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(
      () => {
        setSession(null);
        void load();
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt, load]);

  async function change(choice?: Choice) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        '/api/demo/session',
        choice
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: choice.id, pass: choice.pass }),
            }
          : { method: 'DELETE' },
      );
      if (!response.ok) throw Error('Your session changed. Please try again.');
      setSession(null);
      channel.current?.postMessage('changed');
      await load();
    } catch {
      await load();
      setError('Could not complete the account change. Please try again.');
    } finally {
      setPending(false);
    }
  }

  const exercise = exerciseByNumber(session?.exercise);
  async function choose(n: number) {
    setPending(true);
    try {
      const r = await fetch('/api/demo/exercise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise: n }),
      });
      if (!r.ok) throw Error();
      setChoosing(false);
      channel.current?.postMessage('changed');
      await load();
    } catch {
      setError('Could not start this exercise. Reload and try again.');
    } finally {
      setPending(false);
    }
  }
  if (
    (choosing || (!exercise && session && !session.account)) &&
    !session?.memberTab
  )
    return (
      <ExercisePicker
        choose={choose}
        cancel={exercise ? () => setChoosing(false) : undefined}
        pending={pending}
        error={error}
      />
    );
  if (exercise?.category === 'Evidence' && !session?.account)
    return (
      <ExerciseProvider
        key={exercise.n}
        exercise={exercise}
        revision={session?.revision}
      >
        <section
          className="simulation-toolbar"
          aria-label="Exercise navigation"
        >
          <strong>{exercise.title}</strong>
          <button className="outline-button" onClick={() => setChoosing(true)}>
            Choose another exercise
          </button>
        </section>
        <Dashboard exercise={exercise} />
      </ExerciseProvider>
    );
  if (session?.account) {
    const workspace = (
      <SimulationWorkspace
        account={session.account}
        exercise={exercise}
        chooseExercise={session.memberTab ? undefined : () => setChoosing(true)}
        signOut={() => void change()}
        signingOut={pending}
        checkSession={load}
      />
    );
    return (
      <>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {exercise ? (
          <ExerciseProvider
            key={exercise.n + ':' + session.account.id}
            exercise={exercise}
            actor={session.account.name + ' · ' + session.account.role}
            revision={session.revision}
          >
            {workspace}
          </ExerciseProvider>
        ) : (
          workspace
        )}
      </>
    );
  }
  if (session && !session.account && session.memberTab)
    return (
      <main className="demo-entry">
        <h1>Member signed out</h1>
        <p>You can close this tab. Open another member session from Teams.</p>
      </main>
    );
  return (
    <main className="demo-entry">
      <header>
        <p className="eyebrow">SecDash / SECURITY DASHBOARD</p>
        {exercise && (
          <>
            <ExerciseHeading exercise={exercise} />
            <button
              className="outline-button"
              onClick={() => setChoosing(true)}
            >
              Choose another exercise
            </button>
          </>
        )}
        <h1>Choose a demo account</h1>
        <p>
          Sign in to explore a role. Sign out to try another role with the same
          fictional data.
        </p>
      </header>
      {error && (
        <div role="alert" className="notice">
          {error}{' '}
          <button className="text-link" onClick={() => location.reload()}>
            Reload dashboard
          </button>
        </div>
      )}
      {!session && !error && <p role="status">Opening your workspace…</p>}
      <div className="demo-accounts">
        {session?.choices.map((choice) => {
          const { icon: Icon } = details[choice.role];
          const extras = [
            choice.permissions.deployments && 'Deployments',
            choice.permissions.storage && 'Storage & recovery',
          ].filter(Boolean);
          const access =
            choice.role === 'Owner'
              ? details.Owner.access
              : 'Communications, Feedback, and Website & releases.' +
                (extras.length
                  ? ' Also includes ' + extras.join(' and ') + '.'
                  : '');
          return (
            <section key={choice.id} className="demo-account">
              <Icon aria-hidden="true" size={24} />
              <h2>{choice.role}</h2>
              <span className="minor-label">{choice.name}</span>
              <p>{access}</p>
              <button
                className="outline-button"
                disabled={pending}
                onClick={() => void change(choice)}
              >
                Sign in as {choice.role}{' '}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </section>
          );
        })}
      </div>
    </main>
  );
}
