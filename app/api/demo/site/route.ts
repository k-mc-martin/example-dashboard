import { demoEnabled } from '@/lib/demo-session';
import { authorized, denied } from '@/lib/server-auth';
import { withDashboardDb } from '@/lib/demo-db';
import { state } from '@/lib/demo-events';
export async function GET(request: Request) {
  if (!demoEnabled() || !authorized(request, 'operator')) return denied(request);
  const channel = new URL(request.url).searchParams.get('channel');
  if (channel !== 'beta' && channel !== 'public') return new Response(null, { status: 404 });
  const current = await withDashboardDb(request, state);
  if (!current) return new Response(null, { status: 404 });
  const version = JSON.parse(current.published).version;
  const text =
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ExampleApp releases</title><main><h1>ExampleApp ' +
    channel +
    ' releases</h1><p>Fictional release ' +
    version +
    '</p><p><a href="/api/demo/artifact?platform=Windows">Windows sample manifest</a> · <a href="/api/demo/artifact?platform=Mac">Mac sample manifest</a></p></main></html>';
  return new Response(text, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'",
    },
  });
}
