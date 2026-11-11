"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { feedbackEnvironments, feedbackInterpretations, parseFeedbackSummary, type FeedbackAnalysis, type FeedbackEnvironment, type FeedbackInterpretation, type FeedbackItem, type FeedbackResponse } from "./feedback";

const REFRESH_MS = 5_000;

type Query = {
  environment: Extract<FeedbackEnvironment, "beta" | "customer" | "unclassified">;
  interpretation?: FeedbackInterpretation;
  q: string;
  messageId?: string;
  offset: number;
};

function isFeedbackResponse(value: unknown): value is FeedbackResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  try { parseFeedbackSummary(root.summary); } catch { return false; }
  return isTimestamp(root.fetchedAt) && nonNegativeInteger(root.total) && nonNegativeInteger(root.offset)
    && typeof root.hasMore === "boolean" && Array.isArray(root.items) && root.items.length <= 50 && root.items.every(isFeedbackItem);
}

function isTimestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function nonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function nullableString(value: unknown): value is string | null { return value === null || typeof value === "string"; }
function isFeedbackAnalysis(value: unknown): value is FeedbackAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const analysis = value as Record<string, unknown>;
  return feedbackEnvironments.includes(analysis.environment as FeedbackEnvironment)
    && feedbackInterpretations.includes(analysis.interpretation as FeedbackInterpretation)
    && Array.isArray(analysis.evidenceQuotes) && analysis.evidenceQuotes.length <= 3 && analysis.evidenceQuotes.every(quote => typeof quote === "string")
    && typeof analysis.rationale === "string" && typeof analysis.context === "string"
    && nullableString(analysis.intendedExperienceReference) && typeof analysis.sourceFingerprint === "string"
    && isTimestamp(analysis.analyzedAt) && typeof analysis.stale === "boolean";
}
function isFeedbackItem(value: unknown): value is FeedbackItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>, message = item.message as Record<string, unknown> | undefined;
  return !!message && typeof message.id === "string" && typeof message.sender === "string" && typeof message.subject === "string"
    && typeof message.bodyPreview === "string" && isTimestamp(message.receivedAt) && typeof message.category === "string"
    && nullableString(message.supportKind) && nullableString(message.sourceUrl)
    && (item.analysis === null || isFeedbackAnalysis(item.analysis))
    && ["awaiting", "current", "stale"].includes(item.status as string);
}

function matchesQuery(response: FeedbackResponse, environment: Query["environment"], offset: number, messageId?: string): boolean {
  if (response.offset !== offset || response.hasMore !== (response.offset + response.items.length < response.total)) return false;
  return response.items.every(item => {
    if (messageId && item.message.id !== messageId) return false;
    if (environment === "customer") return item.analysis?.environment === "customer";
    if (environment === "unclassified") return item.analysis?.environment === "unclassified";
    if (item.analysis === null) return item.message.category === "beta";
    return item.analysis.environment === "beta";
  });
}

export function useFeedbackFeed(active: boolean, query: Query) {
  const [cache, setCache] = useState<Map<string, FeedbackResponse>>(() => new Map());
  const [failures, setFailures] = useState<Map<string, string>>(() => new Map());
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const queryKey = `${query.environment}|${query.interpretation ?? ""}|${query.q}|${query.messageId ?? ""}|${query.offset}`;
  const data = cache.get(queryKey) ?? null;
  const error = failures.get(queryKey) ?? "";
  const loading = loadingKey === queryKey;

  const refresh = useCallback(async () => {
    if (!active || document.visibilityState !== "visible") return;
    if (inFlight.current) return;
    const request = ++generation.current;
    const nextController = new AbortController();
    controller.current = nextController;
    inFlight.current = true;
    setLoadingKey(queryKey);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; nextController.abort(); }, 8_000);
    const params = new URLSearchParams({ environment: query.environment, offset: String(query.offset) });
    if (query.interpretation) params.set("interpretation", query.interpretation);
    if (query.q.trim()) params.set("q", query.q.trim());
    if (query.messageId) params.set("messageId", query.messageId);
    try {
      const response = await fetch(`/api/feedback?${params}`, { cache: "no-store", signal: nextController.signal });
      if (!response.ok) throw new Error("Feedback analysis is temporarily unavailable.");
      const payload: unknown = await response.json();
      if (!isFeedbackResponse(payload) || !matchesQuery(payload, query.environment, query.offset, query.messageId)) throw new Error("Feedback analysis returned an invalid response.");
      if (request !== generation.current) return;
      setCache(current => { const next = new Map(current); next.set(queryKey, payload); return next; });
      setFailures(current => { if (!current.has(queryKey)) return current; const next = new Map(current); next.delete(queryKey); return next; });
    } catch (cause) {
      if (request !== generation.current || (!timedOut && cause instanceof DOMException && cause.name === "AbortError")) return;
      const text = timedOut ? "Feedback analysis timed out after 8 seconds. Retained results for this exact query are stale." : cause instanceof Error ? cause.message : "Feedback analysis is temporarily unavailable.";
      setFailures(current => { const next = new Map(current); next.set(queryKey, text); return next; });
    } finally {
      window.clearTimeout(timeout);
      if (request === generation.current) {
        controller.current = null;
        inFlight.current = false;
        setLoadingKey(null);
      }
    }
  }, [active, query.environment, query.interpretation, query.messageId, query.offset, query.q, queryKey]);

  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    inFlight.current = false;
    if (!active) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") { void refresh(); return; }
      generation.current += 1;
      controller.current?.abort();
      controller.current = null;
      inFlight.current = false;
      setLoadingKey(null);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      generation.current += 1;
      controller.current?.abort();
      controller.current = null;
      inFlight.current = false;
    };
  }, [active, queryKey, refresh]);

  return { data, error, loading, refresh, refreshEveryMs: REFRESH_MS };
}
