export const DRIVE_STORAGE_COLLECTION_MS = 5 * 60 * 1000;
export const DRIVE_STORAGE_STALE_MS = 15 * 60 * 1000;
export const DRIVE_STORAGE_POLL_INTERVAL_MS = DRIVE_STORAGE_COLLECTION_MS;
export const DRIVE_STORAGE_STALE_AFTER_MS = DRIVE_STORAGE_STALE_MS;
export const DRIVE_STORAGE_HISTORY_LIMIT = 288;

export type DriveStorageQuota = {
  limitBytes: string | null;
  usedBytes: string;
  driveBytes: string;
  trashBytes: string;
};

export type DriveStorageSample = ({
  provider: "google-drive";
  observedAt: string;
  status: "ok";
  quota: DriveStorageQuota;
} | {
  provider: "google-drive";
  observedAt: string;
  status: "error";
  errorCode: "authorization_required" | "provider_unavailable" | "invalid_response";
}) & { receivedAt: string };

export type DriveStorageResponse = {
  latest: DriveStorageSample | null;
  latestSuccess: DriveStorageSample | null;
  history: DriveStorageSample[];
  serverTime: string;
};

export type DriveStorageMetrics = {
  limitBytes: number | null;
  usedBytes: number;
  availableBytes: number | null;
  driveBytes: number;
  trashBytes: number;
  usedFraction: number | null;
};

function safeBytes(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function deriveDriveStorageMetrics(sample: DriveStorageSample | null): DriveStorageMetrics | null {
  if (!sample || sample.status !== "ok") return null;
  const usedBytes = safeBytes(sample.quota.usedBytes);
  const driveBytes = safeBytes(sample.quota.driveBytes);
  const trashBytes = safeBytes(sample.quota.trashBytes);
  const limitBytes = sample.quota.limitBytes === null ? null : safeBytes(sample.quota.limitBytes);
  if (usedBytes === null || driveBytes === null || trashBytes === null || (sample.quota.limitBytes !== null && limitBytes === null)) return null;
  const availableBytes = limitBytes === null ? null : Math.max(limitBytes - usedBytes, 0);
  return {
    limitBytes,
    usedBytes,
    availableBytes,
    driveBytes,
    trashBytes,
    usedFraction: limitBytes === null || limitBytes === 0 ? null : Math.min(usedBytes / limitBytes, 1),
  };
}

export function isDriveStorageStale(sample: DriveStorageSample | null, now = Date.now()): boolean {
  if (!sample) return true;
  const observed = Date.parse(sample.observedAt);
  return !Number.isFinite(observed) || now - observed > DRIVE_STORAGE_STALE_AFTER_MS;
}
