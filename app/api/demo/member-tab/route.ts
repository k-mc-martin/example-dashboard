import { randomBytes } from 'node:crypto';
import { createMemberTab } from '@/lib/demo-login';
import { demoAccounts } from '@/lib/demo-permissions';
import { demoEnabled, demoScheme, workspaceId } from '@/lib/demo-session';
import { authorized, denied } from '@/lib/server-auth';

export async function POST(request: Request) {
  if (!demoEnabled() || !authorized(request, 'operator')) return denied(request);
  const form = await request.formData().catch(() => null);
  const member = demoAccounts.find(account => account.id === form?.get('member') && account.role !== 'Owner');
  if (!member) return Response.json({ error: 'Choose a team member.' }, { status: 400 });
  if (!authorized(request, 'operator')) return denied(request);
  const { host, ticket } = createMemberTab(workspaceId(request)!, member.id);
  const destination = demoScheme() + host;
  const nonce = randomBytes(16).toString('base64');
  // The short-lived one-use ticket travels in the request body, outside URLs and browser history.
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="origin"><title>Open member session</title>
    <form method="post" action="${destination}/api/demo/enter"><input type="hidden" name="ticket" value="${ticket}">
    <button>Continue to ${member.name}’s dashboard</button></form>
    <script nonce="${nonce}">document.forms[0].submit()</script></html>`, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'origin',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${destination}; frame-ancestors 'none'; base-uri 'none'`,
  } });
}
