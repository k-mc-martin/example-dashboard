import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { SQLiteDatabase, SQLitePreparedStatement } from '../db/index.ts';
import { inboundMessage, messageKey } from './inbound.ts';
import { messageWithFeedbackStatements } from './feedback-store.ts';
import { validateFeedbackEvidence } from './feedback.ts';
import { connectionStatement, inboundProviderConnection } from './inbound-provider-connection.ts';
import { driveStorageStatement, inboundDriveStorage } from './inbound-drive-storage.ts';
import { operationStatement, parseOperation } from './inbound-operations.ts';
import { parseBackupCatalogResponse } from './backup-catalog.ts';

const release = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publishedAt: z.string().datetime(),
  installers: z
    .array(
      z.object({
        platform: z.enum(['Windows', 'Mac']),
        arch: z.string().max(60),
        filename: z.string().regex(/^ExampleApp_[\d.]+\.(exe|dmg)$/),
        available: z.literal(true),
        bytes: z.number().int().positive(),
        url: z.enum(['/api/demo/artifact?platform=Windows', '/api/demo/artifact?platform=Mac']),
      }),
    )
    .length(2),
});
const inputs = z.object({
  step: z.number().int().positive(),
  observedAt: z.string().datetime(),
  release,
  messages: z.array(inboundMessage).min(1).max(12),
  connections: z.array(inboundProviderConnection).length(4),
  drive: inboundDriveStorage,
  operations: z.array(z.unknown()).length(5),
});

type State = {
  step: number;
  time: number;
  published: string;
  catalog: string;
  backupStarted: number | null;
};
export function state(db: SQLiteDatabase) {
  db.native.exec(
    'CREATE TABLE IF NOT EXISTS simulation_state (id INTEGER PRIMARY KEY CHECK(id=1),step INTEGER NOT NULL,time INTEGER NOT NULL,published TEXT NOT NULL,catalog TEXT NOT NULL,backupStarted INTEGER)',
  );
  return db.native.prepare('SELECT * FROM simulation_state WHERE id=1').get() as State | undefined;
}
export async function advance(db: SQLiteDatabase, id: string, expected: number) {
  const before = state(db);
  const current = before?.step ?? 0;
  if (current !== expected) return { step: current };
  const time = Math.max(Date.now(), (before?.time ?? 0) + 1);
  const start = Number(id.slice(0, 13));
  const seed = createHash('sha256').update(id).digest().readUInt32BE();
  const step = current + 1;
  const url = process.env.DUPDASH_N8N_WEBHOOK;
  if (
    !['http://127.0.0.1:5790/webhook/dupdash-events', 'http://n8n:5678/webhook/dupdash-events'].includes(
      url ?? '',
    )
  )
    throw Error('Demo workflow unavailable');
  const response = await fetch(url!, {
    method: 'POST',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step, seed, start, time }),
  });
  if (!response.ok) throw Error('Demo workflow failed');
  const at = new Date(time).toISOString();
  const envelope = z
    .object({
      feeds: z
        .array(
          z.object({
            name: z.string(),
            step: z.literal(step),
            observedAt: z.literal(at),
            value: z.unknown(),
          }),
        )
        .length(9),
    })
    .parse(await response.json());
  const values = Object.fromEntries(envelope.feeds.map((feed) => [feed.name, feed.value]));
  const frame = inputs.parse({
    step,
    observedAt: at,
    release: values.releases,
    messages: values.mail,
    connections: values.accounts,
    drive: values.drive,
    operations: [values.sales, values.edge, values.signing, values.domains, values.recovery],
  });
  if (
    frame.step !== step ||
    frame.observedAt !== at ||
    frame.drive.observedAt !== at ||
    new Set(frame.connections.map((c) => c.provider)).size !== 4
  )
    throw Error('Incomplete demo snapshot');
  const statements: SQLitePreparedStatement[] = [];
  for (const m of frame.messages) {
    if (m.feedback && !validateFeedbackEvidence(m.feedback, m)) throw Error('Invalid feedback');
    statements.push(
      ...(await messageWithFeedbackStatements(db, await messageKey(m.source, m.messageId), m, at)),
    );
  }
  statements.push(
    ...frame.connections.map((c) => connectionStatement(db, c, at)),
    driveStorageStatement(db, frame.drive, at),
  );
  const surfaces = new Set<string>();
  let catalog = null;
  for (const item of frame.operations) {
    const sample = parseOperation(item);
    if (!sample || sample.observedAt !== at || surfaces.has(sample.surface))
      throw Error('Invalid operation');
    surfaces.add(sample.surface);
    statements.push(operationStatement(db, sample, at));
    if (sample.surface === 'recovery') {
      const data = item as { data: { backupCatalog: { libraries: unknown[] } } };
      catalog = parseBackupCatalogResponse({
        schemaVersion: 1,
        serverTime: at,
        source: {
          kind: 'n8n-recovery-feed',
          observedAt: at,
          receivedAt: at,
          status: 'current',
          detail: 'Simulated recovery provider',
        },
        update: {
          state: 'idle',
          jobId: null,
          startedAt: null,
          finishedAt: null,
          phase: null,
          summary: 'Ready to sync demo snapshots.',
        },
        libraries: [
          ...data.data.backupCatalog.libraries,
          {
            id: 'cold-storage',
            name: 'Archive',
            mode: 'verified-offload',
            setup: 'initialized',
            eligibleForSync: false,
            phase: 'complete',
            summary: 'Archived sample snapshot.',
            destinations: [
              {
                id: 'archive',
                label: 'Demo archive',
                kind: 'cold-storage',
                status: 'current',
                lastSnapshot: { snapshotId: 'sample-archive', createdAt: at, sizeBytes: 12000 },
                lastVerification: { status: 'passed', verifiedAt: at, snapshotId: 'sample-archive' },
                history: [],
              },
            ],
          },
        ],
      });
    }
  }
  if (!catalog) throw Error('Invalid backup catalog');
  const serializedCatalog = JSON.stringify(catalog);
  // Compare again inside the transaction. Concurrent clicks and retries share one event.
  return db.transaction(() => {
    const latest = state(db)?.step ?? 0;
    if (latest !== current) return { step: latest };
    for (const statement of statements) statement.executeForBatch();
    db.native
      .prepare(
        'INSERT INTO simulation_state(id,step,time,published,catalog) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET step=excluded.step,time=excluded.time,published=excluded.published,catalog=excluded.catalog',
      )
      .run(step, time, JSON.stringify(frame.release), serializedCatalog);
    db.native.exec(
      'DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY received_at DESC,id DESC LIMIT -1 OFFSET 500)',
    );
    db.native.exec(
      'DELETE FROM drive_storage_samples WHERE observed_at IN (SELECT observed_at FROM drive_storage_samples ORDER BY observed_at DESC LIMIT -1 OFFSET 288)',
    );
    db.native
      .prepare(
        "DELETE FROM operational_observations WHERE observed_at < COALESCE((SELECT observed_at FROM operational_observations GROUP BY observed_at ORDER BY observed_at DESC LIMIT 1 OFFSET 47),'')",
      )
      .run();
    return { step };
  });
}

