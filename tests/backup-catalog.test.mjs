import assert from "node:assert/strict";
import test from "node:test";
import { parseBackupCatalogResponse } from "../lib/backup-catalog.ts";

const now = "2026-10-01T18:00:00.000Z";
function library(id) {
  const cold = id === "cold-storage";
  return { id, name: cold ? "Cold-storage reclamation archive" : id === "dashboard-n8n" ? "Dashboard + n8n" : "ExampleApp source", mode: cold ? "verified-offload" : "active-sync", setup: "initialized", eligibleForSync: !cold, phase: "idle", summary: cold ? "Verified one-time offloads. No sync." : "Ready for update.", destinations: [{ id: `${id}-drive`, label: cold ? "Cold storage" : "Google Drive", kind: cold ? "cold-storage" : "google-drive", status: "current", lastSnapshot: { snapshotId: "snap-1", createdAt: now, sizeBytes: 42 }, lastVerification: { status: "passed", verifiedAt: now, snapshotId: "snap-1" }, history: [{ id: `${id}-event`, kind: cold ? "offload" : "verification", status: "succeeded", occurredAt: now, snapshotId: "snap-1", summary: "Verified." }] }] };
}
function payload() {
  return { schemaVersion: 1, serverTime: now, source: { kind: "n8n-recovery-feed", observedAt: now, receivedAt: now, status: "current", detail: "Recovery feed." }, update: { state: "idle", jobId: null, startedAt: null, finishedAt: null, phase: null, summary: "Ready." }, libraries: [library("dashboard-n8n"), library("example-app-source"), library("cold-storage")] };
}

test("accepts the complete three-library catalog", () => {
  const result = parseBackupCatalogResponse(payload());
  assert.equal(result?.libraries.length, 3);
  assert.equal(result?.libraries[2].eligibleForSync, false);
});

test("rejects missing libraries and makes unavailable state explicit", () => {
  const missing = payload();
  missing.libraries.pop();
  assert.equal(parseBackupCatalogResponse(missing), null);
  const unavailable = payload();
  unavailable.libraries[1] = { ...unavailable.libraries[1], setup: "unavailable", phase: "unavailable", destinations: [{ ...unavailable.libraries[1].destinations[0], status: "unavailable", lastSnapshot: null, lastVerification: null, history: [] }] };
  assert.equal(parseBackupCatalogResponse(unavailable)?.libraries[1].setup, "unavailable");
});

test("rejects synthetic-looking success and a syncable cold archive", () => {
  const impossibleJob = payload();
  impossibleJob.update = { ...impossibleJob.update, state: "succeeded", jobId: null };
  assert.equal(parseBackupCatalogResponse(impossibleJob), null);
  const syncingArchive = payload();
  syncingArchive.libraries[2] = { ...syncingArchive.libraries[2], eligibleForSync: true };
  assert.equal(parseBackupCatalogResponse(syncingArchive), null);
});

test("rejects invalid timestamps, byte counts, and control characters", () => {
  const invalid = payload();
  invalid.libraries[0].destinations[0].lastSnapshot.sizeBytes = -1;
  assert.equal(parseBackupCatalogResponse(invalid), null);
  const unsafe = payload();
  unsafe.source.detail = "bad\nline";
  assert.equal(parseBackupCatalogResponse(unsafe), null);
});

test("accepts measured repository bytes and rejects incomplete measurement triplets", () => {
  const measured = payload();
  Object.assign(measured.libraries[1], { sourceLogicalBytes: 2048 });
  Object.assign(measured.libraries[1].destinations[0], { repositoryBytes: 1024, repositoryBytesStatus: "measured", repositoryBytesMeasuredAt: now });
  assert.equal(parseBackupCatalogResponse(measured)?.libraries[1].destinations[0].repositoryBytes, 1024);
  delete measured.libraries[1].destinations[0].repositoryBytesMeasuredAt;
  assert.equal(parseBackupCatalogResponse(measured), null);
});
