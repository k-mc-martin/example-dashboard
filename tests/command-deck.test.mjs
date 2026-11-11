import assert from "node:assert/strict";
import test from "node:test";
import { COMMAND_DECK_STALE_MS, deriveCommandDeck } from "../lib/command-deck.ts";

const observedAt = "2026-10-01T18:00:00.000Z";
const receivedAt = "2026-10-01T18:00:01.000Z";
const emptySurface = () => ({ latest: null, latestSuccess: null, history: [] });
const slice = {
  orderCount: 2, grossCents: 3000, refundedCents: 500, netCents: 2500, taxCents: 200, discountCents: 100,
  byStatus: [{ status: "paid", count: 1 }, { status: "partial_refund", count: 1 }],
  byDay: [{ date: "2026-10-01", orderCount: 2, grossCents: 3000, refundedCents: 500, netCents: 2500 }],
  byProduct: [],
};
const lemon = (status = "ok") => ({
  surface: "lemonsqueezy", observedAt, receivedAt, status,
  ...(status === "partial" ? { errorCode: "incomplete_collection" } : {}),
  data: { storeId: "100001", currency: "USD", complete: status === "ok", pageCount: 1, live: slice, test: { ...slice, orderCount: 0, grossCents: 0, refundedCents: 0, netCents: 0, taxCents: 0, discountCents: 0, byStatus: [], byDay: [] } },
});
const aiUsage = {
  status: "ok", measuredAt: observedAt, trackingStartedAt: "2026-09-01T00:00:00.000Z", windowStartedAt: "2026-10-01T00:00:00.000Z",
  model: "gpt-5.6-luna", currency: "USD", monthKey: "2026-10",
  today: { calls: 1, inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.01 },
  month: { calls: 1, inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.01 },
  window: { calls: 1, inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.01 }, reservedMonthUsd: 0.02,
  limits: { perRunUsd: 1, perDayUsd: 2, perMonthUsd: 10 },
  daily: [{ date: "2026-10-01", calls: 1, inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.01 }], unresolvedCalls: 0,
};
const backupLibrary = id => ({
  id, name: id, setup: "initialized", eligibleForSync: true, phase: "idle", summary: "Ready.", destinations: [],
});
const recovery = (usage = aiUsage) => ({
  surface: "recovery", observedAt, receivedAt, status: "ok",
  data: {
    schemaVersion: 1, generatedAt: observedAt,
    backupFolder: { name: "Dupdash Backups", bytes: 4096, objects: 8, measuredAt: observedAt },
    restoreChecks: [
      { checkedAt: "2026-09-30T17:00:00.000Z", requestedSnapshot: "a".repeat(64), ok: false },
      { checkedAt: observedAt, requestedSnapshot: "b".repeat(64), ok: true },
    ],
    automation: {
      measuredAt: observedAt,
      workflows: [{ id: "active", name: "Active", active: true }, { id: "paused", name: "Paused", active: false }],
      executionHistoryAvailable: true,
      lastExecution: { workflowId: "active", status: "failed", startedAt: observedAt, finishedAt: receivedAt, durationMs: 1000 },
      failureCount24h: 1,
      ...(usage === undefined ? {} : { aiUsage: usage }),
    },
    backupCatalog: { generatedAt: observedAt, libraries: [backupLibrary("dashboard-n8n"), backupLibrary("example-app-source")] },
  },
});
function operations({ lemonObservation = lemon(), recoveryObservation = recovery(), latestAiUsage = null } = {}) {
  return {
    serverTime: receivedAt,
    surfaces: {
      recovery: { latest: recoveryObservation, latestSuccess: recoveryObservation?.status === "ok" ? recoveryObservation : null, history: [], latestAiUsage },
      cloudflare: emptySurface(), azure: emptySurface(), godaddy: emptySurface(),
      lemonsqueezy: { latest: lemonObservation, latestSuccess: lemonObservation?.status === "error" ? null : lemonObservation, history: [] },
    },
  };
}

test("aggregates exact live sales, automation, backup, and AI measurements", () => {
  const result = deriveCommandDeck(operations(), Date.parse(observedAt));
  assert.equal(result.sales.feed.state, "ok");
  assert.deepEqual(result.sales.live?.byDay, slice.byDay);
  assert.equal(result.sales.live?.netCents, 2500);
  assert.deepEqual([result.automation.monitored, result.automation.active, result.automation.inactive], [2, 1, 1]);
  assert.deepEqual(result.automation.attention, [
    { workflowId: "paused", reason: "inactive" },
    { workflowId: "active", reason: "latest-execution-failed" },
  ]);
  assert.equal(result.storage.backupFolder?.bytes, 4096);
  assert.equal(result.backups.latestRestore?.snapshotId, "b".repeat(64));
  assert.equal(result.backups.libraries?.length, 2);
  assert.equal(result.ai.source, "current");
  assert.equal(result.ai.usage?.month.estimatedCostUsd, 0.01);
});

