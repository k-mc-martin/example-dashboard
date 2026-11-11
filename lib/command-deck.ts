import { parseAiUsage, type AiUsageOk } from "./ai-usage.ts";
import type { OperationsResponse, OperationSurface } from "./operations.ts";
import { parseProviderTelemetry, type LemonSqueezyTelemetryData } from "./provider-telemetry.ts";

export const COMMAND_DECK_STALE_MS = {
  recovery: 15 * 60_000,
  cloudflare: 45 * 60_000,
  azure: 45 * 60_000,
  godaddy: 45 * 60_000,
  lemonsqueezy: 45 * 60_000,
} as const satisfies Record<OperationSurface, number>;

export type CommandDeckFeedState = "ok" | "partial" | "error" | "stale" | "unavailable";
export type CommandDeckFeed = {
  state: CommandDeckFeedState;
  observedAt: string | null;
  dataObservedAt: string | null;
  receivedAt: string | null;
  errorCode: string | null;
  lastKnown: boolean;
};

export type CommandDeckWorkflowAttention = {
  workflowId: string;
  reason: "inactive" | "latest-execution-failed";
};

export type CommandDeckBackupLibrary = {
  id: "dashboard-n8n" | "example-app-source";
  name: string;
  setup: "initialized" | "not-initialized" | "unavailable";
  eligibleForSync: boolean;
  phase: "idle" | "preparing" | "snapshotting" | "uploading" | "verifying" | "complete" | "failed" | "unavailable";
  summary: string;
  destinations: Array<{
    id: string;
    label: string;
    kind: "google-drive" | "external-drive";
    status: "current" | "stale" | "error" | "unavailable" | "not-initialized";
    lastSnapshot: { snapshotId: string; createdAt: string; sizeBytes: number | null } | null;
    lastVerification: { status: "passed" | "failed"; verifiedAt: string; snapshotId: string | null } | null;
  }>;
  sourceLogicalBytes?: number | null;
};

type AutomationLastExecution = {
  workflowId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};

export type CommandDeckModel = {
  generatedAt: string;
  feeds: Record<OperationSurface, CommandDeckFeed>;
  sales: {
    feed: CommandDeckFeed;
    currency: "USD" | null;
    live: Pick<LemonSqueezyTelemetryData["live"], "orderCount" | "grossCents" | "refundedCents" | "netCents" | "taxCents" | "discountCents" | "byDay"> | null;
  };
  automation: {
    feed: CommandDeckFeed;
    monitored: number | null;
    active: number | null;
    inactive: number | null;
    attention: CommandDeckWorkflowAttention[];
    executionHistoryAvailable: boolean | null;
    failureCount24h: number | null;
    lastExecution: AutomationLastExecution | null;
  };
  storage: {
    feed: CommandDeckFeed;
    googleQuota: null;
    backupFolder: { name: "Dupdash Backups"; bytes: number; objects: number; measuredAt: string } | null;
  };
  backups: {
    feed: CommandDeckFeed;
    generatedAt: string | null;
    libraries: CommandDeckBackupLibrary[] | null;
    latestRestore: { checkedAt: string; snapshotId: string; ok: boolean } | null;
  };
  ai: { feed: CommandDeckFeed; usage: AiUsageOk | null; source: "current" | "fallback" | null };
  mail: { state: "unavailable"; highPriorityCount: null };
};

type RecoveryData = {
  schemaVersion: 1;
  generatedAt: string;
  backupFolder: CommandDeckModel["storage"]["backupFolder"];
  restoreChecks: Array<{ checkedAt: string; requestedSnapshot: string; ok: boolean }>;
  automation?: {
    measuredAt: string;
    workflows: Array<{ id: string; name: string; active: boolean }>;
    executionHistoryAvailable: boolean;
    lastExecution: AutomationLastExecution | null;
    failureCount24h: number | null;
    aiUsage?: unknown;
  };
  backupCatalog?: { generatedAt: string; libraries: CommandDeckBackupLibrary[] };
};

function unavailableFeed(): CommandDeckFeed {
  return { state: "unavailable", observedAt: null, dataObservedAt: null, receivedAt: null, errorCode: null, lastKnown: false };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validObservation(value: unknown, surface: OperationSurface, allowError: boolean): value is OperationsResponse["surfaces"][OperationSurface]["latest"] & {} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as { surface?: unknown; observedAt?: unknown; receivedAt?: unknown; status?: unknown; errorCode?: unknown; data?: unknown };
  if (item.surface !== surface || typeof item.observedAt !== "string" || !Number.isFinite(Date.parse(item.observedAt))
    || typeof item.receivedAt !== "string" || !Number.isFinite(Date.parse(item.receivedAt))
    || !["ok", "partial", "error"].includes(String(item.status)) || (!allowError && item.status === "error")) return false;
  if (surface !== "recovery") {
    const providerValue = { ...item };
    delete providerValue.receivedAt;
    return parseProviderTelemetry(providerValue)?.surface === surface;
  }
  if (item.status === "error") return typeof item.errorCode === "string";
  return validRecoveryData(item.data);
}

