import fs from 'node:fs';
import {
  catalog,
  screensForExercise,
  workspaceScreens,
} from '../../lib/security-lab/catalog.ts';
const dir = 'docs/security/campaign/',
  rows = JSON.parse(fs.readFileSync(dir + 'requirements.json', 'utf8'));
const spec = 'https://github.com/OWASP/ASVS/tree/v5.0.0_release';
const na = (id) =>
  id.startsWith('5.')
    ? 'The demo accepts no file or archive uploads. Review inbound routes and confirm downloads use trusted paths.'
    : id === '4.4.1'
      ? 'No production WebSocket endpoint. Inspect routes and the deployed Network panel.'
      : id === '1.3.1'
        ? 'No rich-text HTML editor. Verify message previews and mail content are plain text.'
        : 'No XML parser or XML input endpoint. Confirm against the deployed application.';
const lines = [
  '# SecDash manual review (optional)',
  '',
  '[Launch the exercise picker](https://vps-ca027b84.vps.ovh.us/launch) · [Deployed commit](https://vps-ca027b84.vps.ovh.us/version) · [Campaign CI](https://github.com/k-mc-martin/example-dashboard/actions/workflows/campaign.yml) · [Scanner evidence](https://github.com/k-mc-martin/example-dashboard/actions/workflows/security-tools.yml) · [Rules and limits](policy.md)',
  '',
  'Choose a card, then a fictional role for interactive exercises. The dashboard opens to the first relevant screen. Use the dashboard navigation to reach the other screens listed below. Verification results open directly for evidence reviews. **Sign out** changes identity inside the same exercise. **Choose another exercise** starts a fresh workspace and ends the old dashboard logins when you select a card. A private browser window is a second, independent visitor. Owner → Teams opens a second member in the same workspace. Only the example dashboard and its fictional providers are in scope.',
  '',
  'For each review, record the deployed commit, date, browser, role, request or steps, expected and actual result, and evidence. Download observations from a dashboard screen where you ran a check before signing out. Do not include passwords, raw cookies, access tokens or activation codes. Use [the blank results sheet](manual-results.csv) for a private working copy; publish only redacted observations. Opening a card or receiving an error alone is not a passing grade. Confirm a positive control and the resulting data or absence of a side effect.',
  '',
  'Use **Download exercise report (PDF)** on an exercise screen to export the backend receipts. The Owner can collect receipts across roles in the same workspace. To run the automated scenarios, use **Run all 19 exercises** on the picker. The suite PDF includes the actual HTTP responses, assertion outcomes, and build revision.',
  '',
  '## Exercise directory',
  '',
  '| # | Exercise | Dashboard screens | What to try |',
  '|---|---|---|---|',
  ...catalog.map(
    (e) =>
      '| ' +
      e.n +
      ' | ' +
      e.title +
      ' | ' +
      screensForExercise(e)
        .map((id) => workspaceScreens[id].title)
        .join(', ') +
      ' | ' +
      e.guide +
      ' |',
  ),
  '',
  '## ASVS requirement checklist',
  '',
  '70 unique Level 1 requirements are assigned once below. Exercises without Level 1 rows still have their own scenario. Earlier manual evidence applies only to the commit and checks in the [account log](../accounts.md#manual-verification-log). The current build awaits your manual verdicts. Review additional evidence in CI; a single scenario does not establish ASVS conformance.',
  '',
];
for (const theme of new Set(rows.map((r) => r.theme))) {
  lines.push(
    '### ' + theme,
    '',
    '| ASVS 5.0.0 | Exercise | Review criterion |',
    '|---|---|---|',
  );
  for (const r of rows.filter((r) => r.theme === theme))
    lines.push(
      '| ' +
        r.id +
        ' | ' +
        (r.exercise || 'Confirm N/A') +
        ' | ' +
        r.requirement.replaceAll('|', '\\|') +
        (!r.exercise ? ' **Scope check:** ' + na(r.id) : '') +
        ' |',
    );
  lines.push('');
}
lines.push(
  'Requirement text: [OWASP Application Security Verification Standard 5.0.0](' +
    spec +
    '), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Groupings and exercise guidance are SecDash adaptations.',
  '',
);
const quote = (v) => '"' + String(v).replaceAll('"', '""') + '"';
const sheet =
  [
    [
      'id',
      'exercise',
      'status',
      'reviewer',
      'commit',
      'date',
      'expected',
      'observed',
      'evidence / N/A rationale',
    ],
    ...rows.map((r) => [
      'v5.0.0-' + r.id,
      r.exercise || 'Scope',
      'Not yet tested',
      '',
      '',
      '',
      r.requirement,
      '',
      r.exercise ? '' : na(r.id),
    ]),
    ...catalog
      .filter((e) => !rows.some((r) => r.exercise === e.n))
      .map((e) => [
        'scenario-' + e.n,
        e.n,
        'Not yet tested',
        '',
        '',
        '',
        e.question,
        '',
        '',
      ]),
  ]
    .map((r) => r.map(quote).join(','))
    .join('\n') + '\n';
for (const [name, content] of [
  ['README.md', lines.join('\n')],
  ['manual-results.csv', sheet],
]) {
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(dir + name, 'utf8') !== content)
      throw Error('Regenerate ' + name);
  } else fs.writeFileSync(dir + name, content);
}
