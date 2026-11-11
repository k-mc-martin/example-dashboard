"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseBackupCatalogResponse, type BackupCatalogResponse, type BackupLibrary } from "./backup-catalog";
import { deriveDriveStorageMetrics, type DriveStorageResponse, type DriveStorageSample } from "./drive-storage";
import { operationSurfaces, type OperationsResponse, type OperationSurface } from "./operations";
import { channels, type Message, type ProviderConnections } from "./dashboard";
import { parseAttentionDismissals, type AttentionDismissal } from "./attention";

import { parseFeedbackSummary, type FeedbackObstructionAttention, type FeedbackSummary } from "./feedback";

const REFRESH_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;

type MailFeed = {
  feedback?: FeedbackSummary;
  attentionFeedbackObstructions: FeedbackObstructionAttention[];
  messages: Message[];
  lastSync: string | null;
  hasMore: boolean;
  counts: Record<string, number>;
  providerConnections: ProviderConnections;
};

type FeedErrors = { operations: string; drive: string; catalog: string; mail: string; attention: string };
const EMPTY_ERRORS: FeedErrors = { operations: "", drive: "", catalog: "", mail: "", attention: "" };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function timestamp(value: unknown, nullable = false): value is string | null {
  return nullable && value === null || typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validObservation(value: unknown, surface: OperationSurface): boolean {
  const item = record(value);
  return !!item && item.surface === surface && timestamp(item.observedAt) && timestamp(item.receivedAt)
    && ["ok", "partial", "error"].includes(String(item.status))
    && (item.errorCode === undefined || typeof item.errorCode === "string");
}

function validOperations(value: unknown): value is OperationsResponse {
  const root = record(value), surfaces = record(root?.surfaces);
  if (!root || !surfaces || !timestamp(root.serverTime)) return false;
  return operationSurfaces.every(surface => {
    const lane = record(surfaces[surface]);
    if (!lane || !Array.isArray(lane.history)) return false;
    return (lane.latest === null || validObservation(lane.latest, surface))
      && (lane.latestSuccess === null || validObservation(lane.latestSuccess, surface))
      && lane.history.every(item => validObservation(item, surface));
  });
}

const driveErrors = new Set(["authorization_required", "provider_unavailable", "invalid_response"]);
function validDriveSample(value: unknown): value is DriveStorageSample {
  const sample = record(value);
  if (!sample || sample.provider !== "google-drive" || !timestamp(sample.observedAt) || !timestamp(sample.receivedAt)) return false;
  if (sample.status === "error") return typeof sample.errorCode === "string" && driveErrors.has(sample.errorCode);
  const quota = record(sample.quota);
  if (sample.status !== "ok" || !quota || !(quota.limitBytes === null || typeof quota.limitBytes === "string")
    || typeof quota.usedBytes !== "string" || typeof quota.driveBytes !== "string" || typeof quota.trashBytes !== "string") return false;
  return deriveDriveStorageMetrics(sample as DriveStorageSample) !== null;
}

function validDrive(value: unknown): value is DriveStorageResponse {
  const root = record(value);
  return !!root && timestamp(root.serverTime) && Array.isArray(root.history) && root.history.every(validDriveSample)
    && (root.latest === null || validDriveSample(root.latest))
    && (root.latestSuccess === null || validDriveSample(root.latestSuccess) && root.latestSuccess.status === "ok");
}

const categoryIds = new Set<string>(channels.map(channel => channel.id));
function validMessage(value: unknown): value is Message {
  const item = record(value);
  return !!item && typeof item.id === "string" && typeof item.sender === "string" && typeof item.subject === "string"
    && typeof item.body === "string" && timestamp(item.receivedAt) && typeof item.category === "string" && categoryIds.has(item.category)
    && (item.supportKind === null || typeof item.supportKind === "string") && (item.sourceUrl === null || typeof item.sourceUrl === "string");
}

function validMail(value: unknown): value is MailFeed {
  const root = record(value), counts = record(root?.counts), connections = record(root?.providerConnections);
  if (!root || !counts || !connections || !Array.isArray(root.messages) || !root.messages.every(validMessage)
    || !Array.isArray(root.attentionFeedbackObstructions) || !root.attentionFeedbackObstructions.every(raw => {
      const item = record(raw);
      return !!item && typeof item.messageId === "string" && /^[a-f0-9]{64}$/.test(item.messageId)
        && typeof item.subject === "string" && timestamp(item.receivedAt) && typeof item.context === "string"
        && typeof item.sourceFingerprint === "string" && /^[a-f0-9]{64}$/.test(item.sourceFingerprint)
        && timestamp(item.analyzedAt);
    })
    || !timestamp(root.lastSync, true) || typeof root.hasMore !== "boolean") return false;
  if (!Object.keys(counts).every(key => categoryIds.has(key)) || !Object.values(counts).every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) return false;
  try { if (root.feedback !== undefined) parseFeedbackSummary(root.feedback); } catch { return false; }
  return Object.entries(connections).every(([provider, raw]) => {
    const item = record(raw);
    return ["cloudflare", "lemonsqueezy", "godaddy", "azure"].includes(provider) && !!item
      && item.provider === provider && item.status === "verified" && record(item.identity) !== null && timestamp(item.checkedAt);
  });
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return response.json();
}

function errorText(reason: unknown, fallback: string): string {
  if (reason instanceof DOMException && reason.name === "AbortError") return "Request timed out.";
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function markCatalogUnavailable(local: BackupCatalogResponse, operations: OperationsResponse, detail: string): BackupCatalogResponse {
  const latest = operations.surfaces.recovery.latest;
  return parseBackupCatalogResponse({
    ...local,
    serverTime: operations.serverTime,
    source: {
      kind: "n8n-recovery-feed",
      observedAt: latest?.observedAt ?? null,
      receivedAt: latest?.receivedAt ?? null,
      status: latest?.status === "error" ? "error" : "unavailable",
      detail,
    },
  }) ?? local;
}

function mergeCatalog(local: BackupCatalogResponse, operations: OperationsResponse): { catalog: BackupCatalogResponse; error: string } {
  const recovery = operations.surfaces.recovery;
  const success = recovery.latestSuccess;
  const latest = recovery.latest;
  const data = record(success?.data), telemetry = record(data?.backupCatalog);
  if (!success || !timestamp(success.observedAt) || !timestamp(success.receivedAt) || !telemetry
    || typeof telemetry.generatedAt !== "string" || !timestamp(telemetry.generatedAt) || !Array.isArray(telemetry.libraries)) {
    const detail = latest?.status === "error"
      ? `Latest recovery collection failed${latest.errorCode ? `: ${latest.errorCode}` : ""}. Local backup progress is preserved.`
      : "n8n recovery feed has not delivered a valid backup catalog. Local backup progress is preserved.";
    return { catalog: markCatalogUnavailable(local, operations, detail), error: detail };
  }
  const generatedAt = telemetry.generatedAt;

  const confirmed = telemetry.libraries as BackupLibrary[];
  const cold = local.libraries.find(library => library.id === "cold-storage");
  const merged = local.libraries.filter(library => library.id !== "cold-storage").map(library => {
    const facts = confirmed.find(item => record(item)?.id === library.id);
    if (!facts || !Array.isArray(facts.destinations)) return library;
    return {
      ...library,
      sourceLogicalBytes: facts.sourceLogicalBytes,
      destinations: library.destinations.map(destination => {
        const confirmedDestination = facts.destinations.find(item => record(item)?.id === destination.id);
        return confirmedDestination ? {
          ...destination,
          lastSnapshot: confirmedDestination.lastSnapshot,
          lastVerification: confirmedDestination.lastVerification,
          history: confirmedDestination.history,
          repositoryBytes: confirmedDestination.repositoryBytes,
          repositoryBytesStatus: confirmedDestination.repositoryBytesStatus,
          repositoryBytesMeasuredAt: confirmedDestination.repositoryBytesMeasuredAt,
        } : destination;
      }),
    };
  });
  const now = Date.parse(operations.serverTime);
  const stale = now - Date.parse(success.observedAt) > 15 * 60_000 || now - Date.parse(generatedAt) > 15 * 60_000;
  const failed = latest?.status === "error";
  const status = failed ? "error" : stale ? "stale" : "current";
  const detail = failed
    ? `Latest recovery collection failed${latest.errorCode ? `: ${latest.errorCode}` : ""}. Last confirmed backup history is preserved.`
    : stale ? "Backup history receipt is stale; live controller progress remains separate."
      : "Backup history confirmed through the n8n recovery feed.";
  const candidate = parseBackupCatalogResponse({
    ...local,
    serverTime: operations.serverTime,
    source: { kind: "n8n-recovery-feed", observedAt: generatedAt, receivedAt: success.receivedAt, status, detail },
    libraries: [...merged, ...(cold ? [cold] : [])],
  });
  if (candidate) return { catalog: candidate, error: "" };
  const invalidDetail = "n8n recovery feed delivered an invalid backup catalog. Local backup progress is preserved.";
  return { catalog: markCatalogUnavailable(local, operations, invalidDetail), error: invalidDetail };
}

export function useCommandDeckFeed(active: boolean, revision = 0) {
  const [operations, setOperations] = useState<OperationsResponse | null>(null);
  const [drive, setDrive] = useState<DriveStorageResponse | null>(null);
  const [catalog, setCatalog] = useState<BackupCatalogResponse | null>(null);
  const [mail, setMail] = useState<MailFeed | null>(null);
  const [attentionDismissals, setAttentionDismissals] = useState<AttentionDismissal[]>([]);
  const [errors, setErrors] = useState<FeedErrors>(EMPTY_ERRORS);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const dismissalMutation = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const requestGeneration = generation.current;
    const requestDismissalMutation = dismissalMutation.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setRefreshing(true);
    const timeout = window.setTimeout(() => nextController.abort(), REQUEST_TIMEOUT_MS);
    const request = (async () => {
      const [operationsResult, driveResult, catalogResult, mailResult, attentionResult] = await Promise.allSettled([
        readJson("/api/operations", nextController.signal),
        readJson("/api/drive-storage", nextController.signal),
        readJson("/api/backup-catalog", nextController.signal),
        readJson("/api/dashboard", nextController.signal),
        readJson("/api/attention-dismissals", nextController.signal),
      ]);
      if (!mounted.current || requestGeneration !== generation.current || controller.current !== nextController) return;

      let nextOperations: OperationsResponse | null = null;
      const nextErrors: FeedErrors = { ...EMPTY_ERRORS };
      if (operationsResult.status === "fulfilled" && validOperations(operationsResult.value)) {
        nextOperations = operationsResult.value;
        setOperations(nextOperations);
      } else nextErrors.operations = operationsResult.status === "rejected"
        ? errorText(operationsResult.reason, "Operations are unavailable.") : "Operations returned an invalid response.";

      if (driveResult.status === "fulfilled" && validDrive(driveResult.value)) setDrive(driveResult.value);
      else nextErrors.drive = driveResult.status === "rejected"
        ? errorText(driveResult.reason, "Drive storage is unavailable.") : "Drive storage returned an invalid response.";

      if (catalogResult.status === "fulfilled") {
        const parsed = parseBackupCatalogResponse(catalogResult.value);
        if (parsed) {
          if (nextOperations) {
            const merged = mergeCatalog(parsed, nextOperations);
            setCatalog(merged.catalog);
            nextErrors.catalog = merged.error;
          } else {
            setCatalog(parsed);
            nextErrors.catalog = "n8n recovery feed is unavailable. Local backup progress is preserved.";
          }
        } else nextErrors.catalog = "Backup catalog returned an invalid response.";
      } else nextErrors.catalog = errorText(catalogResult.reason, "Backup catalog is unavailable.");

      if (mailResult.status === "fulfilled" && validMail(mailResult.value)) setMail(mailResult.value);
      else nextErrors.mail = mailResult.status === "rejected"
        ? errorText(mailResult.reason, "Mail is unavailable.") : "Mail returned an invalid response.";

      if (attentionResult.status === "fulfilled") {
        try {
          const parsed = parseAttentionDismissals(attentionResult.value);
          if (requestDismissalMutation === dismissalMutation.current) setAttentionDismissals(parsed);
        } catch {
          nextErrors.attention = "Attention dismissals returned an invalid response.";
        }
      } else nextErrors.attention = errorText(attentionResult.reason, "Attention dismissals are unavailable.");

      setErrors(nextErrors);
      setRefreshedAt(new Date().toISOString());
    })().finally(() => {
      window.clearTimeout(timeout);
      if (controller.current === nextController) controller.current = null;
      if (inFlight.current === request) inFlight.current = null;
      if (mounted.current && requestGeneration === generation.current) setRefreshing(false);
    });
    inFlight.current = request;
    return request;
  }, []);

  const dismissAttention = useCallback(async (identity: string, conditionRevision: string): Promise<boolean> => {
    const body = JSON.stringify({ identity, conditionRevision });
    try {
      const response = await fetch("/api/attention-dismissals", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!response.ok) throw new Error(`Dismissal returned ${response.status}.`);
      const root = record(await response.json());
      const dismissal = root?.dismissal;
      const parsed = parseAttentionDismissals({ dismissals: [dismissal] })[0];
      dismissalMutation.current += 1;
      setAttentionDismissals(current => [parsed, ...current.filter(item => item.identity !== parsed.identity)]);
      setErrors(current => ({ ...current, attention: "" }));
      return true;
    } catch (reason) {
      setErrors(current => ({ ...current, attention: errorText(reason, "Could not save the dismissal.") }));
      return false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!active) return;
    const visible = () => document.visibilityState === "visible";
    if (visible()) void refresh();
    const timer = window.setInterval(() => { if (visible()) void refresh(); }, REFRESH_MS);
    const onVisibility = () => { if (visible()) void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      generation.current += 1;
      controller.current?.abort();
      controller.current = null;
      inFlight.current = null;
      setRefreshing(false);
    };
  }, [active, refresh, revision]);

  useEffect(() => () => {
    mounted.current = false;
    generation.current += 1;
    controller.current?.abort();
  }, []);

  return { operations, drive, catalog, mail, attentionDismissals, errors, refreshedAt, refreshing, refresh, dismissAttention };
}
