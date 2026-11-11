import assert from "node:assert/strict";
import test from "node:test";
import { parseProviderTelemetry } from "../lib/provider-telemetry.ts";
import { aggregateLemonSqueezy, aggregateLemonSqueezyResponses } from "../infra/n8n/workflows/providers/operational-lemonsqueezy.mjs";
import { projectGoDaddy, projectGoDaddyResponse } from "../infra/n8n/workflows/providers/operational-godaddy.mjs";
import { aggregateCloudflare, aggregateCloudflareResponses } from "../infra/n8n/workflows/providers/operational-cloudflare.mjs";
import { aggregateAzure, buildAzureScopes } from "../infra/n8n/workflows/providers/operational-azure.mjs";

test("GoDaddy projection retains only operational fields", () => {
  const value = projectGoDaddy({ domain: "example.invalid", status: "ACTIVE", expiresAt: "2027-01-01T00:00:00Z", autoRenew: true, nameServers: ["NS1.EXAMPLE.COM"], contactRegistrant: { email: "private@example.com" } }, "2026-09-30T20:00:00Z");
  assert.deepEqual(parseProviderTelemetry(value), value);
  assert.equal(JSON.stringify(value).includes("private@example.com"), false);
});

test("Lemon Squeezy projection aggregates money and drops customer PII", () => {
  const value = aggregateLemonSqueezy([{ data: [{
    type: "orders", id: "private-order-id", attributes: {
      store_id: 100001, user_name: "Private Customer", user_email: "private@example.com", status: "partial_refund",
      total_usd: 1200, refunded_amount_usd: 200, tax_usd: 100, discount_total_usd: 50, test_mode: false,
      created_at: "2026-09-30T18:00:00Z", first_order_item: { product_id: 10, variant_id: 11, product_name: "ExampleApp", variant_name: "Windows" },
    },
  }], meta: { page: { currentPage: 1, lastPage: 1 } } }], "2026-09-30T20:00:00Z");
  assert.deepEqual(parseProviderTelemetry(value), value);
  assert.equal(value.data.live.netCents, 1000);
  assert.equal(JSON.stringify(value).includes("private@example.com"), false);
  assert.equal(JSON.stringify(value).includes("private-order-id"), false);
});

test("validator rejects unknown fields and incomplete data marked ok", () => {
  const base = projectGoDaddy({ domain: "example.invalid", status: "ACTIVE", nameServers: [] }, "2026-09-30T20:00:00Z");
  assert.equal(parseProviderTelemetry({ ...base, unexpected: true }), null);
  const cloudflare = {
    surface: "cloudflare", observedAt: "2026-09-30T20:00:00Z", status: "ok",
    data: { accountId: "00000000000000000000000000000001", pages: [
      { projectName: "secdash-public", complete: false, deploymentsTruncated: false, deployments: [] },
      { projectName: "secdash-beta", complete: true, deploymentsTruncated: false, deployments: [] },
    ], r2: { bucketName: "secdash-downloads", complete: true, objectsTruncated: false, pageCount: 1, objectCount: 0, totalBytes: 0, byPrefix: [], byExtension: [], objects: [] } },
  };
  assert.equal(parseProviderTelemetry(cloudflare), null);
  assert.notEqual(parseProviderTelemetry({ ...cloudflare, status: "partial", errorCode: "incomplete_collection" }), null);
});

test("error status requires a safe error code", () => {
  const value = projectGoDaddy({ domain: "example.invalid", status: "ACTIVE", nameServers: [] }, "2026-09-30T20:00:00Z");
  assert.equal(parseProviderTelemetry({ ...value, status: "error" }), null);
  assert.notEqual(parseProviderTelemetry({ ...value, status: "error", errorCode: "provider_unavailable" }), null);
});

test("HTTP failures become sanitized error observations", () => {
  const godaddy = projectGoDaddyResponse({ statusCode: 403, body: { secret: "hidden" } }, "2026-09-30T20:00:00Z");
  assert.equal(godaddy.errorCode, "authorization_required");
  assert.notEqual(parseProviderTelemetry(godaddy), null);
  const lemon = aggregateLemonSqueezyResponses([{ json: { statusCode: 429, body: { customer: "hidden" } } }], "2026-09-30T20:00:00Z");
  assert.equal(lemon.errorCode, "rate_limited");
  assert.equal(JSON.stringify(lemon).includes("hidden"), false);
  const cloudflare = aggregateCloudflareResponses({
    "secdash-public:production": { statusCode: 500 }, "secdash-public:preview": { statusCode: 200, body: {} },
    "secdash-beta:production": { statusCode: 200, body: {} }, "secdash-beta:preview": { statusCode: 200, body: {} }, r2: [],
  }, "2026-09-30T20:00:00Z");
  assert.equal(cloudflare.errorCode, "provider_unavailable");
  assert.notEqual(parseProviderTelemetry(cloudflare), null);
});

