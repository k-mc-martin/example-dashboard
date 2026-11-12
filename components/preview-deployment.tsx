'use client';
import { useEffect, useState } from 'react';

type Deployment = {
  id: number;
  version: string;
  launchedBy: string;
  deployedAt: string;
};
type Result = {
  deployment?: Deployment;
  current?: Deployment | null;
  deploymentCount?: number;
  replayed?: boolean;
  error?: string;
};

export function PreviewDeployment({
  active,
  revision,
  showHistory,
  concurrent = false,
}: {
  active: boolean;
  revision: number;
  showHistory: boolean;
  concurrent?: boolean;
}) {
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetch('/api/releases', { cache: 'no-store', signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((release) => {
        if (
          !release ||
          typeof release !== 'object' ||
          !('version' in release) ||
          typeof release.version !== 'string'
        )
          throw Error();
        if (!controller.signal.aborted) setVersion(release.version);
      })
      .catch(() => {
        if (!controller.signal.aborted) setVersion('');
      });
    return () => controller.abort();
  }, [active, revision]);
  async function send(launch: boolean) {
    const response = await fetch(
      '/api/demo/deployments',
      launch
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version }),
          }
        : { cache: 'no-store', headers: { 'X-SecDash-Review': '1' } },
    );
    const data: Result = await response.json();
    const record = data.deployment ?? data.current;
    const detail =
      data.error ??
      (record
        ? `ExampleApp ${record.version} · ${record.launchedBy}. Preview deployments: ${data.deploymentCount}.`
        : 'No preview deployments in this workspace.');
    return `HTTP ${response.status} · ${data.replayed ? 'Already deployed. ' : ''}${detail}`;
  }
  async function request(launch: boolean, twice = false) {
    setBusy(true);
    try {
      const replies = await Promise.all(
        twice ? [send(true), send(true)] : [send(launch)],
      );
      setNotice(replies.join(' '));
    } catch {
      setNotice('The server response could not be read.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="ops-card workspace-card"
      aria-label="Preview deployment"
    >
      <h2>Preview deployment</h2>
      <p>
        {version
          ? `ExampleApp ${version}`
          : 'Waiting for the published release'}{' '}
        · Fictional preview environment
      </p>
      <div className="demo-actions">
        <button
          className="primary-button"
          disabled={busy || !version}
          onClick={() => void request(true)}
        >
          Launch preview deployment
        </button>
        {concurrent && (
          <button
            className="outline-button"
            disabled={busy || !version}
            onClick={() => void request(true, true)}
          >
            Launch the same release twice
          </button>
        )}
        {showHistory && (
          <button
            className="outline-button"
            disabled={busy}
            onClick={() => void request(false)}
          >
            Check deployed release
          </button>
        )}
      </div>
      <p role="status">{notice}</p>
    </section>
  );
}
