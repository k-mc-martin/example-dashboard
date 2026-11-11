export type BackupState = "never" | "running" | "succeeded" | "failed";

export type BackupStatus = {
  jobId: string | null;
  state: BackupState;
  startedAt: string | null;
  finishedAt: string | null;
  summary: string;
  snapshotId?: string;
};

const states = new Set<BackupState>(["never", "running", "succeeded", "failed"]);
const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function timestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 64) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 280 || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

export function parseBackupStatus(value: unknown): BackupStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.state !== "string" || !states.has(record.state as BackupState)) return null;
  const state = record.state as BackupState;
  const jobId = record.jobId === null ? null : typeof record.jobId === "string" && safeId.test(record.jobId) ? record.jobId : undefined;
  const startedAt = timestamp(record.startedAt);
  const finishedAt = timestamp(record.finishedAt);
  const summary = safeText(record.summary);
  const snapshotId = record.snapshotId === undefined ? undefined : typeof record.snapshotId === "string" && safeId.test(record.snapshotId) ? record.snapshotId : null;
  if (jobId === undefined || startedAt === undefined || finishedAt === undefined || summary === undefined || snapshotId === null) return null;
  if (state === "never" && (jobId !== null || startedAt !== null || finishedAt !== null)) return null;
  if (state === "running" && (jobId === null || startedAt === null || finishedAt !== null)) return null;
  if (["succeeded", "failed"].includes(state) && (jobId === null || startedAt === null || finishedAt === null)) return null;
  return { jobId, state, startedAt, finishedAt, summary, ...(snapshotId ? { snapshotId } : {}) };
}
