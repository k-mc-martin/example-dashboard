import { observedOperations } from '@/lib/review/manual';
import { withDashboardDb } from '@/lib/demo-db';
import { authorized, denied } from '@/lib/server-auth';
import { readOperations, readOperationSurface } from '@/lib/inbound-operations';
import { operationSurfaces } from '@/lib/operations';

async function read(request: Request) {
  if (!authorized(request, 'operator')) return denied(request);
  const requested = new URL(request.url).searchParams.get('surface');
  const surface = operationSurfaces.find(value => value === requested);
  if (requested !== null && !surface) return Response.json({ error: 'Unknown surface.' }, { status: 400 });
  try {
    const data = await withDashboardDb(request, async db => surface ? {
      surfaces: { [surface]: await readOperationSurface(db, surface, surface === 'recovery') },
      serverTime: new Date().toISOString(),
    } : readOperations(db));
    return Response.json(data, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return Response.json({ error: 'Operational history unavailable' }, { status: 503 });
  }
}

export function GET(request: Request) { return observedOperations(request, read); }
