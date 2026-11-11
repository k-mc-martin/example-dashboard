import {beginCase,finishCase,observeContext} from './suite-observer.mjs';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import {
  catalog,
  screensForExercise,
  workspaceScreens,
} from '../../lib/security-lab/catalog.ts';

const origin =
  process.env.SECDASH_BROWSER_TARGET ||
  'http://127.0.0.1:' + (process.env.SECDASH_DEMO_PORT || '5286');
const hosted = new URL(origin).protocol === 'https:';
const diagnostics = new WeakMap();
let browser;
before(async () => {
  browser = await chromium.launch(process.env.SECDASH_CHROME_PATH ? {executablePath:process.env.SECDASH_CHROME_PATH} : {channel:'chrome'});
});
after(async () => {
  await browser?.close();
});

async function start(page, number, role = 'Owner') {
  observeContext(page.context());
  // The public launch endpoint accepts twelve workspaces per minute.
  if (hosted) await new Promise((resolve) => setTimeout(resolve, 5500));
  await page.goto(origin + '/launch');
  const exercise = catalog.find((item) => item.n === number);
  const card = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: exercise.title, exact: true }),
  });
  await card.getByRole('button').click();
  if (exercise.category !== 'Evidence')
    await page.getByRole('button', { name: 'Sign in as ' + role }).click();
  await page.getByRole('tablist', { name: 'SecDash sections' }).waitFor();
}
async function openScreen(page, name) {
  const tab = page.getByRole('tab', { name, exact: false });
  await tab.click();
  const panel = page.getByRole('tabpanel');
  await panel.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(await tab.getAttribute('aria-selected'), 'true');
  return panel;
}
async function action(page, name, expected) {
  // Wait for a new activity entry when consecutive actions return the same HTTP status.
  const panel = page.getByRole('tabpanel');
  const history = panel.locator('.workspace-receipts li');
  const before = await history.count();
  await panel.getByRole('button', { name, exact: true }).click();
  await panel
    .getByText('Session activity (' + (before + 1) + ')', { exact: true })
    .waitFor();
  await panel
    .getByText('Latest server response · ' + expected, { exact: true })
    .waitFor();
  diagnostics.get(page.context())?.diagnostic(name + ' → HTTP ' + expected);
  return JSON.parse(
    await panel
      .getByRole('region', { name: 'Action result' })
      .locator('pre')
      .textContent(),
  );
}

const payments = 'Payments & refunds';
const clients = 'Client records';
const ledger = (p) => action(p, 'Read the payment ledger', 200);
const submit = (p) => action(p, 'Submit refund', 200);
const approve = (p, status = 200) => action(p, 'Approve refund', status);
const read = (p, status = 200) => action(p, 'Call mail_read', status);
async function consent(page, label = 'Consent: read mail') {
  await action(page, label, 200);
  await action(page, 'Exchange last code', 200);
}
async function switchRole(page, role) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in as ' + role }).click();
}
async function openMira(owner) {
  const teams = await openScreen(owner, 'Teams');
  const [member] = await Promise.all([
    owner.context().waitForEvent('page'),
    teams.getByRole('button', { name: 'Open Mira’s session' }).click(),
  ]);
  return member;
}

