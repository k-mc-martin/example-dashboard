import { withDashboardDb } from "@/lib/demo-db";
import { readDriveStorage } from "../../../lib/inbound-drive-storage";
import { authorized, denied } from "../../../lib/server-auth";

export async function GET(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  try {
    return Response.json(await withDashboardDb(request, readDriveStorage), { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "Drive storage history is unavailable. Saved samples are unchanged." }, { status: 503 }); }
}
