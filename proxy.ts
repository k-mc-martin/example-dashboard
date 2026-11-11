import { randomBytes } from 'node:crypto';
import { demoEnabled, demoOriginAllowed, primaryHost, attackHost, memberHost, demoCookie, newDemoCookie, workspaceId, lifetimeSeconds } from './lib/demo-session';
import { currentAccount, retiredWorkspace, hasActiveLogin } from "./lib/demo-login";
import { NextResponse, type NextRequest } from "next/server";
import { authorized, denied } from "./lib/server-auth";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const site = request.headers.get('sec-fetch-site');
  if (path === '/version' && demoEnabled() && primaryHost(request.headers.get('host')) &&
      ['GET', 'HEAD'].includes(request.method)) {
    const commit = process.env.SECDASH_REVISION ?? '';
    if (!/^[a-f0-9]{40}$/.test(commit)) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ commit, source: 'https://github.com/k-mc-martin/example-dashboard/tree/' + commit },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (demoEnabled() && primaryHost(request.headers.get('host')) && ['GET', 'HEAD'].includes(request.method) &&
      (path === '/launch' || (path === '/' && (site === 'cross-site' || site === 'same-site')))) {
    // Commit a first-party page before reading Strict cookies. Returning visitors
    // retain their existing workspace when they follow an external link.
    const nonce = randomBytes(16).toString('base64');
    return new NextResponse(request.method === 'HEAD' ? null : `<!doctype html><html lang="en"><meta charset="utf-8"><title>Launch SecDash</title>
      <a href="/">Open SecDash</a><script nonce="${nonce}">location.replace('/')</script></html>`, {headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    }});
  }
  const role = ["/api/n8n/messages", "/api/n8n/provider-connections", "/api/n8n/drive-storage", "/api/n8n/operations"].includes(request.nextUrl.pathname) ? "ingest" : "operator";
  const localDemo = demoEnabled() && demoOriginAllowed(request);
  const workspace = localDemo ? workspaceId(request) : null;
  const member = demoEnabled() && memberHost(request.headers.get('host'));
  const handoff = member && request.method === 'POST' && request.nextUrl.pathname === '/api/demo/enter';
  const entering = !member && localDemo && request.method === "GET" && request.nextUrl.pathname === "/" &&
    (!workspace || retiredWorkspace(workspace) || (hasActiveLogin(workspace) && !currentAccount(request)));
  const publicAsset = path.startsWith("/_next/static/") || path === "/favicon.svg" || path.startsWith("/brand/");
  const publicRead = (request.method === "GET" || request.method === "HEAD") && (path === "/" || publicAsset);
  const sessionRoute = path === "/api/demo/session" && !!workspace;
  const exerciseEvidence = path === '/api/demo/evidence' && request.method === 'GET' && !!workspace;
  const exerciseSetup = path === '/api/demo/exercise' && request.method === 'POST' && !!workspace;
  const authenticatedLab = path === '/api/demo/lab' && !!workspace && !!currentAccount(request);
  const resource = path === '/api/demo/mcp' && demoEnabled() && (primaryHost(request.headers.get('host')) || member) && (!request.headers.has('origin') || localDemo);
  if(path==='/api/demo/mcp' && demoEnabled() && !resource)return new NextResponse(null,{status:403});
  const hostilePage = demoEnabled() && path === '/attack-site' && request.headers.get('host')===attackHost() && request.method === 'GET';
  const demoEntry = resource || hostilePage || (localDemo && (publicRead || sessionRoute || exerciseEvidence || exerciseSetup || authenticatedLab));
  if (!handoff && !demoEntry && !authorized(request, role)) return denied(request);
  let response;
  if (path === "/") {
    const nonce = randomBytes(16).toString("base64");
    const dev = process.env.NODE_ENV === "development";
    const policy = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
      dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
      "img-src 'self' data:", "font-src 'self'", "connect-src 'self'",
      "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    ].join("; ");
    // Next reads the request policy to nonce its bootstrap and streamed scripts.
    const headers = new Headers(request.headers);
    headers.set("Content-Security-Policy", policy);
    response = NextResponse.next({ request: { headers } });
    response.headers.set("Content-Security-Policy", policy);
  } else {
    response = NextResponse.next();
  }
  if (entering) {
    // Preserve a signed, pre-login workspace from the earlier loopback preview.
    const previous = !workspace && workspaceId(request, "secdash_workspace");
    const reusable = previous && !hasActiveLogin(previous) && request.cookies.get("secdash_workspace");
    response.cookies.set(demoCookie, reusable ? reusable.value : newDemoCookie(),
      {httpOnly:true, secure:true, sameSite:"strict", path:"/", maxAge:lifetimeSeconds});
    if (previous) response.cookies.delete("secdash_workspace");
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  // A cross-origin form POST from the launch page needs its Origin for the member handoff.
  response.headers.set("Referrer-Policy", path === "/api/demo/member-tab" ? "origin" : "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: "/:path*" };
