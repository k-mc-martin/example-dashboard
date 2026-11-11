'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useWorkspaceActivity } from './workspace-activity';

type EvidenceSnapshot = {
  commit: string;
  runs: { title: string; id: number; status: string; updatedAt: string }[];
  checks: { name: string; status: string; detail: string }[];
};

const repo = 'https://github.com/k-mc-martin/example-dashboard';
const subjects = {
  8: {
    title: 'Server and dependency checks',
    action: 'Inspect server and dependency checks',
    workflow: 'security-tools',
    checks: /^(OSV|ZAP)/,
    runs: ['Security tools', 'Hosted boundary'],
  },
  13: {
    title: 'Source and history scans',
    action: 'Inspect source scan results',
    workflow: 'security-tools',
    checks: /^(Gitleaks|Semgrep)/,
    runs: ['Security tools'],
  },
  15: {
    title: 'Build verification',
    action: 'Inspect this build’s runs',
    workflow: 'campaign',
    checks: /^(Browser checks$|Server checks$|Exercise \d+ —)/,
    runs: [
      'Exercise campaign',
      'Hosted dashboard exercises',
      'Security tools',
      'Hosted boundary',
    ],
  },
} as const;

export function VerificationResults() {
  const { e } = useWorkspaceActivity();
  const subject = subjects[e.n as keyof typeof subjects];
  const [report, setReport] = useState<EvidenceSnapshot | null>(null);
  const [headers, setHeaders] = useState<[string, string][]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function inspect() {
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/demo/evidence', { cache: 'no-store' });
      if (!response.ok) throw Error();
      setReport(await response.json());
      if (e.n === 8) {
        const landing = await fetch('/launch', {
          method: 'HEAD',
          cache: 'no-store',
        });
        if (!landing.ok) throw Error();
        setHeaders(
          [
            'strict-transport-security',
            'content-security-policy',
            'x-content-type-options',
            'referrer-policy',
          ].map((name) => [
            name,
            (landing.headers.get(name) ?? 'Absent on this response').replace(
              /'nonce-[^']+'/g,
              "'nonce-…'",
            ),
          ]),
        );
      }
    } catch {
      setNotice(
        'Could not retrieve the evidence. Try again or open the GitHub run.',
      );
    } finally {
      setBusy(false);
    }
  }
  const runs =
    report?.runs.filter((row) =>
      (subject.runs as readonly string[]).includes(row.title),
    ) || [];
  const checks =
    report?.checks.filter((row) => subject.checks.test(row.name)) || [];
  return (
    <>
      <section className="ops-card workspace-card workspace-record">
        <h2>{subject.title}</h2>
        <div className="demo-actions">
          <button className="primary-button" disabled={busy} onClick={inspect}>
            {busy ? 'Loading evidence…' : subject.action}
          </button>
          <a
            className="outline-button"
            href={repo + '/actions/workflows/' + subject.workflow + '.yml'}
            target="_blank"
            rel="noreferrer"
          >
            View GitHub runs <ExternalLink size={15} />
          </a>
        </div>
        {notice && <p role="alert">{notice}</p>}
        {report && (
          <div aria-live="polite">
            <p>
              Deployed revision · <code>{report.commit}</code>
            </p>
            {runs.length ? (
              <ul className="workspace-result-list">
                {runs.map((row) => (
                  <li key={row.id}>
                    <a
                      className="text-link"
                      href={repo + '/actions/runs/' + row.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {row.title} <ExternalLink size={14} />
                    </a>
                    <span>
                      {row.status} · {new Date(row.updatedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Run evidence for this revision has not been published here yet.
              </p>
            )}
            {checks.map((row) => (
              <div className="workspace-file" key={row.name}>
                <strong>{row.name}</strong>
                <span>
                  {row.status} · {row.detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
      {headers.length > 0 && (
        <section className="ops-card workspace-card workspace-record">
          <h2>Live response headers</h2>
          <p>Received from this dashboard’s launch page.</p>
          <dl>
            {headers.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section className="ops-card workspace-card">
        <h2>Verification sources</h2>
        <div className="demo-actions">
          <a
            className="outline-button"
            href={
              repo +
              '/blob/' +
              (/^[a-f0-9]{40}$/.test(report?.commit || '')
                ? report!.commit
                : 'main') +
              '/.github/workflows/' +
              subject.workflow +
              '.yml'
            }
            target="_blank"
            rel="noreferrer"
          >
            View workflow source <ExternalLink size={15} />
          </a>
          <a
            className="outline-button"
            href={repo + '/blob/main/docs/security/campaign/README.md'}
            target="_blank"
            rel="noreferrer"
          >
            Manual review (optional) <ExternalLink size={15} />
          </a>
        </div>
      </section>
    </>
  );
}
