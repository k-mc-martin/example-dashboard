import { authorized, denied } from '@/lib/server-auth';
import { demoEnabled, workspaceId } from '@/lib/demo-session';
import { withDashboardDb } from '@/lib/demo-db';
import { advance } from '@/lib/demo-events';
export async function POST(request: Request) {
  if (!demoEnabled() || !authorized(request, 'operator')) return denied(request);
  const expected = request.headers.get('if-match');
  if (!expected || !/^\d{1,5}$/.test(expected))
    return Response.json({ error: 'A workspace revision is required.' }, { status: 400 });
  try {
    return Response.json(
      await withDashboardDb(request, (db) => advance(db, workspaceId(request)!, Number(expected))),
    );
  } catch {
    return Response.json(
      { error: 'The demo providers could not deliver this event. Try again.' },
      { status: 503 },
    );
  }
}