test("preserves valid partial commerce data and marks its feed partial", () => {
  const result = deriveCommandDeck(operations({ lemonObservation: lemon("partial") }), Date.parse(observedAt));
  assert.equal(result.sales.feed.state, "partial");
  assert.equal(result.sales.live?.orderCount, 2);
  assert.equal(result.sales.feed.errorCode, "incomplete_collection");
});

test("uses the existing per-surface stale thresholds without replacing measurements with zeros", () => {
  const providerBoundary = deriveCommandDeck(operations(), Date.parse(observedAt) + COMMAND_DECK_STALE_MS.lemonsqueezy);
  assert.equal(providerBoundary.sales.feed.state, "ok");
  const stale = deriveCommandDeck(operations(), Date.parse(observedAt) + COMMAND_DECK_STALE_MS.lemonsqueezy + 1);
  assert.equal(stale.sales.feed.state, "stale");
  assert.equal(stale.sales.feed.lastKnown, true);
  assert.equal(stale.sales.live?.grossCents, 3000);
  assert.equal(stale.feeds.recovery.state, "stale");
});

test("keeps old valid data after a collection error and labels it last known", () => {
  const successful = lemon();
  const failed = { surface: "lemonsqueezy", observedAt: "2026-10-01T18:10:00.000Z", receivedAt: "2026-10-01T18:10:01.000Z", status: "error", errorCode: "provider_unavailable", data: successful.data };
  const value = operations({ lemonObservation: failed });
  value.surfaces.lemonsqueezy.latestSuccess = successful;
  const result = deriveCommandDeck(value, Date.parse(failed.observedAt));
  assert.equal(result.sales.feed.state, "error");
  assert.equal(result.sales.feed.lastKnown, true);
  assert.equal(result.sales.feed.observedAt, failed.observedAt);
  assert.equal(result.sales.feed.dataObservedAt, successful.observedAt);
  assert.equal(result.sales.live?.netCents, 2500);
});

test("falls back to persisted AI usage and does not invent missing mailbox or quota values", () => {
  const withoutCurrentUsage = recovery();
  delete withoutCurrentUsage.data.automation.aiUsage;
  const result = deriveCommandDeck(operations({ recoveryObservation: withoutCurrentUsage, latestAiUsage: aiUsage }), Date.parse(observedAt));
  assert.equal(result.ai.source, "fallback");
  assert.equal(result.ai.feed.state, "partial");
  assert.equal(result.ai.feed.lastKnown, true);
  assert.equal(result.ai.feed.dataObservedAt, aiUsage.measuredAt);
  assert.deepEqual(result.mail, { state: "unavailable", highPriorityCount: null });
  assert.equal(result.storage.googleQuota, null);
});

test("selects the newest valid AI measurement and labels persisted usage as last known", () => {
  const newerFallback = { ...structuredClone(aiUsage), measuredAt: "2026-10-01T18:05:00.000Z" };
  const currentUnavailable = { status: "unavailable", measuredAt: observedAt, errorCode: "usage_unavailable" };
  const result = deriveCommandDeck(operations({ recoveryObservation: recovery(currentUnavailable), latestAiUsage: newerFallback }), Date.parse(newerFallback.measuredAt));
  assert.equal(result.ai.source, "fallback");
  assert.equal(result.ai.usage?.measuredAt, newerFallback.measuredAt);
  assert.equal(result.ai.feed.state, "partial");
  assert.equal(result.ai.feed.dataObservedAt, newerFallback.measuredAt);
});

test("rejects malformed observations instead of presenting them as good or as zero", () => {
  const malformed = lemon();
  malformed.data.live.netCents = 999;
  const result = deriveCommandDeck(operations({ lemonObservation: malformed }), Date.parse(observedAt));
  assert.equal(result.sales.feed.state, "unavailable");
  assert.equal(result.sales.live, null);
  assert.equal(result.sales.currency, null);
});

test("null operations produce explicit unavailable states and nullable summaries", () => {
  const result = deriveCommandDeck(null, Date.parse(observedAt));
  assert.equal(result.feeds.recovery.state, "unavailable");
  assert.equal(result.sales.live, null);
  assert.equal(result.automation.monitored, null);
  assert.equal(result.backups.libraries, null);
  assert.equal(result.ai.usage, null);
});

test("malformed nested recovery values become unavailable without throwing", () => {
  const mutations = [
    value => { value.data.restoreChecks = [null]; },
    value => { value.data.automation.workflows = [null]; },
    value => { value.data.backupCatalog.libraries = null; },
    value => { value.data.automation.lastExecution = { workflowId: "active", status: "failed" }; },
  ];
  for (const mutate of mutations) {
    const malformed = recovery();
    mutate(malformed);
    const result = deriveCommandDeck(operations({ recoveryObservation: malformed }), Date.parse(observedAt));
    assert.equal(result.feeds.recovery.state, "unavailable");
    assert.equal(result.automation.monitored, null);
    assert.equal(result.backups.libraries, null);
  }
});
