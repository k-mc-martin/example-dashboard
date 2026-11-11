import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = await mkdtemp(join(tmpdir(), "secdash-recovery-feed-"));
const feedPath = join(root, "recovery.json"), statusPath = join(root, "status.json");
process.env.NODE_ENV = "test";
process.env.RECOVERY_FEED_PATH = feedPath;
process.env.RECOVERY_STATUS_PATH = statusPath;
const { serveRecovery } = await import(`./recovery-feed-server.mjs?test=${Date.now()}`);

function response() {
  return { status: 0, body: "", writeHead(code) { this.status = code; }, end(body) { this.body = body; } };
}
async function request(now) {
  const result = response();
  await serveRecovery({ url: "/recovery.json", method: "GET" }, result, now);
  return { status: result.status, body: JSON.parse(result.body) };
}
async function fixtures(now, status = "ok") {
  const at = new Date(now).toISOString();
  await writeFile(feedPath, JSON.stringify({ schemaVersion: 1, generatedAt: at, backupFolder: { name: "SecDash Backups", bytes: 12, objects: 3, measuredAt: at }, restoreChecks: [] }));
  await writeFile(statusPath, JSON.stringify(status === "ok" ? { schemaVersion: 1, attemptedAt: at, status } : { schemaVersion: 1, attemptedAt: at, status, errorCode: "collection_failed" }));
}

test("serves only a current successful sanitized feed", async () => {
  const now = Date.now(); await fixtures(now);
  const result = await request(now);
  assert.equal(result.status, 200); assert.equal(result.body.backupFolder.bytes, 12);
});

test("failed latest collection rejects preserved success", async () => {
  const now = Date.now(); await fixtures(now, "error");
  const result = await request(now);
  assert.equal(result.status, 503); assert.equal(result.body.errorCode, "collection_failed");
});

test("stale feed is unavailable", async () => {
  const old = Date.now() - 16 * 60_000; await fixtures(old);
  const result = await request(Date.now());
  assert.equal(result.status, 503); assert.equal(result.body.errorCode, "feed_stale");
});
