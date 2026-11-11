import { authorized, denied } from '@/lib/server-auth';
import { demoEnabled } from '@/lib/demo-session';
import { withDashboardDb } from '@/lib/demo-db';
import { backupCatalog } from '@/lib/demo-events';
async function catalog(request: Request) {
  if (!demoEnabled() || !authorized(request, 'operator')) return denied(request);
  if (request.method === 'POST') {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !('action' in body) || body.action !== 'sync')
      return Response.json({ error: 'Expected a sync action.' }, { status: 400 });
  }
  if (!authorized(request, 'operator')) return denied(request);
  try {
    return Response.json(
      await withDashboardDb(request, (db) => backupCatalog(db, request.method === 'POST')),
    );
  } catch {
    return Response.json({ error: 'Waiting for the first fictional snapshot.' }, { status: 503 });
  }
}
export { catalog as GET, catalog as POST };
