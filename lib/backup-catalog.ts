export const BACKUP_LIBRARY_IDS = ["dashboard-n8n", "example-app-source", "cold-storage"] as const;

export type BackupLibraryId = typeof BACKUP_LIBRARY_IDS[number];
export type BackupSetup = "initialized" | "not-initialized" | "unavailable";
export type BackupPhase = "idle" | "preparing" | "snapshotting" | "uploading" | "verifying" | "complete" | "failed" | "unavailable";
export type BackupDestinationStatus = "current" | "stale" | "error" | "unavailable" | "not-initialized";

export type BackupHistoryEvent = {
  id: string;
  kind: "snapshot" | "verification" | "offload";
  status: "succeeded" | "failed";
  occurredAt: string;
  snapshotId: string | null;
  summary: string;
};

export type BackupDestination = {
  id: string;
  label: string;
  kind: "google-drive" | "external-drive" | "cold-storage";
  status: BackupDestinationStatus;
  lastSnapshot: { snapshotId: string; createdAt: string; sizeBytes: number | null } | null;
  lastVerification: { status: "passed" | "failed"; verifiedAt: string; snapshotId: string | null } | null;
  history: BackupHistoryEvent[];
  repositoryBytes?: number | null;
  repositoryBytesStatus?: "measured" | "unavailable";
  repositoryBytesMeasuredAt?: string | null;
};

export type BackupLibrary = {
  id: BackupLibraryId;
  name: string;
  mode: "active-sync" | "verified-offload";
  setup: BackupSetup;
  eligibleForSync: boolean;
  phase: BackupPhase;
  summary: string;
  destinations: BackupDestination[];
  sourceLogicalBytes?: number | null;
};

export type BackupCatalogResponse = {
  schemaVersion: 1;
  serverTime: string;
  source: {
    kind: "n8n-recovery-feed" | "mac-controller";
    observedAt: string | null;
    receivedAt: string | null;
    status: "current" | "stale" | "error" | "unavailable";
    detail: string;
  };
  update: {
    state: "idle" | "running" | "succeeded" | "failed" | "unavailable";
    jobId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    phase: string | null;
    summary: string;
  };
  libraries: BackupLibrary[];
};

