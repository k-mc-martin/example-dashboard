import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeNode, deliveryNode, manualNode, workflow } from "./operational-common.mjs";
import { sanitizeAiUsage } from "../../../../lib/ai-usage-contract.mjs";

const schedule = {
  parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 5 }] } },
  id: "schedule", name: "Every 5 minutes", type: "n8n-nodes-base.scheduleTrigger", typeVersion: 1.2, position: [-620, 0],
};

const read = {
  parameters: {
    url: "http://recovery-feed:8080/recovery.json",
    sendHeaders: true,
    headerParameters: { parameters: [{ name: "Accept", value: "application/json" }] },
    options: { response: { response: { fullResponse: true, neverError: true, responseFormat: "json" } }, timeout: 10000 },
  },
  id: "read-recovery", name: "Read internal recovery feed", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
  position: [-360, 40], onError: "continueRegularOutput",
};

function projectRecoveryResponse(response, errorObservedAt = new Date().toISOString()) {
  const rawStatus = response?.statusCode ?? response?.status ?? response?.error?.statusCode ?? response?.error?.httpCode;
  const statusCode = Number(rawStatus);
  const unavailable = () => ({ surface: "recovery", observedAt: new Date(errorObservedAt).toISOString(), status: "error", errorCode: "provider_unavailable" });
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) return unavailable();
  const body = response?.body;
  const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const iso = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
  try {
    if (!exact(body, ["schemaVersion", "generatedAt", "backupFolder", "restoreChecks", "automation", "backupCatalog"]) || body.schemaVersion !== 1) throw new Error("invalid");
    const generatedAt = iso(body.generatedAt);
    const folder = body.backupFolder;
    if (!generatedAt || !exact(folder, ["name", "bytes", "objects", "measuredAt"]) || folder.name !== "SecDash Backups") throw new Error("invalid");
    const bytes = integer(folder.bytes), objects = integer(folder.objects), measuredAt = iso(folder.measuredAt);
    if (bytes === null || objects === null || !measuredAt || !Array.isArray(body.restoreChecks) || body.restoreChecks.length > 1000) throw new Error("invalid");
    const restoreChecks = body.restoreChecks.map(raw => {
      const allowed = ["checkedAt", "requestedSnapshot", "ok", "sourceCreatedAt", "checksumsVerified", "credentialDecryptionVerified", "counts", "dashboard", "serverDashboard"];
      if (!exact(raw, allowed)) throw new Error("invalid");
      const checkedAt = iso(raw.checkedAt), snapshot = raw.requestedSnapshot;
      if (!checkedAt || typeof raw.ok !== "boolean" || (snapshot !== "latest" && (typeof snapshot !== "string" || !/^[a-fA-F0-9]{64}$/.test(snapshot)))) throw new Error("invalid");
      const item = { checkedAt, requestedSnapshot: snapshot, ok: raw.ok };
      if (raw.sourceCreatedAt !== undefined) { const value = iso(raw.sourceCreatedAt); if (!value) throw new Error("invalid"); item.sourceCreatedAt = value; }
      if (raw.checksumsVerified !== undefined) { const value = integer(raw.checksumsVerified); if (value === null) throw new Error("invalid"); item.checksumsVerified = value; }
      if (raw.credentialDecryptionVerified !== undefined) { if (typeof raw.credentialDecryptionVerified !== "boolean") throw new Error("invalid"); item.credentialDecryptionVerified = raw.credentialDecryptionVerified; }
      for (const [key, fields] of [["counts", ["credentials", "users", "workflows"]], ["dashboard", ["databases", "files"]], ["serverDashboard", ["messages", "tables"]]]) {
        if (raw[key] === undefined) continue;
        if (!exact(raw[key], fields) || Object.keys(raw[key]).length !== fields.length) throw new Error("invalid");
        const proof = {}; for (const field of fields) { const value = integer(raw[key][field]); if (value === null) throw new Error("invalid"); proof[field] = value; } item[key] = proof;
      }
      return item;
    });
    const automation = body.automation;
    if (!exact(automation, ["measuredAt", "workflows", "executionHistoryAvailable", "lastExecution", "failureCount24h", "aiUsage"])) throw new Error("invalid");
    const automationMeasuredAt = iso(automation.measuredAt);
    const workflowIds = ["SecDashRecoveryOperational", "SecDashCloudflareOperational", "SecDashAzureOperational", "SecDashGoDaddyOperational", "SecDashLemonSqueezyOperational", "SecDashGoogleDriveStorage", "SecDashMailboxContinuityPrepared", "SecDashMailboxRoutingDrain"];
    if (!automationMeasuredAt || !Array.isArray(automation.workflows) || automation.workflows.length > workflowIds.length || typeof automation.executionHistoryAvailable !== "boolean") throw new Error("invalid");
    const workflows = automation.workflows.map(item => {
      if (!exact(item, ["id", "name", "active"]) || !workflowIds.includes(item.id) || typeof item.name !== "string" || !item.name || typeof item.active !== "boolean") throw new Error("invalid");
      return { id: item.id, name: item.name.slice(0, 160), active: item.active };
    });
    if (new Set(workflows.map(item => item.id)).size !== workflows.length) throw new Error("invalid");
    const cleanAutomation = { measuredAt: automationMeasuredAt, workflows, executionHistoryAvailable: automation.executionHistoryAvailable, lastExecution: null, failureCount24h: null };
    if (automation.aiUsage !== undefined) {
      const usage = sanitizeAiUsage(automation.aiUsage);
      cleanAutomation.aiUsage = usage && Date.parse(usage.measuredAt) <= Date.parse(automationMeasuredAt) + 300000
        ? usage : { status: 'unavailable', measuredAt: automationMeasuredAt, errorCode: 'usage_unavailable' };
    }
    if (automation.executionHistoryAvailable) {
      const last = automation.lastExecution;
      const failures = integer(automation.failureCount24h);
      if (!exact(last, ["workflowId", "status", "startedAt", "finishedAt", "durationMs"]) || !workflowIds.includes(last.workflowId) || typeof last.status !== "string" || failures === null) throw new Error("invalid");
      const startedAt = iso(last.startedAt), finishedAt = last.finishedAt === null ? null : iso(last.finishedAt), durationMs = last.durationMs === null ? null : integer(last.durationMs);
      if (!startedAt || (last.finishedAt !== null && !finishedAt) || (last.durationMs !== null && durationMs === null)) throw new Error("invalid");
      cleanAutomation.lastExecution = { workflowId: last.workflowId, status: last.status.slice(0, 40), startedAt, finishedAt, durationMs };
      cleanAutomation.failureCount24h = failures;
    } else if (automation.lastExecution !== null || automation.failureCount24h !== null) throw new Error("invalid");
    let backupCatalog;
    if (body.backupCatalog !== undefined) {
      const catalog = body.backupCatalog, ids = ["dashboard-n8n", "example-app-source"], phases = ["idle","preparing","snapshotting","uploading","verifying","complete","failed","unavailable"];
      if (!exact(catalog,["schemaVersion","generatedAt","libraries"]) || catalog.schemaVersion !== 1 || !iso(catalog.generatedAt) || !Array.isArray(catalog.libraries) || catalog.libraries.length !== 2) throw new Error("invalid");
      const libraries = catalog.libraries.map(library => {
        if (!exact(library,["id","name","mode","setup","eligibleForSync","phase","summary","destinations","sourceLogicalBytes"]) || !ids.includes(library.id) || library.mode !== "active-sync" || !["initialized","not-initialized","unavailable"].includes(library.setup) || typeof library.eligibleForSync !== "boolean" || !phases.includes(library.phase) || typeof library.name !== "string" || library.name.length > 96 || typeof library.summary !== "string" || library.summary.length > 320 || !Array.isArray(library.destinations) || library.destinations.length > 8 || !(library.sourceLogicalBytes === undefined || library.sourceLogicalBytes === null || integer(library.sourceLogicalBytes) !== null)) throw new Error("invalid");
        const destinations = library.destinations.map(dest => {
          if (!exact(dest,["id","label","kind","status","lastSnapshot","lastVerification","history","repositoryBytes","repositoryBytesStatus","repositoryBytesMeasuredAt"]) || typeof dest.id !== "string" || dest.id.length > 128 || typeof dest.label !== "string" || dest.label.length > 96 || !["google-drive","external-drive"].includes(dest.kind) || !["current","stale","error","unavailable","not-initialized"].includes(dest.status) || !Array.isArray(dest.history) || dest.history.length > 100) throw new Error("invalid");
          const hasMetric = dest.repositoryBytes !== undefined || dest.repositoryBytesStatus !== undefined || dest.repositoryBytesMeasuredAt !== undefined;
          if (hasMetric && !((dest.repositoryBytesStatus === "measured" && integer(dest.repositoryBytes) !== null && iso(dest.repositoryBytesMeasuredAt)) || (dest.repositoryBytesStatus === "unavailable" && dest.repositoryBytes === null && dest.repositoryBytesMeasuredAt === null))) throw new Error("invalid");
          const snapshot = dest.lastSnapshot === null ? null : dest.lastSnapshot, verification = dest.lastVerification === null ? null : dest.lastVerification;
          if (snapshot && (!exact(snapshot,["snapshotId","createdAt","sizeBytes"]) || typeof snapshot.snapshotId !== "string" || !iso(snapshot.createdAt) || !(snapshot.sizeBytes === null || integer(snapshot.sizeBytes) !== null))) throw new Error("invalid");
          if (verification && (!exact(verification,["status","verifiedAt","snapshotId"]) || !["passed","failed"].includes(verification.status) || !iso(verification.verifiedAt) || !(verification.snapshotId === null || typeof verification.snapshotId === "string"))) throw new Error("invalid");
          const history = dest.history.map(event => { if (!exact(event,["id","kind","status","occurredAt","snapshotId","summary"]) || typeof event.id !== "string" || !["snapshot","verification","offload"].includes(event.kind) || !["succeeded","failed"].includes(event.status) || !iso(event.occurredAt) || !(event.snapshotId === null || typeof event.snapshotId === "string") || typeof event.summary !== "string" || event.summary.length > 320) throw new Error("invalid"); return {...event,occurredAt:iso(event.occurredAt)}; });
          return {...dest,lastSnapshot:snapshot?{...snapshot,createdAt:iso(snapshot.createdAt)}:null,lastVerification:verification?{...verification,verifiedAt:iso(verification.verifiedAt)}:null,history};
        }); return {...library,destinations};
      });
      if (new Set(libraries.map(item=>item.id)).size !== 2) throw new Error("invalid");
      backupCatalog = {schemaVersion:1,generatedAt:iso(catalog.generatedAt),libraries};
    }
    return { surface: "recovery", observedAt: generatedAt, status: "ok", data: { schemaVersion: 1, generatedAt, backupFolder: { name: "SecDash Backups", bytes, objects, measuredAt }, restoreChecks, automation: cleanAutomation, ...(backupCatalog ? {backupCatalog} : {}) } };
  } catch {
    return { surface: "recovery", observedAt: new Date(errorObservedAt).toISOString(), status: "error", errorCode: "invalid_response" };
  }
}

const source = `${sanitizeAiUsage.toString()}\n${projectRecoveryResponse.toString()}\nreturn [{json: projectRecoveryResponse($json)}];`;
export const definition = workflow("SecDashRecoveryOperational", "SecDash — recovery operations (5 min)", [
  schedule, manualNode, read, codeNode("project", "Sanitize recovery telemetry", source, [-100, 40]), deliveryNode([160, 40]),
], {
  "Every 5 minutes": { main: [[{ node: "Read internal recovery feed", type: "main", index: 0 }]] },
  "Run manually": { main: [[{ node: "Read internal recovery feed", type: "main", index: 0 }]] },
  "Read internal recovery feed": { main: [[{ node: "Sanitize recovery telemetry", type: "main", index: 0 }]] },
  "Sanitize recovery telemetry": { main: [[{ node: "Deliver operation observation", type: "main", index: 0 }]] },
});
definition.settings.executionTimeout = 60;

if (process.argv.includes("--write")) writeFileSync(fileURLToPath(new URL("./operational-recovery.json", import.meta.url)), `${JSON.stringify(definition, null, 2)}\n`);
