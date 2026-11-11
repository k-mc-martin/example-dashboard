import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const input = process.argv[2];
const report = JSON.parse(readFileSync(input, 'utf8'));
const rows = [
  '# ' + report.scope + ' verification',
  '',
  '**' + report.automatedOutcome + '** across the automated checks for this exercise. ' + report.followUp,
  '',
  '| Run detail | Value |', '|---|---|',
  '| Standard | ' + report.standard + ' |',
  '| Generated (UTC) | ' + report.generatedAt + ' |',
  '| Commit | ' + (report.commit ? '`' + report.commit + '`' + (report.dirty ? ' with local changes' : '') : 'Local checkout before its first commit') + ' |',
  '| Source fingerprint (SHA-256) | `' + report.sourceSha256 + '` |',
  '| Target | ' + report.target + ' |', '| Node | ' + report.node + ' |',
];
if (report.runUrl) rows.push('| GitHub evidence | [Workflow run](' + report.runUrl + ') |');
if (report.stackSetupFailed) rows.push('', 'The demo stack did not start. Its HTTP checks could not run.');
rows.push('', '## Requirements in scope', '', '| ASVS ID | Status | Method | Evidence or pending check |', '|---|---|---|---|');
for (const c of report.controls) rows.push('| ' + c.id + ' | ' + c.status + ' | ' + c.method + ' | ' + (c.reason || c.evidence.join(' · ')) + ' |');
rows.push('', '## Executed checks', '', '| Scenario | Method | Result |', '|---|---|---|');
for (const c of report.checks) rows.push('| ' + c.title + ' | ' + c.method + ' | ' + c.status + ' |');
const docs = report.sourceUrl ? report.sourceUrl + '/docs/security/' : '../../';
rows.push('', 'The deliberate fault adds a forbidden field to a copy of a real Employee response. A pass means the usual field-access assertion caught that specific defect.',
  '', '[Access policy and reproduction](' + docs + 'accounts.md) · [Dated manual verification log](' + docs + 'accounts.md#manual-verification-log) · [Findings](' + docs + 'findings.md)', '');
if (report.runUrl && process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join('\n') + '\nDownload the report, JSON and test output from the **account-permissions-evidence** artifact on this run.\n');
rows.push('[Machine-readable results](results.json) · [Runner output](checks.tap)', '');
writeFileSync(join(dirname(input), 'report.md'), rows.join('\n'));
