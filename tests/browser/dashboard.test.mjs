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
let browser;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome' });
});
after(async () => {
  await browser?.close();
});

async function start(page, number, role = 'Owner') {
  await page.goto(origin + '/launch');
  const exercise = catalog.find((item) => item.n === number);
  const card = page
    .getByRole('article')
    .filter({
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
  // Find the action through the currently selected dashboard tab.
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
}

test('Mira submits a refund in Payments & refunds and Inez approves the same payment', async () => {
  const page = await browser.newPage({ viewport: { width: 850, height: 850 } });
  try {
    await start(page, 1, 'Employee');
    const panel = page.getByRole('tabpanel', { name: 'Payments & refunds' });
    const payment = panel.getByRole('region', { name: 'Payment details' });
    await payment.getByText('No refund requested').waitFor();
    assert.equal(await payment.getByText('Payment amount').count(), 0);
    await action(page, 'Submit refund', 200);
    await payment.getByText('Awaiting approval').waitFor();
    await action(page, 'Approve refund', 403);
    await payment.getByText('Awaiting approval').waitFor();
    await page.getByRole('tab', { name: /Website & releases/ }).click();
    await openScreen(page, 'Payments & refunds');
    await panel.getByText('Latest server response · 403').waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in as Owner' }).click();
    await payment.getByText('Awaiting approval').waitFor();
    await payment.getByText('INV-410').waitFor();
    await action(page, 'Approve refund', 200);
    await payment.getByText('Approved', { exact: true }).waitFor();
    await payment.getByText('PAY-104').waitFor();
  } finally {
    await page.close();
  }
});

test('Every exercise opens its business screens through dashboard navigation', async () => {
  for (const exercise of catalog) {
    const page = await browser.newPage();
    try {
      await start(page, exercise.n);
      for (const id of screensForExercise(exercise)) {
        const panel = await openScreen(page, workspaceScreens[id].title);
        await panel
          .locator('summary')
          .filter({ hasText: 'Exercise ' + exercise.n + ' ·' })
          .waitFor();
        if (exercise.category === 'Evidence') {
          await panel.getByRole('link', { name: 'View GitHub runs' }).waitFor();
          assert.equal(await page.getByRole('tab').count(), 1);
          await panel.getByRole('button', { name: /^Inspect/ }).click();
          await panel.getByText(/Deployed revision ·/).waitFor();
          if (exercise.n === 8)
            await panel
              .getByRole('heading', { name: 'Live response headers' })
              .waitFor();
        } else {
          const controls = panel
            .locator('.workspace-actions')
            .getByRole('button');
          assert.ok(
            await controls.count(),
            exercise.title + ' needs an action in ' + id,
          );
          const expected = exercise.actions
            .filter((action) => workspaceScreens[id].actions.includes(action))
            .sort();
          const rendered = await panel
            .locator('[data-workspace-action]')
            .evaluateAll((elements) =>
              elements
                .map((element) => element.getAttribute('data-workspace-action'))
                .sort(),
            );
          assert.deepEqual(rendered, expected, exercise.title + ' in ' + id);
        }
      }
    } finally {
      await page.close();
    }
  }
});

test('A visitor can read a client file and follow its refund into the ledger', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await start(page, 19, 'Employee');
    const clients = await openScreen(page, 'Client records');
    await action(page, 'Open my client', 200);
    await clients
      .getByRole('region', { name: 'Action result' })
      .getByText('Fern Studio')
      .first()
      .waitFor();
    await action(page, 'Open the other client', 404);
    await openScreen(page, 'Payments & refunds');
    await action(page, 'Submit refund', 200);
    await action(page, 'Approve refund', 403);
    await openScreen(page, 'Client records');
    await clients.getByText('Latest server response · 404').waitFor();
  } finally {
    await page.close();
  }
});

test('Connector credentials can be rotated and replayed from the dashboard', async () => {
  const page = await browser.newPage();
  try {
    await start(page, 4, 'Employee');
    await openScreen(page, 'Connectors');
    await action(page, 'Consent: read mail', 200);
    await action(page, 'Exchange last code', 200);
    await action(page, 'Call mail_read', 200);
    await action(page, 'Rotate refresh token', 200);
    await action(page, 'Call mail_read with previous token', 401);
    await action(page, 'Call mail_read', 200);
    await action(page, 'Replay previous refresh token', 400);
    await action(page, 'Call mail_read', 401);
  } finally {
    await page.close();
  }
});

test('The owner can disable an employee already reading a client file in another tab', async () => {
  const page = await browser.newPage();
  try {
    await start(page, 6);
    const teams = await openScreen(page, 'Teams');
    const [member] = await Promise.all([
      page.context().waitForEvent('page'),
      teams.getByRole('button', { name: 'Open Mira’s session' }).click(),
    ]);
    await openScreen(member, 'Client records');
    await action(member, 'Open my client', 200);
    await action(page, 'Disable Mira', 200);
    await member
      .getByRole('heading', { name: 'Member signed out' })
      .waitFor({ timeout: 12000 });
    await action(page, 'Re-enable Mira', 200);
    await member.reload();
    await member.getByRole('heading', { name: 'Member signed out' }).waitFor();
    await openScreen(page, 'Audit log');
    await action(page, 'Read audit trail', 200);
    await page.getByRole('cell', { name: 'disable', exact: true }).waitFor();
  } finally {
    await page.close();
  }
});
