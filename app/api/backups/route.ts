import { observedOperations } from '@/lib/review/manual';
import { demoEnabled } from "@/lib/demo-session";
import { withDashboardDb } from "@/lib/demo-db";
import { backupStatus } from "@/lib/demo-events";
import { parseBackupStatus } from "@/lib/backups";
import { authorized, denied } from "@/lib/server-auth";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const publicSummaries = {
  never: "No backup has run yet.",
  running: "The encrypted backup is being prepared.",
  succeeded: "The encrypted backup was uploaded to Google Drive.",
  failed: "The backup failed. Check the local backup service logs.",
} as const;

function configuration(): { base: string; token: string } | null {
  const values = process.env;
  if (!values.SECDASH_BACKUP_URL || !values.SECDASH_BACKUP_TOKEN || values.SECDASH_BACKUP_TOKEN.length < 32) return null;
  try {
    const url = new URL(values.SECDASH_BACKUP_URL);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "5780" || url.username || url.password || !["", "/"].includes(url.pathname) || url.search || url.hash) return null;
    return { base: "http://127.0.0.1:5780", token: values.SECDASH_BACKUP_TOKEN };
  } catch { return null; }
}

async function controller(method: "GET" | "POST") {
  const configured = configuration();
  if (!configured) return Response.json({ error: "Backups have not been configured." }, { status: 503, headers: responseHeaders });
  try {
    const response = await fetch(`${configured.base}/v1/jobs${method === "GET" ? "/latest" : ""}`, {
      method,
      headers: { Authorization: `Bearer ${configured.token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > 4096) throw new Error("Invalid controller response");
    const body = await response.text();
    if (body.length > 4096) throw new Error("Invalid controller response");
    let status = null;
    try { status = parseBackupStatus(JSON.parse(body)); } catch {}
    if (!status) throw new Error("Invalid controller response");
    if (response.ok || (method === "POST" && response.status === 409 && status.state === "running")) {
      return Response.json({ ...status, summary: publicSummaries[status.state] }, { status: method === "POST" ? 202 : 200, headers: responseHeaders });
    }
    throw new Error("Controller rejected request");
  } catch {
    return Response.json({ error: "The local backup service is unavailable. Try again after checking its status." }, { status: 503, headers: responseHeaders });
  }
}

async function read(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  if (demoEnabled()) {
    try { return Response.json(await withDashboardDb(request, db => backupStatus(db, request.method === "POST"))); }
    catch { return Response.json({error:"Waiting for the first demo events."},{status:503}); }
  }
  return controller("GET");
}

async function start(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  if (demoEnabled()) {
    try { return Response.json(await withDashboardDb(request, db => backupStatus(db, request.method === "POST"))); }
    catch { return Response.json({error:"Waiting for the first demo events."},{status:503}); }
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Same-origin request required." }, { status: 403, headers: responseHeaders });
  return controller("POST");
}

export function GET(request: Request) { return observedOperations(request, read); }
export function POST(request: Request) { return observedOperations(request, start); }
