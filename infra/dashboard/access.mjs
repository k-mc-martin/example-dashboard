import { request as httpRequest } from "node:http";

const SAFE_RESPONSE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const STRIP_REQUEST_HEADERS = new Set([
  "authorization", "connection", "forwarded", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-port", "x-forwarded-proto", "via",
]);
const STRIP_RESPONSE_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "te", "trailer", "transfer-encoding", "upgrade"]);
const PUBLIC_SUMMARIES = {
  never: "No backup has run yet.",
  running: "The encrypted backup is being prepared.",
  succeeded: "The encrypted backup was uploaded to Google Drive.",
  failed: "The backup failed. Check the local backup service logs.",
};

function parseTimestamp(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 64 || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

export function parseBackupStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const states = new Set(["never", "running", "succeeded", "failed"]);
  const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (!states.has(value.state)) return null;
  const jobId = value.jobId === null ? null : typeof value.jobId === "string" && safeId.test(value.jobId) ? value.jobId : undefined;
  const startedAt = parseTimestamp(value.startedAt);
  const finishedAt = parseTimestamp(value.finishedAt);
  const snapshotId = value.snapshotId === undefined ? undefined : typeof value.snapshotId === "string" && safeId.test(value.snapshotId) ? value.snapshotId : null;
  if (jobId === undefined || startedAt === undefined || finishedAt === undefined || snapshotId === null) return null;
  if (value.state === "never" && (jobId !== null || startedAt !== null || finishedAt !== null)) return null;
  if (value.state === "running" && (jobId === null || startedAt === null || finishedAt !== null)) return null;
  if (["succeeded", "failed"].includes(value.state) && (jobId === null || startedAt === null || finishedAt === null)) return null;
  return { jobId, state: value.state, startedAt, finishedAt, summary: PUBLIC_SUMMARIES[value.state], ...(snapshotId ? { snapshotId } : {}) };
}

