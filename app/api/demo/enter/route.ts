import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { enterMemberTab, loginCookie } from '@/lib/demo-login';
import { demoCookie, demoEnabled, demoScheme, memberHost, primaryHost, signedWorkspace } from '@/lib/demo-session';

export async function POST(request: Request) {
  const host = request.headers.get('host');
  const origin = request.headers.get('origin') ?? '';
  if (!demoEnabled() || !memberHost(host) || !origin.startsWith(demoScheme()) || !primaryHost(origin.slice(demoScheme().length)))
    return new Response('Open a member session from Teams.', { status: 403 });
  const form = await request.formData().catch(() => null);
  const ticket = form?.get('ticket');
  const session = typeof ticket === 'string' && /^[a-f0-9]{64}$/.test(ticket) && enterMemberTab(host!, ticket);
  if (!session) return new Response('This link has expired or was already used. Open a new tab from Teams.', { status: 403 });
  const nonce = randomBytes(16).toString('base64');
  // Establish a first-party document before navigating with the new SameSite=Strict cookies.
  const response = new NextResponse(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Member dashboard</title>
    <a href="/">Open member dashboard</a><script nonce="${nonce}">location.replace('/')</script></html>`, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
  } });
  const options = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/', maxAge: Math.ceil((session.expires - Date.now()) / 1000) };
  response.cookies.set(demoCookie, signedWorkspace(session.workspace, host!), options);
  response.cookies.set(loginCookie, session.token, options);
  return response;
}
