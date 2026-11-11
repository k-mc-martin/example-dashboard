import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
assert.ok(existsSync(join(root, ".next", "BUILD_ID")), "Run a production build before this integration check.");
const directory = mkdtempSync(join(tmpdir(), "secdash-feedback-http-"));
const database = join(directory, "dashboard.sqlite");
const operatorToken = randomBytes(32).toString("hex");
const ingestToken = randomBytes(32).toString("hex");
const port = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(error => error ? reject(error) : resolvePort(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const expectedHost = "127.0.0.1:5286";
const server = spawn(process.execPath, [join(root, ".next", "standalone", "server.js")], {
  cwd: root,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(port), SECDASH_DATABASE_PATH: database, SECDASH_OPERATOR_TOKEN: operatorToken, SECDASH_INGEST_TOKEN: ingestToken },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverOutput = "";
server.stdout.on("data", chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });
server.stderr.on("data", chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });

const headers = token => ({ host: expectedHost, authorization: `Bearer ${token}` });
async function request(path, { token = operatorToken, method = "GET", json } = {}) {
  const body = json ? JSON.stringify(json) : undefined;
  return new Promise((resolveRequest, rejectRequest) => {
    const outgoing = nodeRequest(`${base}${path}`, {
      method, headers: { ...headers(token), ...(json ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}) },
    }, incoming => {
      const chunks = [];
      incoming.on("data", chunk => chunks.push(chunk));
      incoming.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolveRequest({ status: incoming.statusCode, ok: incoming.statusCode >= 200 && incoming.statusCode < 300, json: async () => JSON.parse(text) });
      });
    });
    outgoing.once("error", rejectRequest);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}
