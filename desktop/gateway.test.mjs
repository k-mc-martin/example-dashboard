import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDesktopHandler } from "./gateway.mjs";

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function port(server) {
  const address = server.address();
  assert(address && typeof address === "object");
  return address.port;
}

function close(server) {
  server.closeAllConnections();
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function request(serverPort, requestPath, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port: serverPort, path: requestPath, method, headers }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test("desktop gateway isolates local UI, private APIs, and backup control", async t => {
  const directory = mkdtempSync(path.join(tmpdir(), "dupdash-desktop-gateway-"));
  const uiRoot = path.join(directory, "ui");
  const outside = path.join(directory, "private.txt");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(uiRoot));
  writeFileSync(path.join(uiRoot, "index.html"), "<!doctype html><title>Local dashboard</title>");
  writeFileSync(path.join(uiRoot, "app.js"), "window.dashboard = true;");
  writeFileSync(outside, "server-only material");
  symlinkSync(outside, path.join(uiRoot, "linked.txt"));

  const upstreamRequests = [];
  const upstream = await listen((req, res) => {
    const record = { method: req.method, url: req.url, headers: req.headers, body: "" };
    upstreamRequests.push(record);
    const chunks=[]; req.on("data",chunk=>chunks.push(chunk)); req.on("end",()=>{
      record.body=Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json", "x-upstream-secret": "discard-me" });
      res.end(JSON.stringify(req.method === "POST"
        ? { dismissal: { ...JSON.parse(record.body), dismissedAt: "2026-10-17T12:00:00.000Z" } }
        : { ok: true, route: req.url }));
    });
  });

  const backupRequests = [];
  let backupResponseMode = "valid";
  const backup = await listen((req, res) => {
    const chunks=[]; req.on("data",chunk=>chunks.push(chunk)); req.on("end",()=>{
    backupRequests.push({ method: req.method, url: req.url, headers: req.headers, body:Buffer.concat(chunks).toString("utf8") });
    if (backupResponseMode === "declared-large") {
      const body = "x".repeat(4097);
      res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      return res.end(body);
    }
    if (backupResponseMode === "streamed-large") {
      res.writeHead(200, { "content-type": "application/json" });
      res.write("x".repeat(3000));
      return res.end("x".repeat(3000));
    }
    if(req.url==="/v1/catalog") {
      const library=(id,mode="active-sync")=>({id,name:id,mode,setup:"initialized",eligibleForSync:id!=="cold-storage",phase:"idle",summary:"safe",destinations:[]});
      const body=JSON.stringify({schemaVersion:1,serverTime:"2026-10-01T12:00:00Z",source:{kind:"mac-controller",observedAt:null,receivedAt:null,status:"current",detail:"safe",credential:"strip"},update:{state:backupResponseMode==="busy"?"running":"idle",jobId:backupResponseMode==="busy"?"job-1":null,startedAt:backupResponseMode==="busy"?"2026-10-01T12:00:00Z":null,finishedAt:null,phase:null,summary:"safe",secret:"strip"},libraries:[library("dashboard-n8n"),library("example-app-source"),library("cold-storage","verified-offload")],secret:"strip"});
      res.writeHead(backupResponseMode==="busy"?409:200,{"content-type":"application/json"}); return res.end(body);
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jobId: "backup-job", state: "succeeded",
      startedAt: "2026-09-30T10:00:00.000Z", finishedAt: "2026-09-30T10:01:00.000Z",
      snapshotId: "snapshot-id", summary: "untrusted controller detail",
      credential: "must-not-pass-through",
    }));
    });
  });

  let gatewayPort;
  let upstreamAvailable = true;
  const gateway = await listen(createDesktopHandler({
    uiRoot,
    getPort: () => gatewayPort,
    getUpstream: async () => {
      if (!upstreamAvailable) throw new Error("offline");
      return port(upstream);
    },
    operatorToken: "server-side-operator-token-value-123456",
    backupControllerPort: port(backup),
    backupService: { token: "server-side-backup-token-value-123456", ensure: async () => true },
    timeoutMs: 1000,
  }));
  gatewayPort = port(gateway);
  const host = `127.0.0.1:${gatewayPort}`;
  const origin = `http://${host}`;
  const localHeaders = { host, origin, "sec-fetch-site": "same-origin" };

  t.after(async () => {
    await Promise.all([close(gateway), close(upstream), close(backup)]);
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test("serves bundled UI without consulting the upstream", async () => {
    upstreamAvailable = false;
    const response = await request(gatewayPort, "/", { headers: { host } });
    assert.equal(response.status, 200);
    assert.match(response.body, /Local dashboard/);
    assert.equal(response.headers["content-security-policy"]?.includes("connect-src 'self'"), true);
    assert.equal(upstreamRequests.length, 0);
    upstreamAvailable = true;
  });

  await t.test("forwards only allowed reads with the fixed host and server bearer", async () => {
    const response = await request(gatewayPort, "/api/dashboard", {
      headers: { ...localHeaders, authorization: "Bearer hostile-browser-token", cookie: "session=hostile" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true, route: "/api/dashboard" });
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].headers.host, "127.0.0.1:5286");
    assert.equal(upstreamRequests[0].headers.authorization, "Bearer server-side-operator-token-value-123456");
    assert.equal(upstreamRequests[0].headers.cookie, undefined);
    assert.equal(response.headers["x-upstream-secret"], undefined);
  });

  await t.test("rejects foreign browser contexts before serving files or APIs", async () => {
    for (const headers of [
      { host: "attacker.invalid" },
      { host, origin: "https://attacker.invalid" },
      { host, origin, "sec-fetch-site": "cross-site" },
    ]) {
      const response = await request(gatewayPort, "/", { headers });
      assert.equal(response.status, 403);
    }
  });

  await t.test("blocks intake, unknown APIs, API writes, and query-bearing API reads", async () => {
    assert.equal((await request(gatewayPort, "/api/n8n/messages", { headers: localHeaders })).status, 403);
    assert.equal((await request(gatewayPort, "/api/n8n/drive-storage", { headers: localHeaders })).status, 403);
    assert.equal((await request(gatewayPort, "/api/unknown", { headers: localHeaders })).status, 403);
    assert.equal((await request(gatewayPort, "/api/dashboard", { method: "POST", headers: localHeaders })).status, 405);
    assert.equal((await request(gatewayPort, "/api/dashboard?unexpected=1", { headers: localHeaders })).status, 400);
    assert.equal(upstreamRequests.length, 1);
  });

  await t.test("permits storage observations as an authenticated read only", async () => {
    const response = await request(gatewayPort, "/api/drive-storage", { headers: localHeaders });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { ok: true, route: "/api/drive-storage" });
    assert.equal(upstreamRequests.at(-1).headers.authorization, "Bearer server-side-operator-token-value-123456");
    assert.equal((await request(gatewayPort, "/api/drive-storage", { method: "POST", headers: localHeaders })).status, 405);
    assert.equal((await request(gatewayPort, "/api/drive-storage?token=untrusted", { headers: localHeaders })).status, 400);
  });

  await t.test("keeps traversal, symlinks, and server files outside the UI root", async () => {
    for (const pathname of ["/..%2fprivate.txt", "/linked.txt", "/../../desktop/gateway.mjs", "/%00index.html"]) {
      const response = await request(gatewayPort, pathname, { headers: { host } });
      assert.equal(response.status, 404, pathname);
      assert.doesNotMatch(response.body, /server-only material|createDesktopHandler/);
    }
  });

  await t.test("requires an exact empty same-origin backup POST and returns sanitized status", async () => {
    const missingOrigin = await request(gatewayPort, "/api/backups", { method: "POST", headers: { host, "content-length": "0" } });
    assert.equal(missingOrigin.status, 403);
    const crossSite = await request(gatewayPort, "/api/backups", { method: "POST", headers: { ...localHeaders, "sec-fetch-site": "cross-site", "content-length": "0" } });
    assert.equal(crossSite.status, 403);
    const body = await request(gatewayPort, "/api/backups", { method: "POST", headers: { ...localHeaders, "content-length": "1" }, body: "x" });
    assert.equal(body.status, 403);

    const response = await request(gatewayPort, "/api/backups", { method: "POST", headers: { ...localHeaders, "content-length": "0" } });
    assert.equal(response.status, 202);
    const value = JSON.parse(response.body);
    assert.deepEqual(value, {
      jobId: "backup-job", state: "succeeded",
      startedAt: "2026-09-30T10:00:00.000Z", finishedAt: "2026-09-30T10:01:00.000Z",
      summary: "The encrypted backup was uploaded to Google Drive.", snapshotId: "snapshot-id",
    });
    assert.equal(JSON.stringify(value).includes("credential"), false);
    assert.equal(backupRequests.length, 1);
    assert.equal(backupRequests[0].url, "/v1/jobs");
    assert.equal(backupRequests[0].headers.authorization, "Bearer server-side-backup-token-value-123456");
  });

  await t.test("rejects oversized controller responses by declared and streamed byte length", async () => {
    for (const mode of ["declared-large", "streamed-large"]) {
      backupResponseMode = mode;
      const response = await request(gatewayPort, "/api/backups", { headers: localHeaders });
      assert.equal(response.status, 503, mode);
      assert.deepEqual(JSON.parse(response.body), { error: "The local backup service is unavailable." });
    }
    backupResponseMode = "valid";
  });

  await t.test("catalog GET and exact sync POST are sanitized while CSRF and invalid actions are rejected", async () => {
    let response=await request(gatewayPort,"/api/backup-catalog",{headers:localHeaders});
    assert.equal(response.status,200); assert.equal(JSON.stringify(JSON.parse(response.body)).includes("secret"),false); assert.equal(JSON.stringify(JSON.parse(response.body)).includes("credential"),false);
    for(const options of [
      {method:"POST",headers:{host,"content-type":"application/json","content-length":"17"},body:'{"action":"sync"}'},
      {method:"POST",headers:{...localHeaders,"content-type":"application/json","content-length":"18"},body:'{"action":"other"}'},
      {method:"POST",headers:{...localHeaders,"content-type":"application/json","content-length":"80"},body:"x".repeat(80)},
    ]) assert.equal((await request(gatewayPort,"/api/backup-catalog",options)).status,403);
    response=await request(gatewayPort,"/api/backup-catalog",{method:"POST",headers:{...localHeaders,"content-type":"application/json","content-length":String(Buffer.byteLength('{"action":"sync"}'))},body:'{"action":"sync"}'});
    assert.equal(response.status,202); assert.equal(backupRequests.at(-1).body,'{"action":"sync"}');
    backupResponseMode="busy";
    response=await request(gatewayPort,"/api/backup-catalog",{method:"POST",headers:{...localHeaders,"content-type":"application/json","content-length":String(Buffer.byteLength('{"action":"sync"}'))},body:'{"action":"sync"}'});
    assert.equal(response.status,202); assert.equal(JSON.parse(response.body).update.state,"running");
    backupResponseMode="valid";
  });

  await t.test("feedback search reaches the private API without broadening write access", async () => {
    const search = "/api/feedback?environment=beta&interpretation=experience_obstructed&q=slow%20search&offset=50";
    const response = await request(gatewayPort, search, { headers: localHeaders });
    assert.equal(response.status, 200);
    assert.equal(upstreamRequests.at(-1).url, search);
    assert.equal((await request(gatewayPort, "/api/feedback", { method: "POST", headers: localHeaders })).status, 405);
    assert.equal((await request(gatewayPort, "/api/dashboard?q=anything", { headers: localHeaders })).status, 400);
  });

  await t.test("persists only a bounded same-origin individual attention dismissal", async () => {
    const value = { identity: `feedback-obstruction:${"a".repeat(64)}`, conditionRevision: "source-a:analysis-a" };
    const body = JSON.stringify(value);
    let response = await request(gatewayPort, "/api/attention-dismissals", {
      method: "POST", headers: { ...localHeaders, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }, body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(upstreamRequests.at(-1).body), value);
    assert.equal(upstreamRequests.at(-1).headers.authorization, "Bearer server-side-operator-token-value-123456");
    assert.equal(upstreamRequests.at(-1).headers.origin, "http://127.0.0.1:5286");

    response = await request(gatewayPort, "/api/attention-dismissals", {
      method: "POST", headers: { host, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) }, body,
    });
    assert.equal(response.status, 403);
    const invalid = JSON.stringify({ ...value, extra: true });
    response = await request(gatewayPort, "/api/attention-dismissals", {
      method: "POST", headers: { ...localHeaders, "content-type": "application/json", "content-length": String(Buffer.byteLength(invalid)) }, body: invalid,
    });
    assert.equal(response.status, 400);
    assert.equal((await request(gatewayPort, "/api/attention-dismissals", { headers: localHeaders })).status, 200);
  });

  await t.test("returns 503 for an unavailable API upstream while UI remains available", async () => {
    upstreamAvailable = false;
    const api = await request(gatewayPort, "/api/dashboard", { headers: localHeaders });
    assert.equal(api.status, 503);
    assert.deepEqual(JSON.parse(api.body), { error: "The private server is unavailable. Reconnect and refresh." });
    const ui = await request(gatewayPort, "/app.js", { headers: { host } });
    assert.equal(ui.status, 200);
    assert.equal(ui.body, "window.dashboard = true;");
  });
});
