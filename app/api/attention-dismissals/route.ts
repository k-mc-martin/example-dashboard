import { withDashboardDb } from "@/lib/demo-db";
import {
  attentionDismissalRequest,
  readAttentionDismissals,
  storeAttentionDismissal,
} from "@/lib/attention";
import { authorized, denied } from "@/lib/server-auth";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  try {
    return Response.json({ dismissals: await withDashboardDb(request, readAttentionDismissals) }, { headers });
  } catch {
    return Response.json({ error: "Attention dismissals are unavailable." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  if ((request.headers.get("content-type") || "").split(";", 1)[0] !== "application/json") {
    return Response.json({ error: "JSON required." }, { status: 415, headers });
  }
  let value: unknown;
  try {
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 2048)) throw new Error("too large");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("missing body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new Error("too large"); }
      chunks.push(next.value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return Response.json({ error: "Invalid dismissal." }, { status: 400, headers });
  }
  const parsed = attentionDismissalRequest.safeParse(value);
  if (!parsed.success) return Response.json({ error: "Invalid dismissal." }, { status: 400, headers });
  try {
    const dismissal = await withDashboardDb(request, db => storeAttentionDismissal(db, parsed.data));
    return Response.json({ dismissal }, { headers });
  } catch {
    return Response.json({ error: "Could not save the dismissal." }, { status: 503, headers });
  }
}