async function post(message, token = ingestToken) {
  const response = await request("/api/n8n/messages", { token, method: "POST", json: message });
  const payload = await response.json();
  return { response, payload };
}
function source(messageId, overrides = {}) {
  return {
    source: "integration-mail", messageId, sender: `${messageId}@example.invalid`, subject: `Subject ${messageId}`,
    body: `Evidence ${messageId}\n${"x".repeat(700)}`, receivedAt: "2026-10-02T12:00:00Z", category: "beta", ...overrides,
  };
}
function analysis(messageId, interpretation, overrides = {}) {
  return {
    environment: "beta", interpretation, evidenceQuotes: [`Evidence ${messageId}`], rationale: `Rationale ${messageId}`,
    context: `Context ${messageId}`, intendedExperienceReference: null, ...overrides,
  };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Production server exited before readiness.\n${serverOutput}`);
    try {
      const response = await request("/api/health");
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.equal(ready, true, `Production server did not become ready.\n${serverOutput}`);

  assert.equal((await request("/api/feedback", { token: ingestToken })).status, 401);
  assert.equal((await request("/api/feedback", { token: "x".repeat(64) })).status, 401);
  assert.equal((await request("/api/attention-dismissals", { token: ingestToken })).status, 401);
  assert.equal((await request("/api/attention-dismissals", { token: "x".repeat(64) })).status, 401);
  assert.equal((await post(source("wrong-role"), operatorToken)).response.status, 401);

  const dismissal = { identity: "feedback-obstruction:" + "a".repeat(64), conditionRevision: "source-a:analysis-a" };
  assert.equal((await request("/api/attention-dismissals", { method: "POST", json: dismissal })).status, 200);
  const savedDismissals = await (await request("/api/attention-dismissals")).json();
  assert.equal(savedDismissals.dismissals.length, 1);
  assert.deepEqual({
    identity: savedDismissals.dismissals[0].identity,
    conditionRevision: savedDismissals.dismissals[0].conditionRevision,
  }, dismissal);
  assert.equal((await request("/api/attention-dismissals", { method: "POST", json: { ...dismissal, extra: true } })).status, 400);

  const interpretations = ["experience_reached", "experience_obstructed", "misinterpretation", "preference", "unclassified"];
  const ids = new Map();
  for (const interpretation of interpretations) {
    const messageId = `beta-${interpretation}`;
    const stored = await post(source(messageId, { feedback: analysis(messageId, interpretation) }));
    assert.equal(stored.response.status, 200);
    ids.set(messageId, stored.payload.id);
  }
  assert.equal((await post(source("beta-awaiting"))).response.status, 200);
  const staleInitial = await post(source("beta-stale", { feedback: analysis("beta-stale", "preference") }));
  assert.equal(staleInitial.response.status, 200);
  assert.equal((await post(source("beta-stale", { subject: "Changed stale subject", body: "Changed stale body" }))).response.status, 200);

  assert.equal((await post(source("customer-one", { category: "unsorted", feedback: analysis("customer-one", "unclassified", { environment: "customer", context: "customer-search-needle" }) }))).response.status, 200);
  assert.equal((await post(source("unclear-one", { category: "support", feedback: analysis("unclear-one", "unclassified", { environment: "unclassified" }) }))).response.status, 200);
  assert.equal((await post(source("not-feedback", { category: "unsorted", feedback: analysis("not-feedback", "unclassified", { environment: "none", evidenceQuotes: [] }) }))).response.status, 200);
  assert.equal((await post(source("unassessed-nonbeta", { category: "support" }))).response.status, 200);

  const beforeInvalid = await request(`/api/messages/${ids.get("beta-experience_reached")}`);
  assert.equal(beforeInvalid.status, 200);
  const original = (await beforeInvalid.json()).message;
  const invalid = source("beta-experience_reached", { subject: "Should not persist", body: "Should not persist", feedback: analysis("beta-experience_reached", "experience_reached", { evidenceQuotes: ["absent exact quote"] }) });
  assert.equal((await post(invalid)).response.status, 400);
  const afterInvalid = await request(`/api/messages/${ids.get("beta-experience_reached")}`);
  assert.equal(afterInvalid.status, 200);
  assert.deepEqual((await afterInvalid.json()).message, original);
  assert.ok(original.body.length > 500);

  for (const interpretation of interpretations.slice(0, 4)) {
    const response = await request(`/api/feedback?environment=beta&interpretation=${interpretation}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0].status, "current");
  }
  const dashboard = await (await request("/api/dashboard")).json();
  assert.equal(dashboard.attentionFeedbackObstructions.length, 1);
  assert.equal(dashboard.attentionFeedbackObstructions[0].messageId, ids.get("beta-experience_obstructed"));
  const exactObstruction = await (await request(`/api/feedback?environment=beta&interpretation=experience_obstructed&messageId=${ids.get("beta-experience_obstructed")}`)).json();
  assert.equal(exactObstruction.total, 1);
  assert.equal(exactObstruction.items[0].message.id, ids.get("beta-experience_obstructed"));
  const betaUnclassified = await (await request("/api/feedback?environment=beta&interpretation=unclassified")).json();
  assert.equal(betaUnclassified.total, 3);
  assert.deepEqual(new Set(betaUnclassified.items.map(item => item.status)), new Set(["awaiting", "current", "stale"]));
  assert.equal(betaUnclassified.summary.betaInterpretations.unclassified, 3);
  assert.equal(betaUnclassified.summary.betaStale, 1);

  const customerSearch = await (await request("/api/feedback?environment=customer&q=customer-search-needle")).json();
  assert.equal(customerSearch.total, 1);
  const unclear = await (await request("/api/feedback?environment=unclassified")).json();
  assert.equal(unclear.total, 1);

  for (let index = 0; index < 51; index += 1) {
    const messageId = `page-${String(index).padStart(2, "0")}`;
    const stored = await post(source(messageId, { category: "unsorted", receivedAt: `2026-10-02T13:${String(index).padStart(2, "0")}:00Z`, feedback: analysis(messageId, "unclassified", { environment: "customer" }) }));
    assert.equal(stored.response.status, 200);
  }
  const pageOne = await (await request("/api/feedback?environment=customer")).json();
  const pageTwo = await (await request("/api/feedback?environment=customer&offset=50")).json();
  assert.equal(pageOne.items.length, 50);
  assert.equal(pageOne.hasMore, true);
  assert.equal(pageTwo.items.length, 2);
  assert.equal(pageTwo.hasMore, false);
  assert.equal(pageOne.total, 52);

  assert.equal((await request("/api/feedback?environment=beta&environment=customer")).status, 400);
  assert.equal((await request("/api/feedback?unknown=1")).status, 400);

  console.log(JSON.stringify({
    verified: true, betaSpecificStates: 4, betaUnclassifiedStates: 3,
    customerItems: pageOne.total, unclassifiedAudienceItems: unclear.total,
    invalidEvidencePreservedSource: true, fullSourceBodyVerified: true,
    authRoleBoundariesVerified: true, paginationVerified: true,
  }));
} finally {
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise(resolveExit => server.once("exit", resolveExit)),
      new Promise(resolveWait => setTimeout(resolveWait, 5000)),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  rmSync(directory, { recursive: true, force: true });
}
