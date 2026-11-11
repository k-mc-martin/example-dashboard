import { z } from "zod";
import type { SQLiteDatabase } from "../db/index.ts";

export type AttentionDismissal = {
  identity: string;
  conditionRevision: string;
  dismissedAt: string;
};

export type AttentionCandidate = {
  identity: string;
  conditionRevision: string;
};

type RevisionPart = string | number | boolean | null | undefined;

export function attentionRevision(parts: RevisionPart[]): string {
  return JSON.stringify(parts);
}

export function feedAttentionRevision(state: string, errorIdentity?: string | null): string {
  return attentionRevision(["feed", state, errorIdentity ?? null]);
}

export function backupAttentionRevision(value: {
  readError?: string;
  sourceStatus?: string;
  sourceDetail?: string;
  updateState?: string;
  updateJobId?: string | null;
}): string {
  return attentionRevision([
    "backup", value.readError ?? null, value.sourceStatus ?? null, value.sourceDetail ?? null,
    value.updateState ?? null, value.updateJobId ?? null,
  ]);
}

const identity = z.string().min(1).max(180).regex(/^[a-z0-9][a-z0-9:._-]*$/);
const conditionRevision = z.string().min(1).max(1000).refine(value => !/[\u0000-\u001f\u007f]/.test(value));

export const attentionDismissalRequest = z.object({
  identity,
  conditionRevision,
}).strict();

export const attentionDismissalSchema = attentionDismissalRequest.extend({
  dismissedAt: z.string().datetime({ offset: true }),
}).strict();

export const attentionDismissalsResponseSchema = z.object({
  dismissals: z.array(attentionDismissalSchema).max(5000),
}).strict();

export function parseAttentionDismissals(value: unknown): AttentionDismissal[] {
  return attentionDismissalsResponseSchema.parse(value).dismissals;
}

export function visibleAttention<T extends AttentionCandidate>(items: T[], dismissals: AttentionDismissal[]): T[] {
  const dismissed = new Map(dismissals.map(item => [item.identity, item.conditionRevision]));
  return items.filter(item => dismissed.get(item.identity) !== item.conditionRevision);
}

export async function readAttentionDismissals(db: SQLiteDatabase): Promise<AttentionDismissal[]> {
  const result = await db.prepare<{
    identity: string;
    conditionRevision: string;
    dismissedAt: string;
  }>(`SELECT identity,condition_revision AS conditionRevision,dismissed_at AS dismissedAt
      FROM attention_dismissals ORDER BY dismissed_at DESC,identity`).all();
  return result.results;
}

export async function storeAttentionDismissal(
  db: SQLiteDatabase,
  value: z.infer<typeof attentionDismissalRequest>,
  dismissedAt = new Date().toISOString(),
): Promise<AttentionDismissal> {
  await db.prepare(`INSERT INTO attention_dismissals (identity,condition_revision,dismissed_at)
    VALUES (?,?,?) ON CONFLICT(identity) DO UPDATE SET
    condition_revision=excluded.condition_revision,dismissed_at=excluded.dismissed_at`)
    .bind(value.identity, value.conditionRevision, dismissedAt).run();
  return { ...value, dismissedAt };
}
