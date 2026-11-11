import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const input = process.argv[2];
const report = JSON.parse(readFileSync(input, 'utf8'));
const docs = report.sourceUrl ? report.sourceUrl + '/docs/security/' : '../../';
const manualLog = report.runUrl
  ? report.runUrl.split('/actions/runs/')[0] + '/blob/HEAD/docs/security/accounts.md#manual-verification-log'
  : '../../accounts.md#manual-verification-log';
const rows = [
  '# ' + report.scope + ' verification',
  '',
  '**' + report.automatedOutcome + '** across the automated checks for the account exercise.',
  '',
  'The [manual verification log](' + manualLog + ') records reviewer verdicts, exceptions and the exact build reviewed. This report covers the listed scenarios.',
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
rows.push('', '## Automated requirements in scope', '', '| ASVS ID | Status | Method | Evidence or pending check |', '|---|---|---|---|');
for (const control of report.controls.filter(control => control.method !== 'Manual review')) {
  const evidence = control.reason || control.evidence.join(' · ');
  rows.push(`| ${control.id} | ${control.status} | ${control.method} | ${evidence} |`);
}
rows.push('', '## Executed checks', '', '| Scenario | Method | Result |', '|---|---|---|');
for (const c of report.checks) rows.push('| ' + c.title + ' | ' + c.method + ' | ' + c.status + ' |');
rows.push('', 'The deliberate fault adds a forbidden field to a copy of a real Employee response. A pass means the usual field-access assertion caught that specific defect.', '');
rows.push('', '## Manual requirements', '', 'CI leaves these items to the reviewer. Match the commit in the [dated manual log](' + manualLog + ') to the build under assessment.', '', '| ASVS ID | Review procedure |', '|---|---|');
for (const control of report.controls.filter(control => control.method === 'Manual review')) {
  rows.push('| ' + control.id + ' | ' + control.reason + ' |');
}
rows.push(
  '', '[Access policy and reproduction](' + docs + 'accounts.md) · [Dated manual verification log](' + manualLog + ') · [Findings](' + docs + 'findings.md)', '');
if (report.runUrl && process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join('\n') + '\nDownload the report, JSON and test output from the **account-permissions-evidence** artifact on this run.\n');
rows.push('[Machine-readable results](results.json) · [Runner output](checks.tap)', '');
writeFileSync(join(dirname(input), 'report.md'), rows.join('\n'));
