import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { after, before, test } from "node:test";
import { createGatewayHandler } from "./access.mjs";

const operatorToken = "operator-" + "o".repeat(40);
const controllerToken = "controller-" + "c".repeat(40);
let upstreamHeaders;
let upstreamBody = "";
let upstreamHits = 0;
let controllerAuthorization;
let controllerBody = {
  jobId: "job-123", state: "succeeded", startedAt: "2026-09-30T01:00:00Z",
  finishedAt: "2026-09-30T01:01:00Z", summary: "private detail", snapshotId: "snap-123",
};
const catalogLibrary=(id,mode="active-sync")=>({id,name:id,mode,setup:"initialized",eligibleForSync:id!=="cold-storage",phase:"idle",summary:"safe",destinations:[]});
let catalogBusy=false;
let upstream;
let controller;
let gateway;
let gatewayPort;

function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function send({ path = "/", method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port: gatewayPort, path, method,
      headers: { host: "127.0.0.1:5286", ...headers } }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("aborted", () => reject(new Error("response aborted")));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

before(async () => {
  upstream = createServer((request, response) => {
    upstreamHits += 1;
    upstreamHeaders = request.headers;
    if (request.url === "/api/attention-dismissals" && request.method === "POST") {
      const chunks = [];
      request.on("data", chunk => chunks.push(chunk));
      request.on("end", () => {
        upstreamBody = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ dismissal: { ...JSON.parse(upstreamBody), dismissedAt: "2026-10-17T12:00:00.000Z" } }));
      });
      return;
    }
    if (request.url === "/slow") return setTimeout(() => response.end("late"), 250);
    if (request.url === "/partial-error") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.flushHeaders();
      response.write("partial");
      return setTimeout(() => response.socket.destroy(), 10);
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("dashboard");
  });
  const upstreamPort = await listen(upstream);
  controller = createServer((request, response) => {
    controllerAuthorization = request.headers.authorization;
    if(request.url==="/v1/catalog") {
      const body=JSON.stringify({schemaVersion:1,serverTime:"2026-10-01T12:00:00Z",source:{kind:"mac-controller",observedAt:null,receivedAt:null,status:"current",detail:"safe",secret:"strip"},update:{state:catalogBusy?"running":"idle",jobId:catalogBusy?"job-1":null,startedAt:catalogBusy?"2026-10-01T12:00:00Z":null,finishedAt:null,phase:null,summary:"safe"},libraries:[catalogLibrary("dashboard-n8n"),catalogLibrary("example-app-source"),catalogLibrary("cold-storage","verified-offload")],secret:"strip"});
      response.writeHead(catalogBusy?409:200,{"content-type":"application/json","content-length":Buffer.byteLength(body)}); return response.end(body);
    }
    const body = JSON.stringify(controllerBody);
    response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    response.end(body);
  });
  const backupControllerPort = await listen(controller);
  gateway = createServer(createGatewayHandler({ upstreamPort, operatorToken,
    backupControllerToken: controllerToken, backupControllerPort, upstreamTimeoutMs: 50 }));
  gatewayPort = await listen(gateway);
});

after(async () => {
  await Promise.all([close(gateway), close(controller), close(upstream)]);
});

test("forwards safe GET and replaces authorization and proxy headers", async () => {
  const response = await send({ headers: {
    authorization: "Bearer browser-secret", "proxy-authorization": "Basic secret",
    forwarded: "for=public", "x-forwarded-for": "203.0.113.9", "x-forwarded-client-cert": "secret",
    "x-real-ip": "203.0.113.9", connection: "x-private-hop", "x-private-hop": "secret",
  } });
  assert.equal(response.status, 200);
  assert.equal(response.body, "dashboard");
  assert.equal(upstreamHeaders.authorization, `Bearer ${operatorToken}`);
  assert.equal(upstreamHeaders.forwarded, undefined);
  assert.equal(upstreamHeaders["x-forwarded-for"], undefined);
  assert.equal(upstreamHeaders["x-forwarded-client-cert"], undefined);
  assert.equal(upstreamHeaders["x-real-ip"], undefined);
  assert.equal(upstreamHeaders["x-private-hop"], undefined);
  assert.equal(upstreamHeaders["proxy-authorization"], undefined);
  assert.equal(upstreamHeaders.host, "127.0.0.1:5286");
});

