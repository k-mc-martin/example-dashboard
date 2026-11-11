import assert from "node:assert/strict";
import test from "node:test";
import { inboundProviderConnection } from "../lib/inbound-provider-connection.ts";

const at = "2026-09-30T18:00:00-07:00";
const valid = {
  cloudflare: { accountId: "00000000000000000000000000000001", pagesProjects: ["dupdash-public", "dupdash-beta"], r2Bucket: "dupdash-downloads" },
  lemonsqueezy: { storeId: "100001", domain: "store.example.invalid" },
  godaddy: { domain: "example.invalid" },
  azure: { subscriptionId: "00000000-0000-4000-8000-000000000001", resourceGroup: "demo-signing-rg", resourceType: "Microsoft.CodeSigning/codeSigningAccounts", accountName: "demo-signing" },
};

test("accepts only exact verified provider identities", () => {
  for (const [provider, identity] of Object.entries(valid)) {
    const parsed = inboundProviderConnection.parse({ provider, status: "verified", identity, checkedAt: at });
    assert.equal(parsed.checkedAt, "2026-10-01T01:00:00.000Z");
  }
});

test("rejects fabricated state, extra data, and altered identities", () => {
  assert.equal(inboundProviderConnection.safeParse({ provider: "godaddy", status: "pending", identity: valid.godaddy, checkedAt: at }).success, false);
  assert.equal(inboundProviderConnection.safeParse({ provider: "godaddy", status: "verified", identity: { ...valid.godaddy, renewalPrice: 1 }, checkedAt: at }).success, false);
  assert.equal(inboundProviderConnection.safeParse({ provider: "lemonsqueezy", status: "verified", identity: { ...valid.lemonsqueezy, storeId: "other" }, checkedAt: at }).success, false);
  assert.equal(inboundProviderConnection.safeParse({ provider: "unknown", status: "verified", identity: {}, checkedAt: at }).success, false);
});