test("pending Lemon Squeezy orders affect counts but not collected totals", () => {
  const value = aggregateLemonSqueezy([{ data: [{ type: "orders", attributes: { store_id: 100001, status: "pending", total_usd: 5000, refunded_amount_usd: 0, tax_usd: 0, discount_total_usd: 0, test_mode: false, created_at: "2026-09-30T18:00:00Z" } }], meta: { page: { currentPage: 1, lastPage: 1 } } }]);
  assert.equal(value.data.live.orderCount, 1);
  assert.equal(value.data.live.grossCents, 0);
  assert.equal(value.data.live.netCents, 0);
});

test("Cloudflare projection computes complete inventory without forwarding metadata", () => {
  const page = (project, environment) => ({ success: true, result: [{ id: `${project}-${environment}`, project_name: project, environment, url: `https://${project}.sites.example.invalid`, created_on: "2026-09-30T18:00:00Z", modified_on: "2026-09-30T18:01:00Z", latest_stage: { name: "deploy", status: "success" }, is_skipped: false, env_vars: { SECRET: "must-not-pass" } }], result_info: { total_pages: 1 } });
  const value = aggregateCloudflare({
    "secdash-public:production": page("secdash-public", "production"), "secdash-public:preview": page("secdash-public", "preview"),
    "secdash-beta:production": page("secdash-beta", "production"), "secdash-beta:preview": page("secdash-beta", "preview"),
    r2: [{ success: true, result: [{ key: "releases/ExampleApp.exe", size: 123, last_modified: "2026-09-30T18:00:00Z", storage_class: "Standard", custom_metadata: { secret: "no" } }], result_info: { is_truncated: false } }],
  }, "2026-09-30T20:00:00Z");
  assert.notEqual(parseProviderTelemetry(value), null);
  assert.equal(value.data.r2.totalBytes, 123);
  assert.equal(JSON.stringify(value).includes("must-not-pass"), false);
  assert.equal(JSON.stringify(value).includes('"secret":"no"'), false);
});

test("Cloudflare never presents an unavailable section as partial zero inventory", () => {
  const page = { statusCode: 200, body: { success: true, result: [], result_info: { total_pages: 1 } } };
  const value = aggregateCloudflareResponses({
    "secdash-public:production": page, "secdash-public:preview": page,
    "secdash-beta:production": page, "secdash-beta:preview": page,
    r2: [{ statusCode: 503, body: { secret: "must-not-pass" } }],
  }, "2026-09-30T20:00:00Z");
  assert.equal(value.status, "error");
  assert.equal(value.errorCode, "provider_unavailable");
  assert.equal(JSON.stringify(value).includes("must-not-pass"), false);
});

test("Cloudflare distinguishes complete collection from bounded drilldown views", () => {
  const deployments = Array.from({ length: 31 }, (_, index) => ({ id: `deployment-${index}`, project_name: "secdash-public", environment: "production", url: `https://deployment-${index}.sites.example.invalid`, created_on: "2026-09-30T18:00:00Z", latest_stage: { name: "deploy", status: "success" }, is_skipped: false }));
  const empty = { success: true, result: [], result_info: { total_pages: 1 } };
  const objects = Array.from({ length: 76 }, (_, index) => ({ key: `release-${index}.bin`, size: 1, last_modified: "2026-09-30T18:00:00Z", storage_class: "Standard" }));
  const value = aggregateCloudflare({
    "secdash-public:production": { success: true, result: deployments, result_info: { total_pages: 1 } }, "secdash-public:preview": empty,
    "secdash-beta:production": empty, "secdash-beta:preview": empty,
    r2: [{ success: true, result: objects, result_info: { is_truncated: false } }],
  }, "2026-09-30T20:00:00Z");
  assert.equal(value.status, "ok");
  assert.equal(value.data.pages[0].complete, true);
  assert.equal(value.data.pages[0].deploymentsTruncated, true);
  assert.equal(value.data.pages[0].deployments.length, 30);
  assert.equal(value.data.r2.complete, true);
  assert.equal(value.data.r2.objectsTruncated, true);
  assert.equal(value.data.r2.objectCount, 76);
  assert.equal(value.data.r2.objects.length, 75);
  assert.notEqual(parseProviderTelemetry(value), null);
});

test("Azure projection inventories profiles and applicable RBAC assignments", () => {
  const account = { id: "/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/demo-signing-rg/providers/Microsoft.CodeSigning/codeSigningAccounts/demo-signing", name: "demo-signing", location: "westus", properties: { provisioningState: "Succeeded" } };
  const profile = { id: `${account.id}/certificateProfiles/release`, name: "release", properties: { profileType: "PublicTrust", status: "Active" } };
  assert.equal(buildAzureScopes(account, { value: [profile] }).length, 2);
  const value = aggregateAzure(account, { value: [profile] }, [{ value: [{ id: "assignment", properties: { scope: profile.id, roleDefinitionId: `${account.id}/providers/Microsoft.Authorization/roleDefinitions/bed1f8e5-a359-432b-98bd-27e5c1d76a13`, principalId: "07be0fc2-4930-4abd-a809-2dfaa207444b", principalType: "ServicePrincipal" } }] }, { value: [] }], "2026-09-30T20:00:00Z");
  assert.notEqual(parseProviderTelemetry(value), null);
  assert.equal(value.data.roleAssignments.length, 1);
});
