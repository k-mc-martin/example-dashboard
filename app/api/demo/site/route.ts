import { demoEnabled } from '@/lib/demo-session';
import { releaseSites } from '@/lib/release-sites';
import { authorized, denied } from '@/lib/server-auth';

// Older dashboard tabs and bookmarks still use these channel URLs.
export function GET(request: Request) {
  if (!demoEnabled() || !authorized(request, 'operator')) return denied(request);
  const channel = new URL(request.url).searchParams.get('channel');
  if (channel !== 'public' && channel !== 'beta') return new Response(null, { status: 404 });
  return Response.redirect(releaseSites[channel], 302);
}