export function parseBackupCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 || !Array.isArray(value.libraries) || value.libraries.length !== 3) return null;
  const ids = value.libraries.map(item => item?.id);
  if (!["dashboard-n8n", "example-app-source", "cold-storage"].every(id => ids.includes(id))) return null;
  const safeText = (text, limit=320) => typeof text === "string" && text.length <= limit && !/[\u0000-\u001f\u007f]/.test(text);
  const safeTime = timestamp => timestamp === null || (typeof timestamp === "string" && timestamp.length <= 64 && !Number.isNaN(Date.parse(timestamp)));
  const safeId = id => id === null || (typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id));
  if (!safeTime(value.serverTime) || !value.source || !["mac-controller", "n8n-recovery-feed"].includes(value.source.kind) || !safeTime(value.source.observedAt) || !safeTime(value.source.receivedAt) || !["current","stale","error","unavailable"].includes(value.source.status) || !safeText(value.source.detail)) return null;
  const update=value.update;
  if (!update || !["idle","running","succeeded","failed","unavailable"].includes(update.state) || !safeId(update.jobId) || !safeTime(update.startedAt) || !safeTime(update.finishedAt) || !(update.phase===null || safeText(update.phase,96)) || !safeText(update.summary)) return null;
  for (const library of value.libraries) {
    if (!library || !safeText(library.name,96) || !["active-sync","verified-offload"].includes(library.mode) || !["initialized","not-initialized","unavailable"].includes(library.setup) || typeof library.eligibleForSync !== "boolean" || !["idle","preparing","snapshotting","uploading","verifying","complete","failed","unavailable"].includes(library.phase) || !safeText(library.summary) || !Array.isArray(library.destinations) || library.destinations.length > 8) return null;
    if (library.id === "cold-storage" && (library.mode !== "verified-offload" || library.eligibleForSync)) return null;
    for (const destination of library.destinations) {
      if (!destination || !safeId(destination.id) || !safeText(destination.label,96) || !["google-drive","external-drive","cold-storage"].includes(destination.kind) || !["current","stale","error","unavailable","not-initialized"].includes(destination.status) || !Array.isArray(destination.history) || destination.history.length > 100) return null;
      if (destination.lastSnapshot !== null && (!destination.lastSnapshot || !safeId(destination.lastSnapshot.snapshotId) || !safeTime(destination.lastSnapshot.createdAt) || !(destination.lastSnapshot.sizeBytes === null || Number.isSafeInteger(destination.lastSnapshot.sizeBytes) && destination.lastSnapshot.sizeBytes >= 0))) return null;
      if (destination.lastVerification !== null && (!destination.lastVerification || !["passed","failed"].includes(destination.lastVerification.status) || !safeTime(destination.lastVerification.verifiedAt) || !safeId(destination.lastVerification.snapshotId))) return null;
      for (const event of destination.history) if (!event || !safeId(event.id) || !["snapshot","verification","offload"].includes(event.kind) || !["succeeded","failed"].includes(event.status) || !safeTime(event.occurredAt) || !safeId(event.snapshotId) || !safeText(event.summary)) return null;
      const hasRepository=destination.repositoryBytes!==undefined||destination.repositoryBytesStatus!==undefined||destination.repositoryBytesMeasuredAt!==undefined;
      if(hasRepository && (!['measured','unavailable'].includes(destination.repositoryBytesStatus) || !(destination.repositoryBytes===null||Number.isSafeInteger(destination.repositoryBytes)&&destination.repositoryBytes>=0) || !safeTime(destination.repositoryBytesMeasuredAt) || (destination.repositoryBytesStatus==='measured'&&(typeof destination.repositoryBytes!=='number'||destination.repositoryBytesMeasuredAt===null)) || (destination.repositoryBytesStatus==='unavailable'&&(destination.repositoryBytes!==null||destination.repositoryBytesMeasuredAt!==null)))) return null;
    }
    if(library.sourceLogicalBytes!==undefined && !(library.sourceLogicalBytes===null||Number.isSafeInteger(library.sourceLogicalBytes)&&library.sourceLogicalBytes>=0)) return null;
  }
  return {
    schemaVersion:1, serverTime:new Date(value.serverTime).toISOString(),
    source:{kind:value.source.kind,observedAt:value.source.observedAt===null?null:new Date(value.source.observedAt).toISOString(),receivedAt:value.source.receivedAt===null?null:new Date(value.source.receivedAt).toISOString(),status:value.source.status,detail:value.source.detail},
    update:{state:update.state,jobId:update.jobId,startedAt:update.startedAt===null?null:new Date(update.startedAt).toISOString(),finishedAt:update.finishedAt===null?null:new Date(update.finishedAt).toISOString(),phase:update.phase,summary:update.summary},
    libraries:value.libraries.map(library=>({id:library.id,name:library.name,mode:library.mode,setup:library.setup,eligibleForSync:library.eligibleForSync,phase:library.phase,summary:library.summary,...(library.sourceLogicalBytes!==undefined?{sourceLogicalBytes:library.sourceLogicalBytes}:{}),destinations:library.destinations.map(destination=>({id:destination.id,label:destination.label,kind:destination.kind,status:destination.status,lastSnapshot:destination.lastSnapshot===null?null:{snapshotId:destination.lastSnapshot.snapshotId,createdAt:new Date(destination.lastSnapshot.createdAt).toISOString(),sizeBytes:destination.lastSnapshot.sizeBytes},lastVerification:destination.lastVerification===null?null:{status:destination.lastVerification.status,verifiedAt:new Date(destination.lastVerification.verifiedAt).toISOString(),snapshotId:destination.lastVerification.snapshotId},history:destination.history.map(event=>({id:event.id,kind:event.kind,status:event.status,occurredAt:new Date(event.occurredAt).toISOString(),snapshotId:event.snapshotId,summary:event.summary})),...(destination.repositoryBytesStatus!==undefined?{repositoryBytes:destination.repositoryBytes,repositoryBytesStatus:destination.repositoryBytesStatus,repositoryBytesMeasuredAt:destination.repositoryBytesMeasuredAt===null?null:new Date(destination.repositoryBytesMeasuredAt).toISOString()}: {})}))})),
  };
}