test("rejects foreign host, cross-origin, and absolute-form requests", async () => {
  const beforeHits = upstreamHits;
  assert.equal((await send({ headers: { host: "evil.example" } })).status, 403);
  assert.equal((await send({ headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await send({ path: "http://evil.example/steal" })).status, 403);
  assert.equal(upstreamHits, beforeHits);
});

test("allows only read forwarding and blocks mailbox intake", async () => {
  assert.equal((await send({ method: "POST", path: "/api/messages" })).status, 405);
  assert.equal((await send({ method: "POST", path: "/api/n8n/messages" })).status, 403);
  assert.equal((await send({ method: "POST", path: "/api/n8n/provider-connections" })).status, 403);
  assert.equal((await send({ method: "POST", path: "/api/n8n/drive-storage" })).status, 403);
});

test("allows only a bounded same-origin attention dismissal write", async () => {
  const value = { identity: `feedback-obstruction:${"a".repeat(64)}`, conditionRevision: "source-a:analysis-a" };
  const body = JSON.stringify(value);
  let response = await send({ method: "POST", path: "/api/attention-dismissals", headers: {
    origin: "http://127.0.0.1:5286", "sec-fetch-site": "same-origin", "content-type": "application/json", "content-length": String(Buffer.byteLength(body)),
  }, body });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(upstreamBody), value);
  assert.equal(upstreamHeaders.authorization, `Bearer ${operatorToken}`);

  response = await send({ method: "POST", path: "/api/attention-dismissals", headers: {
    "content-type": "application/json", "content-length": String(Buffer.byteLength(body)),
  }, body });
  assert.equal(response.status, 403);
  const invalid = JSON.stringify({ ...value, extra: true });
  response = await send({ method: "POST", path: "/api/attention-dismissals", headers: {
    origin: "http://127.0.0.1:5286", "sec-fetch-site": "same-origin", "content-type": "application/json", "content-length": String(Buffer.byteLength(invalid)),
  }, body: invalid });
  assert.equal(response.status, 400);
});

test("intercepts backups and returns only sanitized status", async () => {
  const response = await send({ path: "/api/backups" });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(controllerAuthorization, `Bearer ${controllerToken}`);
  assert.equal(body.summary, "The encrypted backup was uploaded to Google Drive.");
  assert.equal(JSON.stringify(body).includes("private detail"), false);
});

test("requires same-origin browser metadata for backup POST", async () => {
  assert.equal((await send({ method: "POST", path: "/api/backups" })).status, 403);
  const response = await send({ method: "POST", path: "/api/backups", headers: {
    origin: "http://127.0.0.1:5286", "sec-fetch-site": "same-origin", "content-length": "0",
  } });
  assert.equal(response.status, 202);
});

test("catalog gateway enforces exact sync action, maps busy, and strips extra fields", async () => {
  let response=await send({path:"/api/backup-catalog"});
  assert.equal(response.status,200); assert.equal(JSON.stringify(JSON.parse(response.body)).includes("secret"),false);
  assert.equal((await send({path:"/api/backup-catalog",method:"POST",headers:{"content-type":"application/json","content-length":"17"}})).status,403);
  response=await send({path:"/api/backup-catalog",method:"POST",headers:{origin:"http://127.0.0.1:5286","sec-fetch-site":"same-origin","content-type":"application/json","content-length":"17"},body:'{"action":"nope"}'});
  assert.equal(response.status,400);
  response=await send({path:"/api/backup-catalog",method:"POST",headers:{origin:"http://127.0.0.1:5286","sec-fetch-site":"same-origin","content-type":"application/json","content-length":"17"},body:'{"action":"sync"}'});
  assert.equal(response.status,202);
  catalogBusy=true;
  response=await send({path:"/api/backup-catalog",method:"POST",headers:{origin:"http://127.0.0.1:5286","sec-fetch-site":"same-origin","content-type":"application/json","content-length":"17"},body:'{"action":"sync"}'});
  assert.equal(response.status,202); assert.equal(JSON.parse(response.body).update.state,"running");
  catalogBusy=false;
});

test("maps malformed controller responses to a sanitized 503", async () => {
  controllerBody = { state: "succeeded", summary: "secret", snapshotId: "bad id" };
  const response = await send({ path: "/api/backups" });
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "The local backup service is unavailable." });
});

test("times out stalled upstreams and survives partial upstream failures", async () => {
  const timeout = await send({ path: "/slow" });
  assert.equal(timeout.status, 503);
  await assert.rejects(send({ path: "/partial-error" }));
  const healthy = await send({ path: "/after-partial-error" });
  assert.equal(healthy.status, 200);
  assert.equal(healthy.body, "dashboard");
});
