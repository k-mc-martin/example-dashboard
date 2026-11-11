import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type WireRecord = {
  at: string;
  method: string;
  path: string;
  operation: string;
  identity: string;
  status: number | null;
  receipt?: string;
  facts: string[];
};
export type CaseResult = {
  n: number;
  title: string;
  criterion: string;
  verdict: 'passed' | 'failed' | 'running';
  records: WireRecord[];
  note?: string;
};
export type SuiteJob = {
  id: string;
  revision: string;
  state: 'queued' | 'running' | 'complete' | 'interrupted';
  created: number;
  updated: number;
  cases: string;
};
let db: DatabaseSync;
export function suiteDb() {
  if (!db) {
    db = new DatabaseSync(
      process.env.SECDASH_SUITE_DB || '/suite-jobs/runs.sqlite',
    );
    db.exec(
      'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,revision TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,updated INTEGER NOT NULL,cases TEXT NOT NULL);CREATE INDEX IF NOT EXISTS jobs_owner ON jobs(owner,created);',
    );
  }
  return db;
}
const retention = 8 * 60 * 60 * 1000;
export function latestJob(owner: string) {
  return suiteDb()
    .prepare(
      'SELECT id,revision,state,created,updated,cases FROM jobs WHERE owner=? AND created>? ORDER BY created DESC LIMIT 1',
    )
    .get(owner, Date.now() - retention) as SuiteJob | undefined;
}
export function enqueue(owner: string, revision: string, again: boolean) {
  const d = suiteDb(),
    now = Date.now();
  d.exec('BEGIN IMMEDIATE');
  let commit = true;
  try {
    d.prepare('DELETE FROM jobs WHERE created<?').run(now - retention);
    const old = latestJob(owner);
    if (old && (!again || old.state === 'queued' || old.state === 'running'))
      return old;
    if (
      Number(
        d
          .prepare(
            "SELECT count(*) AS count FROM jobs WHERE state IN ('queued','running')",
          )
          .get()?.count,
      ) >= 6
    )
      return null;
    d.prepare("INSERT INTO jobs VALUES(?,?,?,'queued',?,?,'[]')").run(
      randomUUID(),
      owner,
      revision,
      now,
      now,
    );
    return latestJob(owner);
  } catch (error) {
    commit = false;
    throw error;
  } finally {
    d.exec(commit ? 'COMMIT' : 'ROLLBACK');
  }
}
export function claim(revision: string) {
  const d = suiteDb(),
    now = Date.now();
  d.prepare(
    "UPDATE jobs SET state='interrupted',updated=? WHERE (state='running' AND updated<?) OR (state='queued' AND revision<>?)",
  ).run(now, now - 90000, revision);
  return d
    .prepare(
      "UPDATE jobs SET state='running',updated=? WHERE id=(SELECT id FROM jobs WHERE state='queued' AND revision=? ORDER BY created LIMIT 1) RETURNING id",
    )
    .get(now, revision)?.id as string | undefined;
}
