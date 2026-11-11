import assert from "node:assert/strict";
import test from "node:test";
import { authorized } from "../lib/server-auth.ts";

const operatorToken = "operator-token-with-at-least-thirty-two-characters";
const ingestToken = "ingest-token-with-at-least-thirty-two-characters";

function configureTokens(operator = operatorToken, ingest = ingestToken) {
  process.env.DUPDASH_OPERATOR_TOKEN = operator;
  process.env.DUPDASH_INGEST_TOKEN = ingest;
}

function request({
  token = operatorToken,
  host = "127.0.0.1:5286",
  method = "GET",
  origin,
  site,
} = {}) {
  const headers = new Headers({ host, authorization: `Bearer ${token}` });
  if (origin !== undefined) headers.set("origin", origin);
  if (site !== undefined) headers.set("sec-fetch-site", site);
  return new Request(`http://${host}/api/dashboard`, { method, headers });
}

test.beforeEach(() => configureTokens());
test.after(() => {
  delete process.env.DUPDASH_OPERATOR_TOKEN;
  delete process.env.DUPDASH_INGEST_TOKEN;
});

test("keeps operator and ingest credentials in separate roles", () => {
  assert.equal(authorized(request(), "operator"), true);
  assert.equal(authorized(request({ method: "POST", origin: "http://127.0.0.1:5286", site: "same-origin" }), "operator"), true);
  assert.equal(authorized(request({ token: ingestToken }), "operator"), false);
  assert.equal(authorized(request({ token: operatorToken, method: "POST" }), "ingest"), false);
  assert.equal(authorized(request({ token: ingestToken, method: "POST" }), "ingest"), true);
});

test("rejects missing or equal configured credentials", () => {
  delete process.env.DUPDASH_OPERATOR_TOKEN;
  assert.equal(authorized(request(), "operator"), false);
  configureTokens(operatorToken, operatorToken);
  assert.equal(authorized(request(), "operator"), false);
  assert.equal(authorized(request({ token: operatorToken, method: "POST" }), "ingest"), false);
});

test("rejects hostile host, origin, and fetch-site headers", () => {
  assert.equal(authorized(request({ host: "attacker.example" }), "operator"), false);
  assert.equal(authorized(request({ origin: "https://attacker.example" }), "operator"), false);
  assert.equal(authorized(request({ site: "cross-site" }), "operator"), false);
  assert.equal(authorized(request({ origin: "http://127.0.0.1:5286", site: "same-origin" }), "operator"), true);
});

test("allows the internal machine route only for originless ingest POSTs", () => {
  const machine = { host: "dashboard:3000", token: ingestToken, method: "POST" };
  assert.equal(authorized(request(machine), "ingest"), true);
  assert.equal(authorized(request({ ...machine, method: "GET" }), "ingest"), false);
  assert.equal(authorized(request({ ...machine, origin: "http://dashboard:3000" }), "ingest"), false);
  assert.equal(authorized(request({ ...machine, site: "same-origin" }), "ingest"), false);
  assert.equal(authorized(request({ ...machine, token: operatorToken }), "ingest"), false);
});
