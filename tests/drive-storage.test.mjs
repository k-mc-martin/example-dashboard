import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { closeDb, getDb } from "../db/index.ts";
import { deriveDriveStorageMetrics, DRIVE_STORAGE_COLLECTION_MS, DRIVE_STORAGE_HISTORY_LIMIT, DRIVE_STORAGE_STALE_MS, isDriveStorageStale } from "../lib/drive-storage.ts";
import { DRIVE_STORAGE_MAX_FUTURE_MS, inboundDriveStorage, readDriveStorage, storeDriveStorageSample } from "../lib/inbound-drive-storage.ts";

function ok(observedAt, quota = {}) {
  return inboundDriveStorage.parse({
    provider: "google-drive",
    observedAt,
    status: "ok",
    quota: { limitBytes: "1000", usedBytes: "400", driveBytes: "300", trashBytes: "10", ...quota },
  });
}

function error(observedAt, errorCode = "provider_unavailable") {
  return inboundDriveStorage.parse({ provider: "google-drive", observedAt, status: "error", errorCode });
}

test("accepts only the strict bounded Drive payload contract", () => {
  const observedAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(ok(observedAt).observedAt, observedAt);
  assert.equal(inboundDriveStorage.safeParse({ ...ok(observedAt), receivedAt: observedAt }).success, false);
  assert.equal(inboundDriveStorage.safeParse({ provider: "google-drive", observedAt, status: "ok", quota: { limitBytes: null, usedBytes: "0", driveBytes: "0", trashBytes: "0" } }).success, true);
  for (const usedBytes of ["", "00", "01", "-1", "1.0", "9007199254740992"]) {
    assert.equal(inboundDriveStorage.safeParse({ provider: "google-drive", observedAt, status: "ok", quota: { limitBytes: null, usedBytes, driveBytes: "0", trashBytes: "0" } }).success, false);
  }
  assert.equal(inboundDriveStorage.safeParse({ provider: "google-drive", observedAt, status: "error", errorCode: "other" }).success, false);
  assert.equal(inboundDriveStorage.safeParse({ provider: "google-drive", observedAt: new Date(Date.now() + DRIVE_STORAGE_MAX_FUTURE_MS + 60_000).toISOString(), status: "error", errorCode: "invalid_response" }).success, false);
});

test("stores observations idempotently and preserves latest success after a newer error", async (t) => {
  closeDb();
  const directory = mkdtempSync(join(tmpdir(), "secdash-drive-"));
  t.after(() => { closeDb(); rmSync(directory, { recursive: true }); });
  process.env.SECDASH_DATABASE_PATH = join(directory, "dashboard.sqlite");
  const db = getDb();
  const firstAt = "2026-09-30T16:00:00.000Z";
  const errorAt = "2026-09-30T16:05:00.000Z";
  const oldAt = "2026-09-30T15:55:00.000Z";
  assert.equal(await storeDriveStorageSample(db, ok(firstAt), "2026-09-30T16:00:01.000Z"), true);
  assert.equal(await storeDriveStorageSample(db, ok(firstAt, { usedBytes: "999" }), "2026-09-30T16:00:02.000Z"), false);
  assert.equal(await storeDriveStorageSample(db, error(errorAt, "authorization_required"), "2026-09-30T16:05:01.000Z"), true);
  assert.equal(await storeDriveStorageSample(db, ok(oldAt), "2026-09-30T16:06:00.000Z"), true);

  const response = await readDriveStorage(db, "2026-09-30T16:06:01.000Z");
  assert.equal(response.latest?.observedAt, errorAt);
  assert.equal(response.latest?.status, "error");
  assert.equal(response.latestSuccess?.observedAt, firstAt);
  assert.equal(response.latestSuccess?.status, "ok");
  assert.equal(response.latestSuccess?.quota.usedBytes, "400");
  assert.deepEqual(response.history.map(sample => sample.observedAt), [oldAt, firstAt, errorAt]);
});

test("returns at most 288 recent samples without deleting older rows", async (t) => {
  closeDb();
  const directory = mkdtempSync(join(tmpdir(), "secdash-drive-"));
  t.after(() => { closeDb(); rmSync(directory, { recursive: true }); });
  process.env.SECDASH_DATABASE_PATH = join(directory, "dashboard.sqlite");
  const db = getDb();
  const base = Date.parse("2026-09-29T00:00:00.000Z");
  for (let index = 0; index < 290; index += 1) {
    await storeDriveStorageSample(db, ok(new Date(base + index * 60_000).toISOString()));
  }
  const response = await readDriveStorage(db);
  assert.equal(response.history.length, DRIVE_STORAGE_HISTORY_LIMIT);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM drive_storage_samples").first("count"), 290);
  assert.ok(response.history[0].observedAt < response.history.at(-1).observedAt);
});

test("derives capacity without turning unlimited, error, or empty states into zero", () => {
  const sample = { ...ok("2026-09-30T16:00:00.000Z"), receivedAt: "2026-09-30T16:00:01.000Z" };
  assert.deepEqual(deriveDriveStorageMetrics(sample), { limitBytes: 1000, usedBytes: 400, availableBytes: 600, driveBytes: 300, trashBytes: 10, usedFraction: 0.4 });
  assert.equal(deriveDriveStorageMetrics({ ...sample, quota: { ...sample.quota, limitBytes: null } })?.availableBytes, null);
  assert.equal(deriveDriveStorageMetrics({ ...error(sample.observedAt), receivedAt: sample.receivedAt }), null);
  assert.equal(deriveDriveStorageMetrics(null), null);
  assert.equal(DRIVE_STORAGE_COLLECTION_MS, 300_000);
  assert.equal(DRIVE_STORAGE_STALE_MS, 900_000);
  assert.equal(isDriveStorageStale(sample, Date.parse(sample.observedAt) + DRIVE_STORAGE_STALE_MS), false);
  assert.equal(isDriveStorageStale(sample, Date.parse(sample.observedAt) + DRIVE_STORAGE_STALE_MS + 1), true);
});
