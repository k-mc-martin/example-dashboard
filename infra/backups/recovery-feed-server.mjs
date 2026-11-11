import http from "node:http";
import { readFile } from "node:fs/promises";

const feedPath = process.env.RECOVERY_FEED_PATH || "/telemetry/recovery.json";
const statusPath = process.env.RECOVERY_STATUS_PATH || "/telemetry/recovery-status.json";
const port = Number(process.env.PORT || "8080");
const maxAgeMs = 15 * 60_000;

function timestamp(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function statusValid(value) {
  return value && value.schemaVersion === 1 && timestamp(value.attemptedAt)
    && (value.status === "ok" || (value.status === "error" && ["measurement_timeout", "collection_failed"].includes(value.errorCode)));
}
function feedValid(value) {
  const folder = value?.backupFolder;
  return value?.schemaVersion === 1 && timestamp(value.generatedAt)
    && folder?.name === "Dupdash Backups" && Number.isSafeInteger(folder.bytes) && folder.bytes >= 0
    && Number.isSafeInteger(folder.objects) && folder.objects >= 0 && timestamp(folder.measuredAt)
    && Array.isArray(value.restoreChecks);
}
function reply(response, code, payload) {
  const body = JSON.stringify(payload) + "\n";
  response.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
}

export async function serveRecovery(request, response, now = Date.now()) {
  if (request.url !== "/recovery.json") return reply(response, 404, { ok: false, errorCode: "not_found" });
  if (request.method !== "GET") return reply(response, 405, { ok: false, errorCode: "method_not_allowed" });
  try {
    const [feed, status] = await Promise.all([
      readFile(feedPath, "utf8").then(JSON.parse), readFile(statusPath, "utf8").then(JSON.parse),
    ]);
    if (!statusValid(status)) return reply(response, 503, { ok: false, errorCode: "status_invalid" });
    if (status.status === "error") return reply(response, 503, { ok: false, errorCode: status.errorCode, attemptedAt: status.attemptedAt });
    if (!feedValid(feed)) return reply(response, 503, { ok: false, errorCode: "feed_invalid" });
    if (now - Date.parse(status.attemptedAt) > maxAgeMs || now - Date.parse(feed.generatedAt) > maxAgeMs || now - Date.parse(feed.backupFolder.measuredAt) > maxAgeMs) {
      return reply(response, 503, { ok: false, errorCode: "feed_stale", attemptedAt: status.attemptedAt });
    }
    return reply(response, 200, feed);
  } catch {
    return reply(response, 503, { ok: false, errorCode: "feed_unavailable" });
  }
}

if (process.env.NODE_ENV !== "test") {
  http.createServer(serveRecovery).listen(port, "0.0.0.0");
}
