import { z } from "zod";
import { inboundFeedback } from "./feedback.ts";
const sourceUrl = z.string().url().max(2048).refine(v => {
  const u = new URL(v);
  return u.protocol === "https:" && !u.username && !u.password && ["inbox.dupdash.invalid", "messages.dupdash.invalid", "webmail.dupdash.invalid", "reader.dupdash.invalid"].includes(u.hostname);
}, "Use a direct message link from the connected mail provider").nullable().optional();
export const inboundMessage = z.object({
  source: z.string().trim().min(1).max(80).regex(/^[a-z0-9._-]+$/),
  messageId: z.string().trim().min(1).max(1000),
  sender: z.string().trim().min(1).max(500),
  subject: z.string().max(1000),
  body: z.string().max(64000),
  receivedAt: z.string().datetime({ offset: true }).transform(v => new Date(v).toISOString()),
  category: z.enum(["beta", "purchases", "errors", "infrastructure", "support", "unsorted"]).default("unsorted"),
  supportKind: z.string().trim().max(120).nullable().optional(),
  sourceUrl,
  feedback: inboundFeedback.optional(),
}).strict();
export async function messageKey(source: string, messageId: string) {
  const bytes = new TextEncoder().encode(JSON.stringify([source, messageId]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}
export async function tokenMatches(actual: string, expected: string) {
  const enc = new TextEncoder();
  const hashes = await Promise.all([actual, expected].map(value => crypto.subtle.digest("SHA-256", enc.encode(value))));
  const a = new Uint8Array(hashes[0]); const b = new Uint8Array(hashes[1]);
  let different = 0; for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}
