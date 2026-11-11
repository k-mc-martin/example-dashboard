import { withDashboardDb } from "@/lib/demo-db";
import { authorized, denied } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  try {
    await withDashboardDb(request, db => db.prepare("SELECT 1 AS healthy").first());
    return Response.json({ healthy: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ healthy: false }, { status: 503 });
  }
}
