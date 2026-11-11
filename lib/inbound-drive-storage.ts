import { z } from "zod";
import type { SQLiteDatabase } from "../db/index";
import type { DriveStorageResponse, DriveStorageSample } from "./drive-storage";

export const DRIVE_STORAGE_MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);
const HISTORY_LIMIT = 288;

const observedAt = z.string().datetime({ offset: true }).transform((value, context) => {
  const normalized = new Date(value).toISOString();
  if (Date.parse(normalized) > Date.now() + DRIVE_STORAGE_MAX_FUTURE_MS) {
    context.addIssue({ code: "custom", message: "Observation time is implausibly far in the future" });
    return z.NEVER;
  }
  return normalized;
});
const bytes = z.string().regex(/^(?:0|[1-9]\d*)$/).refine(value => /^(?:0|[1-9]\d*)$/.test(value) && BigInt(value) <= MAX_SAFE_BYTES, "Byte count exceeds the supported range");

const common = { provider: z.literal("google-drive"), observedAt };
export const inboundDriveStorage = z.discriminatedUnion("status", [
  z.object({
    ...common,
    status: z.literal("ok"),
    quota: z.object({
      limitBytes: bytes.nullable(),
      usedBytes: bytes,
      driveBytes: bytes,
      trashBytes: bytes,
    }).strict(),
  }).strict(),
  z.object({
    ...common,
    status: z.literal("error"),
    errorCode: z.enum(["authorization_required", "provider_unavailable", "invalid_response"]),
  }).strict(),
]);

export type InboundDriveStorage = z.infer<typeof inboundDriveStorage>;
type StorageRow = {
  observedAt: string; provider: "google-drive"; status: "ok" | "error";
  limitBytes: string | null; usedBytes: string | null; driveBytes: string | null;
  trashBytes: string | null; errorCode: string | null; receivedAt: string;
};

function toSample(row: StorageRow): DriveStorageSample {
  if (row.status === "ok") {
    if (row.usedBytes === null || row.driveBytes === null || row.trashBytes === null) throw new Error("Stored Drive quota is incomplete");
    return { provider: row.provider, observedAt: row.observedAt, status: "ok", quota: { limitBytes: row.limitBytes, usedBytes: row.usedBytes, driveBytes: row.driveBytes, trashBytes: row.trashBytes }, receivedAt: row.receivedAt };
  }
  if (!row.errorCode || !["authorization_required", "provider_unavailable", "invalid_response"].includes(row.errorCode)) throw new Error("Stored Drive error is invalid");
  return { provider: row.provider, observedAt: row.observedAt, status: "error", errorCode: row.errorCode as "authorization_required" | "provider_unavailable" | "invalid_response", receivedAt: row.receivedAt };
}

export function driveStorageStatement(db: SQLiteDatabase, sample: InboundDriveStorage, receivedAt = new Date().toISOString()) {
  const quota = sample.status === "ok" ? sample.quota : null;
  const errorCode = sample.status === "error" ? sample.errorCode : null;
  return db.prepare(`INSERT INTO drive_storage_samples
    (observed_at,provider,status,limit_bytes,used_bytes,drive_bytes,trash_bytes,error_code,received_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(observed_at) DO NOTHING`)
    .bind(sample.observedAt, sample.provider, sample.status, quota?.limitBytes ?? null, quota?.usedBytes ?? null, quota?.driveBytes ?? null, quota?.trashBytes ?? null, errorCode, receivedAt);
}
export async function storeDriveStorageSample(db: SQLiteDatabase, sample: InboundDriveStorage, receivedAt = new Date().toISOString()) {
  const result = await driveStorageStatement(db, sample, receivedAt).run();
  return result.meta.changes === 1;
}

const selectColumns = `observed_at AS observedAt,provider,status,limit_bytes AS limitBytes,used_bytes AS usedBytes,
  drive_bytes AS driveBytes,trash_bytes AS trashBytes,error_code AS errorCode,received_at AS receivedAt`;

export async function readDriveStorage(db: SQLiteDatabase, serverTime = new Date().toISOString()): Promise<DriveStorageResponse> {
  const [latestResult, successResult, historyResult] = await db.batch<StorageRow>([
    db.prepare(`SELECT ${selectColumns} FROM drive_storage_samples ORDER BY observed_at DESC LIMIT 1`),
    db.prepare(`SELECT ${selectColumns} FROM drive_storage_samples WHERE status='ok' ORDER BY observed_at DESC LIMIT 1`),
    db.prepare(`SELECT * FROM (SELECT ${selectColumns} FROM drive_storage_samples ORDER BY observed_at DESC LIMIT ${HISTORY_LIMIT}) ORDER BY observedAt ASC`),
  ]);
  return {
    latest: latestResult.results[0] ? toSample(latestResult.results[0]) : null,
    latestSuccess: successResult.results[0] ? toSample(successResult.results[0]) : null,
    history: historyResult.results.map(toSample),
    serverTime,
  };
}
