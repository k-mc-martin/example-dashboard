import { authorized, denied } from '@/lib/server-auth';
import { demoEnabled } from '@/lib/demo-session';
import { withDashboardDb } from '@/lib/demo-db';
import { state } from '@/lib/demo-events';
export async function GET(request: Request) {
  if (!demoEnabled() || !authorized(request, 'operator')) return denied(request);
  const platform = new URL(request.url).searchParams.get('platform');
  const current = await withDashboardDb(request, state);
  const published = current && JSON.parse(current.published);
  const asset = published?.installers.find((i: { platform: string }) => i.platform === platform);
  if (!asset) return Response.json({ error: 'Unknown release artifact.' }, { status: 404 });
  return Response.json(
    { simulated: true, version: published.version, filename: asset.filename, bytes: asset.bytes },
    { headers: { 'Content-Disposition': 'attachment; filename="sample-release-manifest.json"' } },
  );
}