function validRecoveryData(value: unknown): value is RecoveryData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<RecoveryData>;
  const folder = object(item.backupFolder);
  if (item.schemaVersion !== 1 || typeof item.generatedAt !== "string" || !Number.isFinite(Date.parse(item.generatedAt)) || !folder
    || folder.name !== "Dupdash Backups" || !Number.isSafeInteger(folder.bytes) || (folder.bytes as number) < 0
    || !Number.isSafeInteger(folder.objects) || (folder.objects as number) < 0 || typeof folder.measuredAt !== "string" || !Number.isFinite(Date.parse(folder.measuredAt))
    || !Array.isArray(item.restoreChecks)
    || !item.restoreChecks.every(raw => {
      const check = object(raw);
      return !!check && typeof check.checkedAt === "string" && Number.isFinite(Date.parse(check.checkedAt))
        && typeof check.requestedSnapshot === "string" && typeof check.ok === "boolean";
    })) return false;
  if (item.automation) {
    const automation = object(item.automation);
    if (!automation || typeof automation.measuredAt !== "string" || !Number.isFinite(Date.parse(automation.measuredAt)) || !Array.isArray(automation.workflows)
      || !automation.workflows.every(raw => {
        const workflow = object(raw);
        return !!workflow && typeof workflow.id === "string" && typeof workflow.name === "string" && typeof workflow.active === "boolean";
      }) || typeof automation.executionHistoryAvailable !== "boolean"
      || !(automation.failureCount24h === null || Number.isSafeInteger(automation.failureCount24h) && (automation.failureCount24h as number) >= 0)) return false;
    if (automation.lastExecution !== null) {
      const execution = object(automation.lastExecution);
      if (!execution || typeof execution.workflowId !== "string" || typeof execution.status !== "string"
        || typeof execution.startedAt !== "string" || !Number.isFinite(Date.parse(execution.startedAt))
        || !(execution.finishedAt === null || typeof execution.finishedAt === "string" && Number.isFinite(Date.parse(execution.finishedAt)))
        || !(execution.durationMs === null || Number.isSafeInteger(execution.durationMs) && (execution.durationMs as number) >= 0)) return false;
    }
  }
  if (item.backupCatalog) {
    const catalog = object(item.backupCatalog);
    if (!catalog || typeof catalog.generatedAt !== "string" || !Number.isFinite(Date.parse(catalog.generatedAt)) || !Array.isArray(catalog.libraries)
      || catalog.libraries.length !== 2 || !catalog.libraries.every(raw => {
        const library = object(raw);
        return !!library && ["dashboard-n8n", "example-app-source"].includes(String(library.id))
          && typeof library.name === "string" && typeof library.summary === "string" && Array.isArray(library.destinations);
      }) || new Set(catalog.libraries.map(raw => object(raw)?.id)).size !== 2) return false;
  }
  return true;
}

function deriveFeed(operations: OperationsResponse | null, surface: OperationSurface, nowMs: number): CommandDeckFeed {
  const record = operations?.surfaces[surface];
  if (!record) return unavailableFeed();
  const latest = validObservation(record.latest, surface, true) ? record.latest : null;
  const success = validObservation(record.latestSuccess, surface, false) ? record.latestSuccess : null;
  if (latest?.status === "error") {
    return {
      state: "error",
      observedAt: latest.observedAt,
      dataObservedAt: success?.observedAt ?? null,
      receivedAt: latest.receivedAt,
      errorCode: latest.errorCode ?? null,
      lastKnown: success !== null,
    };
  }
  const observation = success ?? latest;
  if (!observation) return unavailableFeed();
  const observedMs = Date.parse(observation.observedAt);
  const stale = !Number.isFinite(observedMs) || nowMs - observedMs > COMMAND_DECK_STALE_MS[surface];
  return {
    state: stale ? "stale" : observation.status === "partial" ? "partial" : "ok",
    observedAt: observation.observedAt,
    dataObservedAt: observation.observedAt,
    receivedAt: observation.receivedAt,
    errorCode: observation.errorCode ?? null,
    lastKnown: stale,
  };
}

function recoveryData(operations: OperationsResponse | null): RecoveryData | null {
  const observation = operations?.surfaces.recovery.latestSuccess;
  return validObservation(observation, "recovery", false) && observation.status === "ok"
    ? observation.data as RecoveryData
    : null;
}

function isFailedExecution(status: string): boolean {
  return ["error", "failed", "failure", "crashed"].includes(status.toLowerCase());
}

