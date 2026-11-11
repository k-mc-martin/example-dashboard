import { demoEnabled, demoOriginAllowed, memberHost, demoCookie, newDemoCookie, workspaceId, lifetimeSeconds } from './lib/demo-session';
import { currentAccount, hasActiveLogin } from "./lib/demo-login";
import { NextResponse, type NextRequest } from "next/server";
import { authorized, denied } from "./lib/server-auth";

export function proxy(request: NextRequest) {
  const role = ["/api/n8n/messages", "/api/n8n/provider-connections", "/api/n8n/drive-storage", "/api/n8n/operations"].includes(request.nextUrl.pathname) ? "ingest" : "operator";
  const localDemo = demoEnabled() && demoOriginAllowed(request);
  const workspace = localDemo ? workspaceId(request) : null;
  const member = demoEnabled() && memberHost(request.headers.get('host'));
  const handoff = member && request.method === 'POST' && request.nextUrl.pathname === '/api/demo/enter';
  const entering = !member && localDemo && request.method === "GET" && request.nextUrl.pathname === "/" &&
    (!workspace || (hasActiveLogin(workspace) && !currentAccount(request)));
  const path = request.nextUrl.pathname;
  const publicAsset = path.startsWith("/_next/static/") || path === "/favicon.svg" || path.startsWith("/brand/");
  const publicRead = (request.method === "GET" || request.method === "HEAD") && (path === "/" || publicAsset);
  const sessionRoute = path === "/api/demo/session" && !!workspace;
  const demoEntry = localDemo && (publicRead || sessionRoute);
  if (!handoff && !demoEntry && !authorized(request, role)) return denied(request);
  const response = NextResponse.next();
  if (entering) {
    // Preserve a signed, pre-login workspace from the earlier loopback preview.
    const previous = !workspace && workspaceId(request, "dupdash_workspace");
    const reusable = previous && !hasActiveLogin(previous) && request.cookies.get("dupdash_workspace");
    response.cookies.set(demoCookie, reusable ? reusable.value : newDemoCookie(),
      {httpOnly:true, secure:true, sameSite:"strict", path:"/", maxAge:lifetimeSeconds});
    if (previous) response.cookies.delete("dupdash_workspace");
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  // A cross-origin form POST from the launch page needs its Origin for the member handoff.
  response.headers.set("Referrer-Policy", path === "/api/demo/member-tab" ? "origin" : "same-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: "/:path*" };
