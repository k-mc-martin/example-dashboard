import { NextResponse } from 'next/server';
import { exerciseByNumber } from '@/lib/security-lab/catalog';
import { startRun } from '@/lib/security-lab/store';
import {
  demoCookie,
  demoEnabled,
  demoOriginAllowed,
  primaryHost,
  newDemoCookie,
  lifetimeSeconds,
  workspaceId,
} from '@/lib/demo-session';
import {
  currentAccount,
  hasActiveLogin,
  loginCookie,
  endWorkspace,
  retiredWorkspace,
} from '@/lib/demo-login';
export async function POST(req: Request) {
  const previous = workspaceId(req);
  if (
    !demoEnabled() ||
    !demoOriginAllowed(req) ||
    !primaryHost(req.headers.get('host')) ||
    !previous ||
    retiredWorkspace(previous)
  )
    return new Response(null, { status: 403 });
  const body = await req.json().catch(() => null);
  const n = exerciseByNumber(
    body && typeof body === 'object' && 'exercise' in body
      ? body.exercise
      : null,
  )?.n;
  if (!n)
    return Response.json(
      { error: 'Choose a listed exercise.' },
      { status: 400 },
    );
  if (hasActiveLogin(previous) && !currentAccount(req))
    return new Response(null, { status: 403 });
  const cookie = newDemoCookie();
  startRun(cookie.split('.')[0], n);
  endWorkspace(previous);
  const r = NextResponse.json({ exercise: n });
  const flags = {
    httpOnly: true,
    secure: true,
    sameSite: 'strict' as const,
    path: '/',
  };
  r.cookies.set(demoCookie, cookie, { ...flags, maxAge: lifetimeSeconds });
  r.cookies.set(loginCookie, '', { ...flags, maxAge: 0 });
  return r;
}