function jsonResponse(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { ...SAFE_RESPONSE_HEADERS, "content-type": "application/json", "content-length": body.length });
  response.end(body);
}

function browserRequestAllowed(request) {
  const host = request.headers.host;
  if (host !== "127.0.0.1:5286" && host !== "localhost:5286") return false;
  if (typeof request.url !== "string" || !request.url.startsWith("/") || request.url.startsWith("//")) return false;
  let target;
  try { target = new URL(request.url, `http://${host}`); } catch { return false; }
  if (target.host !== host || target.protocol !== "http:" || target.username || target.password) return false;
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  const site = request.headers["sec-fetch-site"];
  return !site || site === "same-origin" || site === "none";
}

async function backupRequest(method, token, port) {
  const endpoint = method === "GET" ? "/v1/jobs/latest" : "/v1/jobs";
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method, headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  const length = Number(response.headers.get("content-length") || "0");
  if (length > 4096) throw new Error("invalid backup response");
  const text = await response.text();
  if (text.length > 4096) throw new Error("invalid backup response");
  const parsed = parseBackupStatus(JSON.parse(text));
  if (!parsed || !(response.ok || (method === "POST" && response.status === 409 && parsed.state === "running"))) {
    throw new Error("invalid backup response");
  }
  return parsed;
}

