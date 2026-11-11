import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { claim, suiteDb } from '../../lib/review/queue.ts';

const revision = process.env.SECDASH_REVISION || 'local';
const port = Number(process.env.SECDASH_DEMO_PORT || 5286);
if (!process.env.SECDASH_BROWSER_TARGET) {
  // Preserve the browser origins used by the normal local dashboard and its member tabs.
  createServer((socket) => {
    const upstream = connect(3000, 'dashboard');
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  }).listen(port, '127.0.0.1');
}
async function run(id) {
  const dir = await mkdtemp(join(tmpdir(), 'secdash-review-')),
    file = join(dir, 'evidence.json');
  const child = spawn(
    process.execPath,
    ['--test', '--test-reporter=tap', 'tests/browser/dashboard.test.mjs'],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
      detached: true,
      env: {
        ...process.env,
        SECDASH_SUITE_OUTPUT: file,
        SECDASH_EXPECT_REVISION: revision,
      },
    },
  );
  const done = new Promise((resolve) => {
    child.once('error', () => resolve(-1));
    child.once('close', resolve);
  });
  const deadline = setTimeout(
    () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    },
    15 * 60 * 1000,
  );
  const update = suiteDb().prepare(
    "UPDATE jobs SET cases=?,updated=?,state=? WHERE id=? AND state='running'",
  );
  let records = [];
  async function sync(state) {
    try {
      records = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    update.run(JSON.stringify(records), Date.now(), state, id);
  }
  try {
    let ended = false;
    done.then(() => {
      ended = true;
    });
    while (!ended) {
      await sync('running');
      await Promise.race([done, delay(1500)]);
    }
    await sync('running');
    const complete =
      records.length === 19 &&
      records.every((c) => c.verdict === 'passed' || c.verdict === 'failed');
    await sync(complete ? 'complete' : 'interrupted');
  } finally {
    clearTimeout(deadline);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* Already exited. */
    }
    await rm(dir, { recursive: true, force: true });
  }
}
for (;;) {
  try {
    const id = claim(revision);
    if (id) await run(id);
    else await delay(1500);
  } catch (e) {
    console.error('Suite runner:', e.code || e.name);
    await delay(3000);
  }
}