export function backupStatus(db: SQLiteDatabase, startJob = false) {
  const current = state(db);
  if (!current) throw Error('Workspace not ready');
  const now = Date.now();
  if (startJob) {
    db.native.prepare(`UPDATE simulation_state SET backupStarted=? WHERE id=1
      AND (backupStarted IS NULL OR backupStarted<=?)`).run(now, now - 4000);
  }
  const started = startJob ? state(db)!.backupStarted : current.backupStarted;
  return jobStatus(started, current.time, now);
}

function jobStatus(started: number | null, sampleTime: number, now: number) {
  const running = started !== null && now - started < 4000;
  const timestamp = started ?? sampleTime - 4000;
  return {
    jobId: 'sample-' + timestamp,
    state: running ? 'running' : 'succeeded',
    startedAt: new Date(timestamp).toISOString(),
    finishedAt: running ? null : new Date(timestamp + 4000).toISOString(),
    summary: running ? 'Creating a sample snapshot.' : 'Sample snapshot verified.',
    ...(running ? {} : { snapshotId: 'snapshot-' + timestamp }),
  };
}
export function backupCatalog(db: SQLiteDatabase, startJob = false) {
  const current = state(db);
  if (!current) throw Error('Workspace not ready');
  const catalog = JSON.parse(current.catalog);
  // A single dashboard backup and a library-wide sync are independently authorized operations.
  db.native.exec('CREATE TABLE IF NOT EXISTS simulation_library_sync (id INTEGER PRIMARY KEY CHECK(id=1), started INTEGER NOT NULL)');
  const now = Date.now();
  if (startJob) {
    db.native.prepare(`INSERT INTO simulation_library_sync(id,started) VALUES(1,?)
      ON CONFLICT(id) DO UPDATE SET started=excluded.started WHERE started<=?`).run(now, now - 4000);
  }
  const sync = db.native.prepare('SELECT started FROM simulation_library_sync WHERE id=1').get();
  const job = jobStatus(sync ? Number(sync.started) : null, current.time, now);
  catalog.update = { ...job, phase: job.state === 'running' ? 'snapshotting' : 'complete' };
  if (sync && job.state === 'succeeded') {
    for (const library of catalog.libraries)
      if (library.eligibleForSync) {
        for (const dest of library.destinations) {
          dest.lastSnapshot = {
            ...dest.lastSnapshot,
            snapshotId: job.snapshotId,
            createdAt: job.finishedAt,
          };
          dest.lastVerification = {
            snapshotId: job.snapshotId,
            status: 'passed',
            verifiedAt: job.finishedAt,
          };
          dest.history.push({
            id: job.jobId,
            kind: 'snapshot',
            status: 'succeeded',
            occurredAt: job.finishedAt,
            snapshotId: job.snapshotId,
            summary: job.summary,
          });
        }
      }
  }
  return catalog;
}
