import { runFor } from '@/lib/security-lab/store';
import { NextResponse } from 'next/server';
import {
  currentAccount,
  effectiveAccount,
  retiredWorkspace,
  demoPass,
  isDisabled,
  hasActiveLogin,
  issueLogin,
  loginCookie,
  revokeLogin,
} from '@/lib/demo-login';
import { demoAccounts } from '@/lib/demo-permissions';
import {
  demoEnabled,
  demoOriginAllowed,
  memberHost,
  lifetimeSeconds,
  workspaceId,
} from '@/lib/demo-session';

function workspace(request: Request) {
  const id =
    demoEnabled() && demoOriginAllowed(request) && workspaceId(request);
  return id && !retiredWorkspace(id) && id;
}
function refused() {
  return NextResponse.json(
    { error: 'Open the demo dashboard to start a workspace.' },
    { status: 401 },
  );
}
const options = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict' as const,
  path: '/',
};
export function GET(request: Request) {
  const id = workspace(request);
  if (!id) return refused();
  const account = currentAccount(request);
  const exercise = Number(runFor(id)?.n) || null;
  const revision = process.env.SECDASH_REVISION || 'local';
  if (account)
    return NextResponse.json({
      account,
      exercise,
      revision,
      memberTab: memberHost(request.headers.get('host')),
      expiresAt: Number(id.slice(0, 13)) + lifetimeSeconds * 1000,
    });
  if (memberHost(request.headers.get('host')))
    return NextResponse.json({ account: null, choices: [], memberTab: true });
  if (hasActiveLogin(id)) return refused();
  return NextResponse.json({
    account: null,
    exercise,
    revision,
    choices: demoAccounts
      .filter((entry) => !isDisabled(id, entry.id))
      .map((entry) => ({
        ...effectiveAccount(id, entry),
        pass: demoPass(id, entry),
      })),
  });
}
export async function POST(request: Request) {
  const id = workspace(request);
  if (!id) return refused();
  if (currentAccount(request))
    return NextResponse.json(
      { error: 'Sign out before choosing another account.' },
      { status: 409 },
    );
  if (memberHost(request.headers.get('host'))) return refused();
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== 'object' ||
    !('id' in body) ||
    !('pass' in body) ||
    Object.keys(body).length !== 2
  )
    return NextResponse.json(
      { error: 'Invalid demo sign-in.' },
      { status: 401 },
    );
  const login = issueLogin(id, body.id, body.pass);
  if (!login)
    return NextResponse.json(
      { error: 'Invalid demo sign-in.' },
      { status: 401 },
    );
  const response = NextResponse.json({ account: login.account });
  response.cookies.set(loginCookie, login.token, {
    ...options,
    maxAge: lifetimeSeconds,
  });
  return response;
}
export function DELETE(request: Request) {
  const id = workspace(request);
  if (!id) return refused();
  if (hasActiveLogin(id) && !currentAccount(request)) return refused();
  revokeLogin(request, id);
  const response = NextResponse.json({ account: null });
  response.cookies.set(loginCookie, '', { ...options, maxAge: 0 });
  return response;
}
