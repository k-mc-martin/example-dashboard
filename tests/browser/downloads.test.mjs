import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base =
  process.env.SECDASH_BROWSER_TARGET ||
  'http://127.0.0.1:' + (process.env.SECDASH_DEMO_PORT || '5286');
test(
  'both visitor paths export actual decisions and keep reports isolated',
  { timeout: 18 * 60_000 },
  async (t) => {
    const dir =
      process.env.SECDASH_REPORT_SAMPLES ||
      (await mkdtemp(join(tmpdir(), 'secdash-pdfs-')));
    await mkdir(dir, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      async function enter() {
        const page = await browser.newPage();
        await page.goto(base + '/launch');
        await page
          .getByRole('heading', { name: 'Choose an exercise' })
          .waitFor();
        return page;
      }
      async function download(page, label, file) {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.getByRole('link', { name: label }).click(),
        ]);
        const path = join(dir, file);
        await download.saveAs(path);
        return execFileSync('pdftotext', ['-layout', path, '-'], {
          encoding: 'utf8',
        }).replace(/\s+/g, ' ');
      }
      const page = await enter();
      await page
        .getByRole('button', { name: 'Run all 19 exercises', exact: true })
        .click();
      await page.getByRole('button', { name: 'Review in progress' }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: 'Review in progress' }).waitFor();
      const other = await enter();
      assert.equal(
        await other.getByRole('button', { name: 'Review in progress' }).count(),
        0,
      );
      assert.notEqual(
        (await other.request.get(base + '/api/demo/suite?download=1')).status(),
        200,
      );
      await other
        .getByRole('article')
        .filter({
          has: other.getByRole('heading', {
            name: 'Account permissions',
            exact: true,
          }),
        })
        .getByRole('button')
        .click();
      await other.getByRole('button', { name: 'Sign in as Employee' }).click();
      const act = async (label) => {
        const [r] = await Promise.all([
          other.waitForResponse(
            (r) =>
              r.url().endsWith('/api/demo/lab') &&
              r.request().method() === 'POST' &&
              r.request().postDataJSON()?.action ===
                (label === 'Approve refund' ? 'approve' : 'submit'),
          ),
          other.getByRole('button', { name: label, exact: true }).click(),
        ]);
        return r;
      };
      await act('Submit refund');
      const denied = await act('Approve refund');
      assert.equal(denied.status(), 403);
      const receipt = denied.headers()['x-secdash-receipt'];
      assert.ok(receipt);
      assert.match(
        await download(other, 'Download exercise report (PDF)', 'employee.pdf'),
        new RegExp(receipt),
      );
      await other
        .getByRole('button', { name: 'Sign out', exact: true })
        .click();
      await other.getByRole('button', { name: 'Sign in as Administrator' }).click();
      const [deployed] = await Promise.all([
        other.waitForResponse(r => r.url().endsWith('/api/demo/deployments') && r.request().method() === 'POST'),
        other.getByRole('button', { name: 'Launch preview deployment', exact: true }).click(),
      ]);
      const deployReceipt = deployed.headers()['x-secdash-receipt'];
      assert.equal(deployed.status(), 201);
      assert.ok(deployReceipt);
      const admin = await download(other, 'Download exercise report (PDF)', 'administrator.pdf');
      for (const fact of [deployReceipt, 'Theo Reed', 'HTTP 201', 'Preview deployments=1'])
        assert.ok(admin.includes(fact), fact);
      assert.ok(!admin.includes(receipt), 'Theo cannot export Mira’s receipts');
      await other.getByRole('button', { name: 'Sign out', exact: true }).click();
      await other.getByRole('button', { name: 'Sign in as Owner' }).click();
      assert.equal((await act('Approve refund')).status(), 200);
      const manual = await download(
        other,
        'Download exercise report (PDF)',
        'exercise.pdf',
      );
      for (const literal of [
        receipt,
        deployReceipt,
        'Theo Reed',
        'Mira Chen',
        'HTTP 403',
        'Owner permission required',
        'Inez Park',
        'HTTP 200',
        'Ledger after request: approved',
        'provider refunds=0',
      ])
        assert.ok(manual.includes(literal), literal);
      assert.equal(
        (
          await other.request.post(base + '/api/demo/report', {
            headers: { Origin: base },
            data: { action: 'approve', status: 200 },
          })
        ).ok(),
        false,
      );
      t.diagnostic(
        'Manual PDF matched the server receipt, role, refusal, approval, and ledger. Second visitor cannot download the suite.',
      );
      const link = page.getByRole('link', {
        name: 'Download suite results (PDF)',
      });
      await link.waitFor({ timeout: 16 * 60_000 });
      const suite = await download(
        page,
        'Download suite results (PDF)',
        'suite.pdf',
      );
      assert.match(suite, /19 passed \/ 0 failed \/ 0 incomplete/);
      for (let n = 1; n <= 19; n++)
        assert.match(suite, new RegExp('Exercise ' + n + ' -'));
      for (const literal of [
        'HTTP 403',
        'HTTP 504',
        'providerRefunds=1',
        'Server receipt',
        'HTTP 429',
        'GET /api/demo/evidence',
        'theo / Administrator',
        'Preview deployments=1',
        'POST /api/backup-catalog',
      ])
        assert.ok(suite.includes(literal), literal);
      assert.equal(
        (await other.request.get(base + '/api/demo/suite?download=1')).ok(),
        false,
      );
      t.diagnostic('One click completed all 19 and downloaded all results.');
    } finally {
      await browser.close();
      if (!process.env.SECDASH_REPORT_SAMPLES)
        await rm(dir, { recursive: true, force: true });
    }
  },
);