async function inspectEvidence(page, n, label) {
  const panel = await openScreen(page, 'Verification results');
  assert.equal(await page.getByRole('tab').count(), 1);
  const pending = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/demo/evidence',
  );
  await panel.getByRole('button', { name: label }).click();
  const response = await pending;
  assert.equal(response.status(), 200);
  const report = await response.json();
  await panel.getByText(report.commit, { exact: true }).waitFor();
  const workflow = n === 15 ? 'campaign' : 'security-tools';
  assert.equal(
    await panel
      .getByRole('link', { name: 'View GitHub runs' })
      .getAttribute('href'),
    'https://github.com/k-mc-martin/example-dashboard/actions/workflows/' +
      workflow +
      '.yml',
  );
  if (hosted) {
    const deployed = await (await page.request.get(origin + '/version')).json();
    assert.match(deployed.commit, /^[a-f0-9]{40}$/);
    assert.equal(report.commit, deployed.commit);
    if (process.env.SECDASH_EXPECT_REVISION)
      assert.equal(report.commit, process.env.SECDASH_EXPECT_REVISION);
    const check =
      n === 8
        ? 'OSV dependencies'
        : n === 13
          ? 'Gitleaks deleted-secret control'
          : 'Browser checks';
    await panel.getByText(check, { exact: true }).waitFor();
    const runName =
      n === 8
        ? 'Hosted boundary'
        : n === 13
          ? 'Security tools'
          : 'Exercise campaign';
    const run = report.runs.find((row) => row.title === runName);
    assert.ok(run);
    assert.equal(
      await panel
        .getByRole('link', { name: runName, exact: true })
        .getAttribute('href'),
      'https://github.com/k-mc-martin/example-dashboard/actions/runs/' + run.id,
    );
    diagnostics
      .get(page.context())
      .diagnostic(
        check +
          ' and ' +
          runName +
          ' matched deployed commit ' +
          deployed.commit,
      );
  } else if (!report.runs.length) {
    await panel
      .getByText(/Run evidence for this revision has not been published/)
      .waitFor();
    diagnostics
      .get(page.context())
      .diagnostic(
        'Unpublished local revision displayed without a fabricated CI result',
      );
  }
  return { panel, report };
}

const registered = new Set();
function scenario(n, role, description, perform) {
  const exercise = catalog.find((item) => item.n === n);
  assert.ok(exercise && !registered.has(n));
  registered.add(n);
  test(
    'Exercise ' +
      String(n).padStart(2, '0') +
      ' — ' +
      exercise.title +
      ' — ' +
      description,
    async (t) => {
      beginCase(n,exercise.title,description);
      let passed=false;
      const page = await browser.newPage({
        viewport:
          n === 19 ? { width: 390, height: 844 } : { width: 980, height: 850 },
      });
      page.setDefaultTimeout(15000);
      diagnostics.set(page.context(), t);
      try {
        await start(page, n, role);
        const screens = screensForExercise(exercise);
        for (const id of screens) {
          const panel = await openScreen(page, workspaceScreens[id].title);
          await panel
            .locator('summary')
            .filter({ hasText: 'Exercise ' + n + ' ·' })
            .waitFor();
          const expected = exercise.actions
            .filter((name) => workspaceScreens[id].actions.includes(name))
            .sort();
          const visible = await panel
            .locator('[data-workspace-action]')
            .evaluateAll((elements) =>
              elements
                .map((el) => el.getAttribute('data-workspace-action'))
                .sort(),
            );
          assert.deepEqual(visible, expected);
        }
        await openScreen(page, workspaceScreens[screens[0]].title);
        await perform(page);
        passed=true;
      } finally {
        await finishCase(passed,passed?undefined:"An assertion or browser step did not complete. Inspect the preceding responses and retry.");
        await page.close();
      }
    },
  );
}

scenario(
  1,
  'Employee',
  'Mira submits and Inez approves the same refund',
  async (p) => {
    const payment = p.getByRole('region', { name: 'Payment details' });
    await payment.getByText('No refund requested').waitFor();
    assert.equal(await payment.getByText('Payment amount').count(), 0);
    await submit(p);
    await approve(p, 403);
    assert.equal((await ledger(p)).state, 'submitted');
    await openScreen(p, 'Website & releases');
    await openScreen(p, payments);
    await switchRole(p, 'Owner');
    await payment.getByText('INV-410').waitFor();
    await approve(p);
    assert.equal((await ledger(p)).state, 'approved');
  },
);

scenario(
  2,
  'Employee',
  'another employee’s client is withheld and approval is denied',
  async (p) => {
    assert.equal((await action(p, 'Open my client', 200)).assigned, 'mira');
    assert.equal(
      (await action(p, 'Open the other client', 404)).client,
      undefined,
    );
    await openScreen(p, payments);
    await submit(p);
    await approve(p, 403);
    assert.equal((await ledger(p)).state, 'submitted');
    await switchRole(p, 'Owner');
    await openScreen(p, clients);
    assert.equal(
      (await action(p, 'Open the other client', 200)).assigned,
      'theo',
    );
    await openScreen(p, payments);
    await approve(p);
  },
);