const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const libraryIds = new Set(BACKUP_LIBRARY_IDS);
const setupValues = new Set(["initialized", "not-initialized", "unavailable"]);
const phaseValues = new Set(["idle", "preparing", "snapshotting", "uploading", "verifying", "complete", "failed", "unavailable"]);
const destinationKinds = new Set(["google-drive", "external-drive", "cold-storage"]);
const destinationStatuses = new Set(["current", "stale", "error", "unavailable", "not-initialized"]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timestamp(value: unknown, nullable = false): value is string | null {
  if (nullable && value === null) return true;
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function text(value: unknown, limit = 320): value is string {
  return typeof value === "string" && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);
}

function id(value: unknown, nullable = false): value is string | null {
  return nullable && value === null || typeof value === "string" && safeId.test(value);
}

function oneOf(value: unknown, values: Set<string>): value is string {
  return typeof value === "string" && values.has(value);
}

function parseHistory(value: unknown): BackupHistoryEvent[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const result: BackupHistoryEvent[] = [];
  for (const raw of value) {
    const item = record(raw);
    if (!item || !id(item.id) || !oneOf(item.kind, new Set(["snapshot", "verification", "offload"])) || !oneOf(item.status, new Set(["succeeded", "failed"])) || !timestamp(item.occurredAt) || !id(item.snapshotId, true) || !text(item.summary)) return null;
    result.push(item as BackupHistoryEvent);
  }
  return result;
}

function parseDestination(value: unknown): BackupDestination | null {
  const item = record(value);
  if (!item || !id(item.id) || !text(item.label, 96) || !oneOf(item.kind, destinationKinds) || !oneOf(item.status, destinationStatuses)) return null;
  const history = parseHistory(item.history);
  if (!history) return null;
  const hasRepository = item.repositoryBytes !== undefined || item.repositoryBytesStatus !== undefined || item.repositoryBytesMeasuredAt !== undefined;
  if (hasRepository && (!(item.repositoryBytes === null || typeof item.repositoryBytes === "number" && Number.isSafeInteger(item.repositoryBytes) && item.repositoryBytes >= 0) || !oneOf(item.repositoryBytesStatus, new Set(["measured","unavailable"])) || !timestamp(item.repositoryBytesMeasuredAt, true))) return null;
  if (item.repositoryBytesStatus === "measured" && (typeof item.repositoryBytes !== "number" || item.repositoryBytesMeasuredAt === null)) return null;
  if (item.repositoryBytesStatus === "unavailable" && (item.repositoryBytes !== null || item.repositoryBytesMeasuredAt !== null)) return null;
  let lastSnapshot: BackupDestination["lastSnapshot"] = null;
  if (item.lastSnapshot !== null) {
    const snapshot = record(item.lastSnapshot);
    if (!snapshot || !id(snapshot.snapshotId) || !timestamp(snapshot.createdAt) || !(snapshot.sizeBytes === null || typeof snapshot.sizeBytes === "number" && Number.isSafeInteger(snapshot.sizeBytes) && snapshot.sizeBytes >= 0)) return null;
    lastSnapshot = snapshot as BackupDestination["lastSnapshot"];
  }
  let lastVerification: BackupDestination["lastVerification"] = null;
  if (item.lastVerification !== null) {
    const verification = record(item.lastVerification);
    if (!verification || !oneOf(verification.status, new Set(["passed", "failed"])) || !timestamp(verification.verifiedAt) || !id(verification.snapshotId, true)) return null;
    lastVerification = verification as BackupDestination["lastVerification"];
  }
  return { id: item.id, label: item.label, kind: item.kind, status: item.status, lastSnapshot, lastVerification, history, ...(hasRepository ? { repositoryBytes: item.repositoryBytes, repositoryBytesStatus: item.repositoryBytesStatus, repositoryBytesMeasuredAt: item.repositoryBytesMeasuredAt } : {}) } as BackupDestination;
}

function parseLibrary(value: unknown): BackupLibrary | null {
  const item = record(value);
  if (!item || !oneOf(item.id, libraryIds) || !text(item.name, 96) || !oneOf(item.mode, new Set(["active-sync", "verified-offload"])) || !oneOf(item.setup, setupValues) || typeof item.eligibleForSync !== "boolean" || !oneOf(item.phase, phaseValues) || !text(item.summary) || !Array.isArray(item.destinations) || item.destinations.length > 8) return null;
  const destinations = item.destinations.map(parseDestination);
  if (destinations.some(destination => destination === null)) return null;
  if (item.id === "cold-storage" && (item.mode !== "verified-offload" || item.eligibleForSync)) return null;
  if (item.sourceLogicalBytes !== undefined && !(item.sourceLogicalBytes === null || typeof item.sourceLogicalBytes === "number" && Number.isSafeInteger(item.sourceLogicalBytes) && item.sourceLogicalBytes >= 0)) return null;
  if (item.id !== "cold-storage" && item.mode !== "active-sync") return null;
  return { ...item, destinations } as BackupLibrary;
}

export function parseBackupCatalogResponse(value: unknown): BackupCatalogResponse | null {
  const root = record(value), source = record(root?.source), update = record(root?.update);
  if (!root || root.schemaVersion !== 1 || !timestamp(root.serverTime) || !source || !oneOf(source.kind, new Set(["n8n-recovery-feed", "mac-controller"])) || !timestamp(source.observedAt, true) || !timestamp(source.receivedAt, true) || !oneOf(source.status, new Set(["current", "stale", "error", "unavailable"])) || !text(source.detail) || !update || !oneOf(update.state, new Set(["idle", "running", "succeeded", "failed", "unavailable"])) || !id(update.jobId, true) || !timestamp(update.startedAt, true) || !timestamp(update.finishedAt, true) || !(update.phase === null || text(update.phase, 96)) || !text(update.summary) || !Array.isArray(root.libraries) || root.libraries.length !== BACKUP_LIBRARY_IDS.length) return null;
  const libraries = root.libraries.map(parseLibrary);
  if (libraries.some(library => library === null) || new Set(libraries.map(library => library?.id)).size !== BACKUP_LIBRARY_IDS.length || BACKUP_LIBRARY_IDS.some(expected => !libraries.some(library => library?.id === expected))) return null;
  if (update.state === "running" && (update.jobId === null || update.startedAt === null || update.finishedAt !== null)) return null;
  if ((update.state === "succeeded" || update.state === "failed") && (update.jobId === null || update.startedAt === null || update.finishedAt === null)) return null;
  return { ...root, source, update, libraries } as BackupCatalogResponse;
}
