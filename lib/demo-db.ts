import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { SQLiteDatabase, getDb } from '../db/index.ts';
import { demoEnabled, lifetimeSeconds, workspaceId } from './demo-session.ts';

let lastCleanup = 0;
export async function withDashboardDb<T>(
  request: Request,
  use: (db: SQLiteDatabase) => Promise<T> | T,
): Promise<T> {
  if (!demoEnabled()) return use(getDb());
  const id = workspaceId(request);
  const dir = process.env.SECDASH_WORKSPACES;
  if (!id || !dir || !isAbsolute(dir)) throw Error('Demo workspace unavailable');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const now = Date.now();
  if (now - lastCleanup > 60000) {
    lastCleanup = now;
    for (const name of readdirSync(dir)) {
      const match = /^(\d{13})-[a-f0-9]{32}\.sqlite$/.exec(name);
      if (match && now - Number(match[1]) > (lifetimeSeconds + 120) * 1000) {
        try {
          unlinkSync(join(dir, name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
  }
  const db = new SQLiteDatabase(join(dir, id + '.sqlite'));
  try {
    return await use(db);
  } finally {
    db.close();
  }
}