scenario(
  3,
  'Employee',
  'read scope permits mail and denies refunds until an Owner grants write access',
  async (p) => {
    await consent(p);
    assert.deepEqual(
      (await action(p, 'List visible tools', 200)).result.tools.map(
        (t) => t.name,
      ),
      ['mail_read'],
    );
    await read(p);
    await action(p, 'Call refund_request directly', 403);
    await switchRole(p, 'Owner');
    await consent(p, 'Consent: request refunds');
    assert.match(
      (await action(p, 'Call refund_request directly', 200)).result.content[0]
        .text,
      /refund submitted/i,
    );
  },
);

scenario(
  4,
  'Employee',
  'rotated, replayed, expired, forged and revoked credentials are refused',
  async (p) => {
    await consent(p);
    await read(p);
    await action(p, 'Rotate refresh token', 200);
    await action(p, 'Call mail_read with previous token', 401);
    await read(p);
    await action(p, 'Replay previous refresh token', 400);
    await read(p, 401);
    await consent(p);
    await action(p, 'Try an unsigned token', 401);
    await action(p, 'Tamper with the signature', 401);
    await action(p, 'Revoke access', 200);
    await read(p, 401);
    await consent(p, 'Consent: five-second token');
    await read(p);
    await new Promise((resolve) => setTimeout(resolve, 5100));
    await read(p, 401);
  },
);

scenario(
  5,
  'Owner',
  'overlapping employee and Owner approvals produce one state change',
  async (p) => {
    await submit(p);
    const mira = await openMira(p);
    await openScreen(p, payments);
    await openScreen(mira, payments);
    // Arrival order is nondeterministic. Read each of the four returned statuses.
    async function burst(tab) {
      const panel = tab.getByRole('tabpanel');
      await panel
        .getByRole('button', { name: 'Send 4 approval requests together' })
        .click();
      await panel
        .getByRole('region', { name: 'Action result' })
        .locator('pre')
        .filter({ hasText: '"attempts"' })
        .waitFor({ state: 'attached' });
      return JSON.parse(
        await panel
          .getByRole('region', { name: 'Action result' })
          .locator('pre')
          .textContent(),
      )
        .attempts.map((x) => x.status)
        .sort();
    }
    const [owner, employee] = await Promise.all([burst(p), burst(mira)]);
    assert.deepEqual(owner, [200, 409, 409, 409]);
    assert.deepEqual(employee, [403, 403, 403, 403]);
    const state = await ledger(p);
    assert.equal(state.state, 'approved');
    assert.equal(state.providerRefunds, 0);
    await openScreen(p, 'Audit log');
    const audit = await action(p, 'Read audit trail', 200);
    assert.equal(
      audit.events.filter((e) => e.action === 'approve' && e.status === 200)
        .length,
      1,
    );
  },
);

scenario(
  6,
  'Owner',
  'disabling Mira invalidates her open tab through re-enablement',
  async (p) => {
    const mira = await openMira(p);
    await openScreen(mira, clients);
    await action(mira, 'Open my client', 200);
    await action(p, 'Disable Mira', 200);
    await mira.getByRole('heading', { name: 'Member signed out' }).waitFor();
    await action(p, 'Re-enable Mira', 200);
    await mira.reload();
    await mira.getByRole('heading', { name: 'Member signed out' }).waitFor();
    await openScreen(p, 'Audit log');
    await action(p, 'Read audit trail', 200);
    await p.getByRole('cell', { name: 'disable', exact: true }).waitFor();
  },
);

scenario(
  7,
  'Owner',
  'retries after an outage and a lost reply deliver exactly one refund',
  async (p) => {
    await submit(p);
    await approve(p);
    await action(p, 'Simulate provider outage', 503);
    assert.equal((await ledger(p)).providerRefunds, 0);
    await action(p, 'Interrupt first delivery', 504);
    assert.equal((await ledger(p)).providerRefunds, 1);
    assert.equal((await action(p, 'Deliver refund', 200)).replayed, true);
    assert.equal((await ledger(p)).providerRefunds, 1);
  },
);

scenario(
  8,
  null,
  'inspect actual launch headers and locate the deployment and dependency evidence',
  async (p) => {
    const { panel } = await inspectEvidence(
      p,
      8,
      'Inspect server and dependency checks',
    );
    await panel
      .getByRole('heading', { name: 'Live response headers' })
      .waitFor();
    await panel.getByText('nosniff', { exact: true }).waitFor();
    await panel.getByText(/frame-ancestors 'none'/).waitFor();
  },
);

