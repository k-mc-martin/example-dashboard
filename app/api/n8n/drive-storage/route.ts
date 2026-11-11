import { getDb } from "../../../../db";
import { inboundDriveStorage, storeDriveStorageSample } from "../../../../lib/inbound-drive-storage";
import { authorized, denied } from "../../../../lib/server-auth";

export async function POST(request: Request) {
  if (!authorized(request, "ingest")) return denied(request);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) return Response.json({ error: "JSON required" }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Drive storage sample required" }, { status: 400 });
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 8192) { await reader.cancel(); return Response.json({ error: "Drive storage sample exceeds 8 KB." }, { status: 413 }); }
    body += decoder.decode(next.value, { stream: true });
  }
  body += decoder.decode();
  let json: unknown;
  try { json = JSON.parse(body); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = inboundDriveStorage.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid Drive storage sample", fields: parsed.error.issues.map(issue => issue.path.join(".")) }, { status: 400 });
  try {
    const stored = await storeDriveStorageSample(getDb(), parsed.data);
    return Response.json({ observedAt: parsed.data.observedAt, stored }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return Response.json({ error: "Could not save Drive storage sample. Retry the same observation." }, { status: 503 }); }
}
