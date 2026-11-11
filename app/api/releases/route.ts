import { demoEnabled } from "@/lib/demo-session";
import { withDashboardDb } from "@/lib/demo-db";
import { state } from "@/lib/demo-events";
import { authorized, denied } from "@/lib/server-auth";
import { readPublishedRelease } from "@/lib/published-release.mjs";

export async function GET(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  if (demoEnabled()) {
    try { return Response.json(await withDashboardDb(request, db => { const current = state(db); if (!current) throw Error("Workspace not ready"); return JSON.parse(current.published); })); }
    catch { return Response.json({error:"Waiting for the first demo events."},{status:503}); }
  }
  try {
    return Response.json(await readPublishedRelease(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Published release unavailable." }, { status: 503 });
  }
}
