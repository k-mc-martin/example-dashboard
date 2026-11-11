import { callTool } from '@/lib/security-lab/connector';
import { LabError } from '@/lib/security-lab/store';
import {
  demoEnabled,
  demoOriginAllowed,
  demoScheme,
  primaryHost,
  memberHost,
} from '@/lib/demo-session';
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
export async function POST(req: Request) {
  const host = req.headers.get('host');
  if (
    !demoEnabled() ||
    (!primaryHost(host) && !memberHost(host)) ||
    (req.headers.has('origin') && !demoOriginAllowed(req))
  )
    return new Response(null, { status: 403 });
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer [A-Za-z0-9_.-]{1,2048}$/.test(auth))
    return Response.json(
      { error: 'Bearer token required' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return new Response(null, { status: 415 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b))
    return new Response(null, { status: 400 });
  try {
    const data = callTool(
      auth.slice(7),
      demoScheme() + host,
      b as Record<string, unknown>,
    );
    return data ? Response.json(data) : new Response(null, { status: 202 });
  } catch (e) {
    if (e instanceof LabError)
      return Response.json(
        {
          jsonrpc: '2.0',
          id: 'id' in b ? b.id : null,
          error: { code: -32000, message: e.message },
        },
        { status: e.status },
      );
    throw e;
  }
}
