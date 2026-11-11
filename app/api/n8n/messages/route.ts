import { getDb } from "@/db";
import { inboundMessage, messageKey } from "@/lib/inbound";
import { validateFeedbackEvidence } from "@/lib/feedback";
import { storeMessageWithFeedback } from "@/lib/feedback-store";
import { authorized, denied } from "@/lib/server-auth";
export async function POST(request: Request) {
  if (!authorized(request, "ingest")) return denied(request);
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) return Response.json({ error: "JSON required" }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Message required" }, { status: 400 });
  const decoder = new TextDecoder(); let body = ""; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > 100000) { await reader.cancel(); return Response.json({ error: "Message exceeds 100 KB. Send text without attachments." }, { status: 413 }); }
    body += decoder.decode(next.value, { stream: true });
  }
  body += decoder.decode();
  let json; try { json = JSON.parse(body); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = inboundMessage.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid message", fields: parsed.error.issues.map(i => i.path.join(".")) }, { status: 400 });
  const m = parsed.data; const id = await messageKey(m.source, m.messageId);
  if (m.feedback && !validateFeedbackEvidence(m.feedback, m)) {
    return Response.json({ error: "Feedback evidence must be an exact subject or body excerpt." }, { status: 400 });
  }
  try {
    await storeMessageWithFeedback(getDb(), id, m);
    return Response.json({ id, stored: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Could not save message. Retry with the same message ID." }, { status: 503 }); }
}
