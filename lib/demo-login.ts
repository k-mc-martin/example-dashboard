import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { defaultPermissions, demoAccounts, type DemoAccount, type DemoIdentity, type TeamPermissions } from './demo-permissions.ts';
import { newMemberHost, lifetimeSeconds, memberHost, workspaceId } from './demo-session.ts';

export const loginCookie = '__Host-secdash_login';
let registry: DatabaseSync | undefined;
function sessions() {
  if (registry) return registry;
  const dir = process.env.SECDASH_WORKSPACES;
  if (!dir || !isAbsolute(dir)) throw Error('Demo workspace directory is missing');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(dir, 'demo-logins.sqlite'));
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS logins (
      workspace TEXT PRIMARY KEY, token_hash TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS member_sessions (
      host TEXT NOT NULL, workspace TEXT NOT NULL, account TEXT NOT NULL, ticket_hash TEXT UNIQUE,
      redeem_by INTEGER NOT NULL, token_hash TEXT UNIQUE, expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS retired_workspaces(workspace TEXT PRIMARY KEY,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS disabled_members(workspace TEXT NOT NULL, account TEXT NOT NULL, expires INTEGER NOT NULL,PRIMARY KEY(workspace,account));
    CREATE TABLE IF NOT EXISTS team_access (
      workspace TEXT NOT NULL, account TEXT NOT NULL, role TEXT NOT NULL, permissions TEXT NOT NULL,
      expires INTEGER NOT NULL, PRIMARY KEY(workspace, account)
    );`);
  // Earlier local builds used the per-tab hostname as a primary key. Public visitors
  // share DNS names while each ticket and login token identifies its own session.
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='member_tabs'").get()) {
      db.exec(`INSERT INTO member_sessions (host,workspace,account,ticket_hash,redeem_by,token_hash,expires)
        SELECT host,workspace,account,ticket_hash,redeem_by,token_hash,expires FROM member_tabs;
        DROP TABLE member_tabs;`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  registry = db;
  return db;
}

function cookieHash(request: Request) {
  const login = request.headers.get('cookie')?.split(/;\s*/).find(c => c.startsWith(loginCookie + '='))?.slice(loginCookie.length + 1);
  return login && /^[a-f0-9]{64}$/.test(login) ? digest(login) : undefined;
}
export function hasActiveLogin(workspace: string) {
  return !!sessions().prepare('SELECT 1 FROM logins WHERE workspace=? AND expires>?').get(workspace, Date.now());
}
function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function currentAccount(request: Request): DemoAccount | undefined {
  const hash = cookieHash(request);
  const workspace = workspaceId(request);
  if (!hash || !workspace) return;
  const host = request.headers.get('host');
  const row = memberHost(host)
    ? sessions().prepare('SELECT account FROM member_sessions WHERE workspace=? AND host=? AND token_hash=? AND expires>?').get(workspace, host!, hash, Date.now())
    : sessions().prepare('SELECT account FROM logins WHERE workspace=? AND token_hash=? AND expires>?').get(workspace, hash, Date.now());
  const identity = demoAccounts.find(account => account.id === row?.account);
  return identity && !isDisabled(workspace, identity.id) ? effectiveAccount(workspace, identity) : undefined;
}

export function effectiveAccount(workspace: string, identity: DemoIdentity): DemoAccount {
  const row = sessions().prepare('SELECT role,permissions FROM team_access WHERE workspace=? AND account=?').get(workspace, identity.id);
  if (row && identity.role !== 'Owner') {
    return { ...identity, role: row.role as DemoAccount['role'], permissions: JSON.parse(String(row.permissions)) };
  }
  return { ...identity, permissions: defaultPermissions(identity.role) };
}

export function changeTeamAccess(workspace: string, id: string, role: 'Employee' | 'Administrator', permissions: TeamPermissions) {
  sessions().prepare(`INSERT INTO team_access(workspace,account,role,permissions,expires) VALUES(?,?,?,?,?)
    ON CONFLICT(workspace,account) DO UPDATE SET role=excluded.role,permissions=excluded.permissions`)
    .run(workspace, id, role, JSON.stringify(permissions), workspaceExpiry(workspace));
}

function workspaceExpiry(workspace: string) {
  return Number(workspace.slice(0, 13)) + lifetimeSeconds * 1000;
}

export function createMemberTab(workspace: string, id: string) {
  const ticket = randomBytes(32).toString('hex');
  if(isDisabled(workspace,id)) throw Error("This member is disabled.");
  const host = newMemberHost(id);
  sessions().prepare('INSERT INTO member_sessions(host,workspace,account,ticket_hash,redeem_by,expires) VALUES(?,?,?,?,?,?)')
    .run(host, workspace, id, digest(ticket), Date.now() + 60000, workspaceExpiry(workspace));
  return { host, ticket };
}

export function enterMemberTab(host: string, ticket: string) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const row = sessions().prepare(`UPDATE member_sessions SET ticket_hash=NULL, token_hash=?
    WHERE host=? AND ticket_hash=? AND redeem_by>? AND expires>? RETURNING workspace, expires`)
    .get(digest(token), host, digest(ticket), now, now);
  return row && { token, workspace: String(row.workspace), expires: Number(row.expires) };
}

// A visitor can try each fictional identity. Its sign-in pass applies to that workspace and account alone.
export function demoPass(workspace: string, account: DemoIdentity) {
  return createHmac('sha256', process.env.SECDASH_SESSION_SECRET!).update('demo-login:' + workspace + ':' + account.id).digest('hex');
}
export function issueLogin(workspace: string, id: unknown, pass: unknown) {
  const account = demoAccounts.find(entry => entry.id === id);
  if (!account || isDisabled(workspace,account.id) || typeof pass !== 'string' || !/^[a-f0-9]{64}$/.test(pass)) return;
  if (!timingSafeEqual(Buffer.from(pass, 'hex'), Buffer.from(demoPass(workspace, account), 'hex'))) return;
  const token = randomBytes(32).toString('hex');
  const db = sessions();
  db.prepare('DELETE FROM logins WHERE expires<=?').run(Date.now());
  db.prepare('DELETE FROM member_sessions WHERE expires<=? OR (ticket_hash IS NOT NULL AND redeem_by<=?)').run(Date.now(), Date.now());
  db.prepare('DELETE FROM team_access WHERE expires<=?').run(Date.now());
  const inserted = db.prepare('INSERT INTO logins(workspace, token_hash, account, expires) VALUES(?,?,?,?) ON CONFLICT(workspace) DO NOTHING')
    .run(workspace, digest(token), account.id, Number(workspace.slice(0, 13)) + lifetimeSeconds * 1000);
  return inserted.changes ? { account: effectiveAccount(workspace, account), token } : undefined;
}
export function revokeLogin(request: Request, workspace: string) {
  const hash = cookieHash(request);
  if (!hash) return;
  const host = request.headers.get('host');
  if (memberHost(host)) {
    sessions().prepare('DELETE FROM member_sessions WHERE workspace=? AND host=? AND token_hash=?').run(workspace, host!, hash);
    return;
  }
  sessions().prepare('DELETE FROM logins WHERE workspace=? AND token_hash=?').run(workspace, hash);
}

export function isDisabled(w:string,id:string){return !!sessions().prepare('SELECT 1 FROM disabled_members WHERE workspace=? AND account=? AND expires>?').get(w,id,Date.now())}
export function disableMember(w:string,id:string,disabled:boolean){
 const db=sessions(); if(!demoAccounts.some(a=>a.id===id&&a.role!=='Owner'))throw Error('Unknown member');
 db.exec('BEGIN IMMEDIATE');try{
 if(disabled){
 db.prepare('DELETE FROM disabled_members WHERE expires<=?').run(Date.now());
 db.prepare('INSERT OR REPLACE INTO disabled_members VALUES(?,?,?)').run(w,id,workspaceExpiry(w));
 db.prepare('DELETE FROM member_sessions WHERE workspace=? AND account=?').run(w,id);
 db.prepare('DELETE FROM logins WHERE workspace=? AND account=?').run(w,id);
 }else db.prepare('DELETE FROM disabled_members WHERE workspace=? AND account=?').run(w,id);
 db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e}
}
export function retiredWorkspace(w:string){return !!sessions().prepare('SELECT 1 FROM retired_workspaces WHERE workspace=? AND expires>?').get(w,Date.now());}
export function endWorkspace(w:string){const d=sessions();d.prepare('DELETE FROM retired_workspaces WHERE expires<=?').run(Date.now());d.prepare('INSERT OR REPLACE INTO retired_workspaces VALUES(?,?)').run(w,workspaceExpiry(w));d.prepare('DELETE FROM logins WHERE workspace=?').run(w);d.prepare('DELETE FROM member_sessions WHERE workspace=?').run(w);}

export function loginBinding(request:Request){return cookieHash(request)||'';}
export function boundIdentity(w:string,id:string,binding:string){
 const db=sessions(),now=Date.now();
 const row=db.prepare('SELECT account FROM logins WHERE workspace=? AND token_hash=? AND expires>? UNION ALL SELECT account FROM member_sessions WHERE workspace=? AND token_hash=? AND expires>?').get(w,binding,now,w,binding,now);
 const who=demoAccounts.find(a=>a.id===id&&a.id===row?.account);
 return who&&!isDisabled(w,id)?effectiveAccount(w,who):undefined;
}
