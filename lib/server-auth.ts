import { demoEnabled, demoOriginAllowed, workspaceId } from './demo-session.ts';
import { currentAccount } from './demo-login.ts';
import { requestSection, accountSections } from './demo-permissions.ts';
import { createHash, timingSafeEqual } from "node:crypto";

function matches(actual: string, expected: string | undefined): boolean {
  if (!expected || expected.length < 32 || actual.length > 1024) return false;
  return timingSafeEqual(createHash("sha256").update(actual).digest(), createHash("sha256").update(expected).digest());
}

/** Transport is the private Docker network or SSH tunnel; credentials remain server-side. */
export function authorized(request: Request, role: "operator" | "ingest"): boolean {
  if (demoEnabled()) {
    if (role !== "operator" || !demoOriginAllowed(request) || !workspaceId(request)) return false;
    const account = currentAccount(request);
    const section = requestSection(request);
    if (!account || !section || !accountSections(account).includes(section)) return false;
    if (request.method === 'POST' && section === 'storage') {
      return new URL(request.url).pathname === '/api/backups' ? account.permissions.startBackup : account.permissions.syncBackups;
    }
    return true;
  }
  const host = request.headers.get("host");
  const browserHosts = ["127.0.0.1:5286", "localhost:5286"];
  if (!host || !(role === "ingest" ? [...browserHosts, "dashboard:3000"] : browserHosts).includes(host)) return false;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (role === "ingest" && (request.method !== "POST" || origin || site)) return false;
  if (role === "operator" && ((origin && origin !== `http://${host}`) || (site && !["same-origin", "none"].includes(site)))) return false;
  const operator = process.env.SECDASH_OPERATOR_TOKEN;
  const ingest = process.env.SECDASH_INGEST_TOKEN;
  if (!operator || !ingest || operator === ingest) return false;
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ") && matches(authorization.slice(7), role === "operator" ? operator : ingest);
}

export function denied(request?: Request): Response {
  if (request && demoEnabled()) {
    const signedIn = demoOriginAllowed(request) && !!currentAccount(request);
    return Response.json({error: signedIn ? "This account cannot access that resource." : "Demo sign-in required."},
      {status: signedIn ? 403 : 401, headers: {"Cache-Control": "no-store"}});
  }
  return Response.json({ error: "Private dashboard authorization required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
