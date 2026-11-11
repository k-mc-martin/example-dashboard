import { getDb } from "@/db";
import { inboundProviderConnection, connectionStatement } from "@/lib/inbound-provider-connection";
import { authorized, denied } from "@/lib/server-auth";

export async function POST(request: Request) {
  if (!authorized(request, "ingest")) return denied(request);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) return Response.json({ error: "JSON required" }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Connection status required" }, { status: 400 });
  const decoder = new TextDecoder(); let body = ""; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > 16384) { await reader.cancel(); return Response.json({ error: "Connection status exceeds 16 KB." }, { status: 413 }); }
    body += decoder.decode(next.value, { stream: true });
  }
  body += decoder.decode();
  let json; try { json = JSON.parse(body); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = inboundProviderConnection.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid provider connection", fields: parsed.error.issues.map(issue => issue.path.join(".")) }, { status: 400 });
  const connection = parsed.data;
  try {
    await connectionStatement(getDb(), connection).run();
    return Response.json({ provider: connection.provider, stored: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Could not save provider connection. Retry the same verified result." }, { status: 503 }); }
}
