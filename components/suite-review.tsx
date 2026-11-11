'use client';
import { useEffect, useState } from 'react';
type Status = {
  state: 'running' | 'queued' | 'complete' | 'interrupted';
  completed: number;
  passed: number;
  failed: number;
  current?: string;
};
export function SuiteReview() {
  const [job, setJob] = useState<Status | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const active = job?.state === 'running' || job?.state === 'queued';
  useEffect(() => {
    const abort = new AbortController();
    async function refresh() {
      try {
        const r = await fetch('/api/demo/suite', {
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!r.ok) throw Error();
        setJob(await r.json());
        setError('');
      } catch {
        if (!abort.signal.aborted)
          setError('Could not retrieve the run status.');
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }
    void refresh();
    const timer = active ? setInterval(() => void refresh(), 2500) : undefined;
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [active]);
  async function run() {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/demo/suite' + (job ? '?again=1' : ''), {
        method: 'POST',
      });
      if (!r.ok)
        throw Error(
          r.status === 429
            ? 'The review queue is full. Try again shortly.'
            : 'Could not start the review.',
        );
      setJob(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the review.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Automated security review"
      className="ops-card workspace-card"
    >
      <h2>Automated security review</h2>
      <p>
        Run all 19 exercises in fresh workspaces and download the server
        responses and verification results in one PDF.
      </p>
      <div className="demo-actions">
        <button
          className="primary-button"
          onClick={run}
          disabled={busy || active}
        >
          {active
            ? 'Review in progress'
            : job
              ? 'Run all 19 exercises again'
              : 'Run all 19 exercises'}
        </button>
        {job && !active && (
          <a
            className="outline-button"
            href="/api/demo/suite?download=1"
            download
          >
            Download suite results (PDF)
          </a>
        )}
      </div>
      {job && (
        <p role="status">
          {job.state === 'queued'
            ? 'Queued.'
            : job.state === 'running'
              ? 'Running.'
              : job.state === 'complete'
                ? 'Finished.'
                : 'Run interrupted.'}{' '}
          {job.completed} of 19 completed · {job.passed} passed · {job.failed}{' '}
          failed{job.current ? ' · ' + job.current : ''}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