export function deriveCommandDeck(operations: OperationsResponse | null, nowMs: number): CommandDeckModel {
  const feeds = {
    recovery: deriveFeed(operations, "recovery", nowMs),
    cloudflare: deriveFeed(operations, "cloudflare", nowMs),
    azure: deriveFeed(operations, "azure", nowMs),
    godaddy: deriveFeed(operations, "godaddy", nowMs),
    lemonsqueezy: deriveFeed(operations, "lemonsqueezy", nowMs),
  } satisfies Record<OperationSurface, CommandDeckFeed>;

  const lemonObservation = operations?.surfaces.lemonsqueezy.latestSuccess;
  const lemon = validObservation(lemonObservation, "lemonsqueezy", false)
    ? lemonObservation.data as LemonSqueezyTelemetryData
    : null;
  const recovery = recoveryData(operations);
  const automation = recovery?.automation ?? null;
  const attention: CommandDeckWorkflowAttention[] = automation
    ? automation.workflows.filter(workflow => !workflow.active).map(workflow => ({ workflowId: workflow.id, reason: "inactive" as const }))
    : [];
  if (automation?.lastExecution && isFailedExecution(automation.lastExecution.status)) {
    attention.push({ workflowId: automation.lastExecution.workflowId, reason: "latest-execution-failed" });
  }
  const currentUsage = parseAiUsage(automation?.aiUsage);
  const parsedFallback = parseAiUsage(operations?.surfaces.recovery.latestAiUsage);
  const fallbackUsage = parsedFallback?.status === "ok" ? parsedFallback : null;
  const candidates = [
    currentUsage?.status === "ok" ? { usage: currentUsage, source: "current" as const } : null,
    fallbackUsage ? { usage: fallbackUsage, source: "fallback" as const } : null,
  ].filter((value): value is { usage: AiUsageOk; source: "current" | "fallback" } => value !== null)
    .sort((left, right) => Date.parse(right.usage.measuredAt) - Date.parse(left.usage.measuredAt));
  const selectedUsage = candidates[0] ?? null;
  const usage = selectedUsage?.usage ?? null;
  const usageSource = selectedUsage?.source ?? null;
  const aiFeed: CommandDeckFeed = usage
    ? feeds.recovery.state === "error"
      ? { ...feeds.recovery, dataObservedAt: usage.measuredAt, lastKnown: true }
      : nowMs - Date.parse(usage.measuredAt) > COMMAND_DECK_STALE_MS.recovery
        ? { state: "stale", observedAt: feeds.recovery.observedAt, dataObservedAt: usage.measuredAt, receivedAt: feeds.recovery.receivedAt, errorCode: null, lastKnown: true }
        : usageSource === "fallback"
          ? { ...feeds.recovery, state: "partial", dataObservedAt: usage.measuredAt, lastKnown: true }
          : { ...feeds.recovery, dataObservedAt: usage.measuredAt, lastKnown: false }
    : feeds.recovery.state === "ok" || feeds.recovery.state === "partial"
      ? unavailableFeed()
      : feeds.recovery;
  const restores = recovery?.restoreChecks ?? [];
  const latestRestore = restores.length
    ? [...restores].sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt))[0]
    : null;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    feeds,
    sales: {
      feed: feeds.lemonsqueezy,
      currency: lemon?.currency ?? null,
      live: lemon ? {
        orderCount: lemon.live.orderCount,
        grossCents: lemon.live.grossCents,
        refundedCents: lemon.live.refundedCents,
        netCents: lemon.live.netCents,
        taxCents: lemon.live.taxCents,
        discountCents: lemon.live.discountCents,
        byDay: lemon.live.byDay,
      } : null,
    },
    automation: {
      feed: feeds.recovery,
      monitored: automation?.workflows.length ?? null,
      active: automation ? automation.workflows.filter(workflow => workflow.active).length : null,
      inactive: automation ? automation.workflows.filter(workflow => !workflow.active).length : null,
      attention,
      executionHistoryAvailable: automation?.executionHistoryAvailable ?? null,
      failureCount24h: automation?.failureCount24h ?? null,
      lastExecution: automation?.lastExecution ?? null,
    },
    storage: { feed: feeds.recovery, googleQuota: null, backupFolder: recovery?.backupFolder ?? null },
    backups: {
      feed: feeds.recovery,
      generatedAt: recovery?.backupCatalog?.generatedAt ?? null,
      libraries: recovery?.backupCatalog?.libraries ?? null,
      latestRestore: latestRestore ? { checkedAt: latestRestore.checkedAt, snapshotId: latestRestore.requestedSnapshot, ok: latestRestore.ok } : null,
    },
    ai: { feed: aiFeed, usage: usage ?? null, source: usageSource },
    mail: { state: "unavailable", highPriorityCount: null },
  };
}
