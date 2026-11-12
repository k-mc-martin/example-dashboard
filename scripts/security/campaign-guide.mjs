import fs from 'node:fs';
import {
  catalog,
  screensForExercise,
  workspaceScreens,
} from '../../lib/security-lab/catalog.ts';
const dir = 'docs/security/campaign/',
  rows = JSON.parse(fs.readFileSync(dir + 'requirements.json', 'utf8'));
const spec = 'https://github.com/OWASP/ASVS/tree/v5.0.0_release';
const walkthroughs = {
  1: "As Mira (Employee), open **Payments & refunds**. Select **Submit refund**, then **Approve refund**. Expand **Latest server response** to see `403` and “Owner permission required.” Select **Read the payment ledger** and confirm `submitted` with zero refunds delivered. **Sign out**, choose Inez (Owner), and approve the same refund. Expect `200`, a ledger state of `approved`, and still zero deliveries.",
  2: "As Mira, select **Open my client** (Fern Studio, `200`), then **Open the other client** (`404`, no client data). In **Payments & refunds**, submit a refund and try to approve it (`403`). Sign out and choose Inez. Repeat **Open the other client** to see Theo’s assignment, then approve the submitted refund (`200`).",
  3: "As Mira in **Connectors**, select **Consent: read mail**, then **Exchange last code**. **List visible tools** should show only `mail_read`. **Call mail_read** succeeds and **Call refund_request directly** returns `403`. Switch to Inez, select **Consent: request refunds**, exchange the new code, and repeat the direct call. The server should confirm submission for Owner approval.",
  4: "As Mira, choose **Consent: read mail**, **Exchange last code**, then **Call mail_read** (`200`). Rotate the refresh token. The previous access token should return `401` and the current one `200`. **Replay previous refresh token** should return `400` and invalidate the current access token too. With a fresh read grant, try an unsigned token, a tampered signature, and a read after **Revoke access** (`401` for each). Exchange a five-second grant and compare a read before and after expiry (`200`, then `401`).",
  5: "As Inez, submit a refund. In **Teams**, select **Open Mira’s session**. Go to **Payments & refunds** in both tabs and select **Send 4 approval requests together** in each. Mira should receive four `403` responses. Inez should receive one `200` and three `409` responses in any order. As Inez, read the ledger and audit trail. Expect one successful approval and zero refunds delivered.",
  6: "As Inez in **Teams**, open Mira’s session in a second tab. As Mira, open **Client records** and confirm **Open my client** works. Keep that tab open. In Inez’s tab choose **Disable Mira**, then return to Mira’s tab and look for **Member signed out**. Re-enable her as Inez and reload Mira’s old tab. It should still be signed out. Check Inez’s **Audit log** for the disable event.",
  7: "As Inez, submit and approve a refund. Select **Simulate provider outage** (`503`), then **Read the payment ledger** and confirm zero deliveries. Select **Interrupt first delivery** (`504`) and read the ledger again. This time the provider recorded one refund before the reply was lost. **Deliver refund** should return `200` with `replayed: true`, and the provider count should stay at one.",
  8: "Select **Inspect server and dependency checks**. Under **Live response headers**, look for `nosniff` and a content security policy containing `frame-ancestors 'none'`. Compare the displayed OSV dependency and ZAP scan results with the linked **Security tools** run. Open **Hosted boundary** for the HTTPS and TLS checks and verify the run used the displayed commit.",
  9: "As Mira, use **Receipt reconciliation** to **Check healthy fixture**, then **Check duplicated receipt**. Both requests should return HTTP `200`. Inspect the returned check itself. The healthy fixture should report `PASS` and zero duplicates, the planted fault `FAIL` and one duplicate. Read the ledger and confirm zero refunds were delivered.",
  10: "As Inez, submit a refund, approve it, then select **Approve refund** again (`409`). In **Audit log**, select **Read audit trail**. Read the three entries from oldest to newest and match Inez’s submit (`200`), approval (`200`), and repeated approval (`409`). **Download exercise report (PDF)** saves the backend receipts. **Download observations** saves the current session activity as JSON.",
  11: "As Mira, choose **Consent: read mail** and **Exchange last code**, then **Read untrusted message**. The fictional email asks for a `refund_request`. Use **Call refund_request directly** to try that instruction under the same grant. Expect `403`. In **Payments & refunds**, read the ledger and confirm the payment is still `open` with zero refunds.",
  12: "As Inez, select **Try a different redirect** and **Try a different audience** (`400` for each), then **Present an upstream token** (`401`). Choose **Consent: read mail** and **Exchange last code**. Compare **Call mail_read** (`200`) with **Call refund_request directly** (`403`). Even Inez’s connector can use only the permission she granted it.",
  13: "Select **Inspect source scan results**. Compare Gitleaks’ source and full-history results with its deleted-secret control. The control should report that it detected the planted secret even after deletion. Compare Semgrep’s source findings with its planted rule examples. Open **Security tools** and match the commit and results to the displayed scan.",
  14: "As Mira, select **Open my client** and copy its `id` from **Latest server response**. Paste it into **Client record ID** and select **Open record by ID** (`200`). Open the demo in a private window, start exercise 14 again as Mira, and open her local client. Its ID should differ. Looking up the first window’s ID here should return `404`. **Inspect my environment** should identify the fictional workspace.",
  15: "Select **Inspect this build’s runs**. Compare the **Deployed revision** with the commit in **Exercise campaign** and **Hosted dashboard exercises**. Inspect the server checks and individual browser results, including any failures or skips. Follow **View workflow source** to see the steps GitHub ran at that revision. If results are missing for that commit, record them as unavailable.",
  16: "As Mira in **Communications**, select **Load markup**, then **Preview message as text**. The markup should remain visible as text. In **Client records**, run **Search client records** after **Load normal search** (one match), then after **Load SQL probe** (zero). In **Payments & refunds**, **Submit with a forged amount** should return `400` and leave the ledger `open`. **Submit refund** should then succeed.",
  17: "As Mira, read the payment ledger and confirm `open`. Select **Prepare outside website**, then **Open the outside website**. On that page try **Send a cross-site form** and **Send a scripted request**. The server should refuse the form and the browser should block the script from reading the response. Back in SecDash, verify the ledger is still `open` with zero refunds. **Submit refund** in the dashboard should succeed.",
  18: "As Mira in **Staff access**, try **Open staff record** (`401`). Select **Get activation code**, enter a demo-only value in **New password**, then select **Set initial password**. Enter it in **Current password**, select **Sign in as staff**, and open the dispatch sheet (`200`). Change the password and confirm the old session and old password are refused. Sign in with the replacement, sign out of staff access, then try five wrong passwords within a minute. The next sign-in should return `429`, even with the correct password.",
  19: "As Mira, open your assigned file and compare it with **Open the other client** (`404`). Your file should omit `billingReference` and your ledger should omit `amountCents`. Try **Deliver refund** (`403`), submit the refund, then try **Approve refund** (`403`). Switch to Inez and inspect the other file and payment amount. Delivery before approval should return `409`. Approve, deliver, and read the ledger. Expect `settled` and exactly one provider refund.",
};
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
  'Under **Explore an exercise yourself**, choose a card and select **Start exercise**. Sign in as Mira (Employee), Theo (Administrator), or Inez (Owner). The exercise opens on its first dashboard screen. For exercises 8, 13, and 15, select **Inspect evidence** to open **Verification results** directly. **Sign out** changes identity within the same exercise. **Teams** lets the Owner open a member in another tab of that workspace. A private browser window represents an independent visitor. Selecting a card under **Choose another exercise** starts a fresh workspace.',
  '',
  'For each review, compare **Latest server response** with the expected outcome in the table. For a denied change, inspect the affected record or ledger afterward. Try the allowed action as well, so you can see that the operation works for an authorized caller. For evidence reviews, compare the displayed checks with the GitHub run for the same commit. You can record the build, date, browser, role, steps, expected and observed outcomes, and a redacted evidence reference in [the blank results sheet](manual-results.csv).',
  '',
  'Before starting another exercise, select **Download exercise report (PDF)**. It records the build, time, identity, server receipt, HTTP status, and relevant returned fields. Payment receipts also show the resulting ledger state and provider refund count. The Owner can export receipts across roles in the same workspace. For an automated run, use **Run all 19 exercises** on the picker. When it finishes, select **Download suite results (PDF)** for the per-exercise verdicts and operation details. The walkthroughs below describe expected behavior. Record your manual verdict from the result you observe.',
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
      walkthroughs[e.n] +
      ' |',
  ),
  '',
  '## ASVS requirement checklist',
  '',
  'The checklist maps all 70 OWASP ASVS 5.0.0 Level 1 requirements to an exercise or a scope decision. Use the linked build evidence and your own observations to assess each requirement. For a scope exclusion, record why it applies to the reviewed build. Earlier manual verdicts identify their tested commit and controls in the [account log](../accounts.md#manual-verification-log).',
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