scenario(
  9,
  'Employee',
  'a duplicated receipt fails the check while the healthy receipt passes',
  async (p) => {
    assert.equal((await action(p, 'Check healthy fixture', 200)).duplicates, 0);
    const faulty = await action(p, 'Check duplicated receipt', 200);
    assert.match(faulty.uniqueReceiptCheck, /FAIL/);
    assert.equal(faulty.duplicates, 1);
    assert.equal((await ledger(p)).providerRefunds, 0);
  },
);

scenario(
  10,
  'Owner',
  'a repeated approval is refused and the ordered audit can be exported',
  async (p) => {
    await submit(p);
    await approve(p);
    await approve(p, 409);
    await openScreen(p, 'Audit log');
    const audit = await action(p, 'Read audit trail', 200);
    assert.deepEqual(
      audit.events
        .filter((e) => ['approve', 'submit'].includes(e.action))
        .map((e) => [e.actor, e.action, e.status]),
      [
        ['inez', 'approve', 409],
        ['inez', 'approve', 200],
        ['inez', 'submit', 200],
      ],
    );
    const [download] = await Promise.all([
      p.waitForEvent('download'),
      p.getByRole('button', { name: 'Download observations' }).click(),
    ]);
    assert.equal(download.suggestedFilename(), 'secdash-exercise-10.json');
    const chunks = [];
    for await (const chunk of await download.createReadStream())
      chunks.push(chunk);
    const report = JSON.parse(Buffer.concat(chunks));
    assert.equal(report.exercise, 10);
    assert.ok(
      report.observations.some(
        (o) =>
          o.screen === 'payments' && o.action === 'approve' && o.status === 409,
      ),
    );
  },
);

scenario(
  11,
  'Employee',
  'a planted email is readable but its requested refund has no effect',
  async (p) => {
    await consent(p);
    const message = await action(p, 'Read untrusted message', 200);
    assert.match(message.result.content[0].text, /refund_request/);
    await action(p, 'Call refund_request directly', 403);
    await openScreen(p, payments);
    assert.equal((await ledger(p)).state, 'open');
  },
);

scenario(
  12,
  'Owner',
  'wrong redirect, audience and upstream token fail while consented mail works',
  async (p) => {
    await action(p, 'Try a different redirect', 400);
    await action(p, 'Try a different audience', 400);
    await action(p, 'Present an upstream token', 401);
    await consent(p);
    await read(p);
    await action(p, 'Call refund_request directly', 403);
  },
);

scenario(
  13,
  null,
  'inspect history scanning and the deleted-secret positive control',
  async (p) => {
    const { panel, report } = await inspectEvidence(
      p,
      13,
      'Inspect source scan results',
    );
    if (hosted) {
      await panel.getByText('Gitleaks full history', { exact: true }).waitFor();
      assert.match(
        report.checks.find((c) => c.name === 'Gitleaks deleted-secret control')
          .detail,
        /detected/i,
      );
    }
  },
);

scenario(
  14,
  'Employee',
  'a record from a different visitor is refused',
  async (p) => {
    const mine = await action(p, 'Open my client', 200);
    await p.getByLabel('Client record ID').fill(mine.id);
    assert.equal(
      (await action(p, 'Open record by ID', 200)).client,
      mine.client,
    );
    const other = await browser.newPage();
    try {
      await start(other, 14, 'Employee');
      const their = await action(other, 'Open my client', 200);
      assert.notEqual(their.id, mine.id);
      await other.getByLabel('Client record ID').fill(mine.id);
      await action(other, 'Open record by ID', 404);
      assert.equal(
        (await action(other, 'Inspect my environment', 200)).source,
        'Fictional workspace',
      );
    } finally {
      await other.close();
    }
  },
);

scenario(
  15,
  null,
  'inspect build provenance and its rerunnable campaign workflow',
  async (p) => {
    const { panel, report } = await inspectEvidence(
      p,
      15,
      'Inspect this build’s runs',
    );
    const href = await panel
      .getByRole('link', { name: 'View workflow source' })
      .getAttribute('href');
    assert.equal(
      href,
      'https://github.com/k-mc-martin/example-dashboard/blob/' +
        (hosted ? report.commit : 'main') +
        '/.github/workflows/campaign.yml',
    );
  },
);