async function catalogRequest(method, token, port) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/catalog`, {
    method, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(method === "POST" ? {"content-type":"application/json"} : {}) },
    ...(method === "POST" ? {body: JSON.stringify({action:"sync"})} : {}), signal: AbortSignal.timeout(5000),
  });
  const length = Number(response.headers.get("content-length") || "0");
  if (!Number.isSafeInteger(length) || length > 65536) throw new Error("invalid catalog response");
  const text = await response.text();
  if (Buffer.byteLength(text) > 65536) throw new Error("invalid catalog response");
  const parsed = parseBackupCatalog(JSON.parse(text));
  if (!parsed || !(response.ok || (method === "POST" && response.status === 409 && parsed.update.state === "running"))) throw new Error("invalid catalog response");
  return parsed;
}

function upstreamHeaders(request, operatorToken) {
  const headers = {};
  const connectionHeaders = new Set(String(request.headers.connection || "").toLowerCase().split(",").map(value => value.trim()).filter(Boolean));
  for (const [name, value] of Object.entries(request.headers)) {
    const forwardedIdentity = name === "x-real-ip" || name.startsWith("x-forwarded-");
    if (value !== undefined && !STRIP_REQUEST_HEADERS.has(name) && !connectionHeaders.has(name) && !forwardedIdentity) headers[name] = value;
  }
  headers.host = "127.0.0.1:5286";
  headers.authorization = `Bearer ${operatorToken}`;
  return headers;
}

function proxyToDashboard(request, response, options, body) {
  const upstream = httpRequest({
    hostname: "127.0.0.1", port: options.upstreamPort, path: request.url,
    method: request.method, headers: upstreamHeaders(request, options.operatorToken),
  }, upstreamResponse => {
    const headers = {};
    for (const [name, value] of Object.entries(upstreamResponse.headers)) {
      if (value !== undefined && !STRIP_RESPONSE_HEADERS.has(name)) headers[name] = value;
    }
    response.writeHead(upstreamResponse.statusCode ?? 502, headers);
    upstreamResponse.on("error", () => response.destroy());
    upstreamResponse.pipe(response);
  });
  upstream.setTimeout(options.upstreamTimeoutMs ?? 15000, () => upstream.destroy(new Error("upstream timeout")));
  response.on("error", () => upstream.destroy());
  upstream.on("error", () => {
    if (response.headersSent) response.destroy();
    else jsonResponse(response, 503, { error: "The private dashboard is unavailable." });
  });
  upstream.end(body);
}

function validAttentionDismissal(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === 2
    && typeof value.identity === "string" && /^[a-z0-9][a-z0-9:._-]{0,179}$/.test(value.identity)
    && typeof value.conditionRevision === "string" && value.conditionRevision.length >= 1
    && value.conditionRevision.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value.conditionRevision);
}

export function createGatewayHandler(options) {
  return async (request, response) => {
    if (!browserRequestAllowed(request)) return jsonResponse(response, 403, { error: "This dashboard is available only on this Mac." });
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (pathname.startsWith("/api/n8n/")) return jsonResponse(response, 403, { error: "n8n intake is not available through this gateway." });
    if (pathname === "/api/attention-dismissals" && request.method === "POST") {
      const declared = Number(request.headers["content-length"] || 0);
      if (request.headers.origin !== `http://${request.headers.host}` || request.headers["sec-fetch-site"] !== "same-origin"
        || request.headers["transfer-encoding"] !== undefined || request.headers["content-type"]?.split(";")[0] !== "application/json") {
        return jsonResponse(response, 403, { error: "Same-origin JSON request required." });
      }
      if (!Number.isSafeInteger(declared) || declared < 1 || declared > 2048) return jsonResponse(response, 413, { error: "Dismissal request is too large." });
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 2048) return jsonResponse(response, 413, { error: "Dismissal request is too large." }); chunks.push(chunk); }
      if (size !== declared) return jsonResponse(response, 400, { error: "Invalid dismissal request." });
      let value; try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return jsonResponse(response, 400, { error: "Invalid dismissal request." }); }
      if (!validAttentionDismissal(value)) return jsonResponse(response, 400, { error: "Invalid dismissal request." });
      const body = Buffer.from(JSON.stringify(value));
      request.headers["content-length"] = String(body.length);
      request.headers.origin = "http://127.0.0.1:5286";
      request.headers["sec-fetch-site"] = "same-origin";
      return proxyToDashboard(request, response, options, body);
    }
    if (pathname === "/api/backups" || pathname === "/api/backup-catalog") {
      if (!options.backupControllerToken) return jsonResponse(response, 503, { error: "The local backup service is unavailable." });
      if (request.method !== "GET" && request.method !== "POST") return jsonResponse(response, 405, { error: "Method not allowed." });
      const isCatalog = pathname === "/api/backup-catalog";
      const expectedLength = Buffer.byteLength(JSON.stringify({action:"sync"}));
      if (request.method === "POST" && (request.headers.origin !== `http://${request.headers.host}` || request.headers["sec-fetch-site"] !== "same-origin" || request.headers["transfer-encoding"] !== undefined || (isCatalog ? (request.headers["content-type"]?.split(";")[0] !== "application/json" || Number(request.headers["content-length"] || 0) !== expectedLength) : Number(request.headers["content-length"] || 0) !== 0))) {
        return jsonResponse(response, 403, { error: "Same-origin request required." });
      }
      if (isCatalog && request.method === "POST") {
        const chunks=[]; for await (const chunk of request) chunks.push(chunk);
        if (Buffer.concat(chunks).toString("utf8") !== JSON.stringify({action:"sync"})) return jsonResponse(response,400,{error:"Invalid catalog action."});
      }
      try {
        const status = isCatalog ? await catalogRequest(request.method, options.backupControllerToken, options.backupControllerPort ?? 5780) : await backupRequest(request.method, options.backupControllerToken, options.backupControllerPort ?? 5780);
        return jsonResponse(response, request.method === "POST" ? 202 : 200, status);
      } catch {
        return jsonResponse(response, 503, { error: "The local backup service is unavailable." });
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return jsonResponse(response, 405, { error: "Method not allowed." });
    return proxyToDashboard(request, response, options);
  };
}
