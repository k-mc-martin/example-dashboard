import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join, isAbsolute } from 'node:path';
import { mkdirSync } from 'node:fs';
import { lifetimeSeconds } from '../demo-session.ts';
let db: DatabaseSync | undefined;
export function labDb() {
  if (db) return db;
  const dir = process.env.SECDASH_WORKSPACES;
  if (!dir || !isAbsolute(dir)) throw Error('Exercise storage missing');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  db = new DatabaseSync(join(dir, 'security-lab.sqlite'));
  db.exec(
    `PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS review_probes(w TEXT NOT NULL,actor TEXT NOT NULL,handle TEXT UNIQUE NOT NULL,PRIMARY KEY(w,actor));CREATE TABLE IF NOT EXISTS review_receipts(seq INTEGER PRIMARY KEY,w TEXT NOT NULL,actor TEXT NOT NULL,payload TEXT NOT NULL);CREATE INDEX IF NOT EXISTS review_workspace ON review_receipts(w,seq);CREATE TABLE IF NOT EXISTS runs(w TEXT PRIMARY KEY,n INTEGER NOT NULL,expires INTEGER NOT NULL,payment TEXT NOT NULL DEFAULT 'open',receipt INTEGER NOT NULL DEFAULT 0,clientA TEXT NOT NULL,clientB TEXT NOT NULL);CREATE TABLE IF NOT EXISTS trail(id INTEGER PRIMARY KEY,w TEXT NOT NULL,at INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,status INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS trail_workspace ON trail(w,id);CREATE TABLE IF NOT EXISTS staff(w TEXT PRIMARY KEY,activation TEXT,salt TEXT,pw TEXT,session TEXT,expires INTEGER NOT NULL,failures INTEGER DEFAULT 0,window INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS grants(w TEXT NOT NULL,actor TEXT NOT NULL,client TEXT NOT NULL,uri TEXT NOT NULL,aud TEXT NOT NULL,scope TEXT NOT NULL,code TEXT PRIMARY KEY,pkce TEXT NOT NULL,until_ms INTEGER NOT NULL,used INTEGER DEFAULT 0,access TEXT UNIQUE,refresh TEXT UNIQUE,access_end INTEGER DEFAULT 0,expires INTEGER NOT NULL,short INTEGER NOT NULL,binding TEXT NOT NULL);CREATE TABLE IF NOT EXISTS spent(token TEXT PRIMARY KEY,family TEXT NOT NULL);`,
  );
  return db;
}
export const token = () => randomBytes(32).toString('base64url');
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function startRun(w: string, n: number) {
  const d = labDb(),
    now = Date.now();
  d.prepare('DELETE FROM runs WHERE expires<=?').run(now);
  for (const sql of [
    'DELETE FROM review_probes WHERE w NOT IN (SELECT w FROM runs)',
    'DELETE FROM review_receipts WHERE w NOT IN (SELECT w FROM runs)',
    'DELETE FROM trail WHERE w NOT IN (SELECT w FROM runs)',
    'DELETE FROM staff WHERE w NOT IN (SELECT w FROM runs)',
    'DELETE FROM grants WHERE expires<=? OR w NOT IN (SELECT w FROM runs)',
    'DELETE FROM spent WHERE family NOT IN (SELECT code FROM grants)',
  ]) {
    const stmt = d.prepare(sql);
    if (sql.includes('?')) stmt.run(now);
    else stmt.run();
  }
  d.prepare(
    'INSERT INTO runs(w,n,expires,clientA,clientB) VALUES(?,?,?,?,?)',
  ).run(
    w,
    n,
    Number(w.slice(0, 13)) + lifetimeSeconds * 1000,
    token().slice(0, 18),
    token().slice(0, 18),
  );
}
export function runFor(w: string) {
  return labDb()
    .prepare('SELECT * FROM runs WHERE w=? AND expires>?')
    .get(w, Date.now());
}
export function log(w: string, actor: string, action: string, status: number) {
  const d = labDb();
  d.prepare(
    'INSERT INTO trail(w,at,actor,action,status) VALUES(?,?,?,?,?)',
  ).run(w, Date.now(), actor, action, status);
  d.prepare(
    'DELETE FROM trail WHERE w=? AND id < (SELECT id FROM trail WHERE w=? ORDER BY id DESC LIMIT 1 OFFSET 99)',
  ).run(w, w);
}
export class LabError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function fail(status: number, message: string): never {
  throw new LabError(status, message);
}