scenario(
  16,
  'Employee',
  'markup stays inert, SQL input returns no records, and a forged amount is refused',
  async (p) => {
    await p.getByRole('button', { name: 'Load markup' }).click();
    assert.equal(
      (await action(p, 'Preview message as text', 200)).preview,
      '<img src=x onerror=alert(1)>',
    );
    assert.equal(
      await p
        .getByRole('region', { name: 'Action result' })
        .locator('img')
        .count(),
      0,
    );
    await openScreen(p, clients);
    await p.getByRole('button', { name: 'Load normal search' }).click();
    assert.equal(
      (await action(p, 'Search client records', 200)).matches.length,
      1,
    );
    await p.getByRole('button', { name: 'Load SQL probe' }).click();
    assert.deepEqual(
      (await action(p, 'Search client records', 200)).matches,
      [],
    );
    await openScreen(p, payments);
    await action(p, 'Submit with a forged amount', 400);
    assert.equal((await ledger(p)).state, 'open');
    await submit(p);
  },
);

scenario(
  17,
  'Employee',
  'the outside site’s form and script leave the ledger unchanged',
  async (p) => {
    await action(p, 'Prepare outside website', 200);
    const [outside] = await Promise.all([
      p.context().waitForEvent('page'),
      p.getByRole('link', { name: 'Open the outside website' }).click(),
    ]);
    const formResponse = p
      .context()
      .waitForEvent(
        'response',
        (r) =>
          r.request().method() === 'POST' &&
          new URL(r.url()).origin === origin && new URL(r.url()).pathname === '/api/demo/lab',
      );
    await outside
      .getByRole('button', { name: 'Send a cross-site form' })
      .click();
    assert.ok([401, 403, 405].includes((await formResponse).status()));
    await outside
      .getByRole('button', { name: 'Send a scripted request' })
      .click();
    await outside.getByText(/browser blocked access/).waitFor();
    assert.equal((await ledger(p)).state, 'open');
    await submit(p);
  },
);

scenario(
  18,
  'Employee',
  'a protected staff record requires login and rejects the previous password after rotation',
  async (p) => {
    const first = crypto.randomUUID(),
      next = crypto.randomUUID();
    const password = p.getByLabel('Current password'),
      replacement = p.getByLabel('New password');
    await action(p, 'Open staff record', 401);
    await action(p, 'Get activation code', 200);
    await replacement.fill(first);
    await action(p, 'Set initial password', 200);
    await password.fill(first);
    await action(p, 'Sign in as staff', 200);
    assert.match(
      (await action(p, 'Open staff record', 200)).record,
      /dispatch sheet/,
    );
    await password.fill(first);
    await replacement.fill(next);
    await action(p, 'Change password', 200);
    await action(p, 'Open staff record', 401);
    await password.fill(first);
    await action(p, 'Sign in as staff', 401);
    await password.fill(next);
    await action(p, 'Sign in as staff', 200);
    await action(p, 'Sign out staff', 200);
    for (let i = 0; i < 5; i++) {
      await password.fill(first);
      await action(p, 'Sign in as staff', 401);
    }
    await password.fill(next);
    await action(p, 'Sign in as staff', 429);
  },
);

scenario(
  19,
  'Employee',
  'mobile client fields and refund delivery follow role and approval order',
  async (p) => {
    const mine = await action(p, 'Open my client', 200);
    assert.equal(mine.client, 'Fern Studio');
    assert.equal('billingReference' in mine, false);
    await action(p, 'Open the other client', 404);
    await openScreen(p, payments);
    await action(p, 'Deliver refund', 403);
    await submit(p);
    await approve(p, 403);
    assert.equal('amountCents' in (await ledger(p)), false);
    await switchRole(p, 'Owner');
    await openScreen(p, clients);
    assert.ok((await action(p, 'Open the other client', 200)).billingReference);
    await openScreen(p, payments);
    await action(p, 'Deliver refund', 409);
    await approve(p);
    await action(p, 'Deliver refund', 200);
    const result = await ledger(p);
    assert.equal(result.providerRefunds, 1);
    assert.equal(result.state, 'settled');
  },
);

assert.deepEqual(
  [...registered].sort((a, b) => a - b),
  catalog.map((e) => e.n),
  'Every exercise needs a named functional test',
);
