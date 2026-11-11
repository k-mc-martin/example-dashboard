import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { demoAccounts } from './demo-permissions.ts';

export const demoCookie = '__Host-secdash_workspace';
export const lifetimeSeconds = 8 * 60 * 60;
export function demoEnabled() {
  return process.env.SECDASH_DEMO_MODE === '1';
}

export function demoPort() {
  return process.env.SECDASH_DEMO_PORT || '5286';
}
// Public hostnames come from deployment configuration. Forwarded headers cannot select an origin.
export function demoScheme() {
  return process.env.SECDASH_PUBLIC_HOST ? 'https://' : 'http://';
}
export function newMemberHost(id: string) {
  if (!process.env.SECDASH_PUBLIC_HOST) return 'member-' + randomBytes(16).toString('hex') + '.localhost:' + demoPort();
  const domain = process.env.SECDASH_MEMBER_DOMAIN;
  if (!domain || !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || !demoAccounts.some(member => member.role !== 'Owner' && member.id === id)) {
    throw Error('Invalid hosted member configuration');
  }
  return id + '.' + domain;
}
export function memberHost(host: string | null) {
  if (process.env.SECDASH_PUBLIC_HOST) {
    return demoAccounts.some(member => member.role !== 'Owner' && host === newMemberHost(member.id));
  }
  return !!host && host.endsWith(':' + demoPort()) && /^member-[a-f0-9]{32}\.localhost:[0-9]+$/.test(host);
}
export function primaryHost(host: string | null) {
  if (process.env.SECDASH_PUBLIC_HOST) return host === process.env.SECDASH_PUBLIC_HOST;
  return host === 'localhost:' + demoPort() || host === '127.0.0.1:' + demoPort();
}

export function demoOriginAllowed(request: Request) {
  const host = request.headers.get('host');
  if (!primaryHost(host) && !memberHost(host)) return false;
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site)) return false;
  return (
    ((request.method === 'GET' || request.method === 'HEAD') && !origin) || origin === demoScheme() + host
  );
}

function sign(id: string, host?: string | null) {
  const key = process.env.SECDASH_SESSION_SECRET;
  if (!key || key.length < 32) throw Error('The demo session signing key is missing');
  return createHmac('sha256', key).update(memberHost(host ?? null) ? host + '/' + id : id).digest('hex');
}
export function newDemoCookie() {
  const id = Date.now() + '-' + randomBytes(16).toString('hex');
  return signedWorkspace(id);
}
export function signedWorkspace(id: string, host?: string) {
  return id + '.' + sign(id, host);
}
export function workspaceId(request: Request, name = demoCookie) {
  const value = request.headers
    .get('cookie')
    ?.split(/;\s*/)
    .find((x) => x.startsWith(name + '='))
    ?.slice(name.length + 1);
  const match = /^(\d{13}-[a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value ?? '');
  if (!match) return null;
  const age = Date.now() - Number(match[1].slice(0, 13));
  if (age < 0 || age >= lifetimeSeconds * 1000) return null;
  return timingSafeEqual(Buffer.from(sign(match[1], request.headers.get('host')), 'hex'), Buffer.from(match[2], 'hex'))
    ? match[1]
    : null;
}

export function attackHost(){
 return process.env.SECDASH_PUBLIC_HOST?'attack.'+process.env.SECDASH_MEMBER_DOMAIN:'outside.localhost:'+demoPort();
}
