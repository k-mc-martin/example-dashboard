"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Network, RefreshCw, Workflow } from "lucide-react";
import type { AiUsage, AiUsageOk } from "../lib/ai-usage";
import { parseAiUsage } from "../lib/ai-usage";
import { AiUsagePanel } from "./ai-usage-panel";
import "./automation-environment.css";

type Automation = {
  measuredAt: string;
  workflows: { id: string; name: string; active: boolean }[];
  executionHistoryAvailable: boolean;
  lastExecution: null | { workflowId: string; status: string; startedAt: string; finishedAt: string | null; durationMs: number | null };
  failureCount24h: number | null;
  aiUsage?: AiUsage;
};
type Observation = { surface: "recovery"; observedAt: string; receivedAt: string; status: "ok" | "error"; errorCode?: string; data?: { automation?: Automation } };
type Response = { serverTime: string; surfaces: { recovery: { latest: Observation | null; latestSuccess: Observation | null; latestAiUsage?: AiUsageOk | null } } };

function time(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : "Unavailable"; }
function validTime(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validAutomation(value: unknown): value is Automation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Automation;
  return validTime(item.measuredAt) && Array.isArray(item.workflows)
    && item.workflows.every(workflow => typeof workflow.id === "string" && typeof workflow.name === "string" && typeof workflow.active === "boolean")
    && typeof item.executionHistoryAvailable === "boolean"
    && (item.aiUsage === undefined || parseAiUsage(item.aiUsage) !== null);
}
function validObservation(value: unknown): value is Observation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Observation;
  return item.surface === "recovery" && validTime(item.observedAt) && validTime(item.receivedAt)
    && (item.status === "error" || (item.status === "ok" && validAutomation(item.data?.automation)));
}

function PanelChrome({ label }: { label: string }) {
  return <div className="panel-chrome" aria-hidden="true"><span className="panel-controls"><i /><i /><i /></span><span>{label}</span><span className="panel-readout">N8N // READ ONLY</span></div>;
}

export function N8nEnvironment({ active }: { active: boolean }) {
  const [response, setResponse] = useState<Response | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false), [lastAiUsage, setLastAiUsage] = useState<AiUsageOk | null>(null);
  const generation = useRef(0), inFlight = useRef(false), requestController = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const request = ++generation.current, controller = new AbortController(); requestController.current = controller; inFlight.current = true; setLoading(true);
    let timedOut = false; const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8_000);
    try {
      const result = await fetch("/api/operations", { cache: "no-store", signal: controller.signal });
      if (!result.ok) throw new Error("Automation telemetry is unavailable.");
      const payload = await result.json() as Response;
      const surface = payload?.surfaces?.recovery;
      const persistedUsage = surface?.latestAiUsage;
      const parsedPersistedUsage = persistedUsage == null ? persistedUsage : parseAiUsage(persistedUsage);
      if (!validTime(payload?.serverTime) || !surface || (surface.latest !== null && !validObservation(surface.latest)) || (surface.latestSuccess !== null && !validObservation(surface.latestSuccess))
        || (persistedUsage !== undefined && persistedUsage !== null && parsedPersistedUsage?.status !== "ok")) throw new Error("Automation telemetry returned an invalid response.");
      if (request === generation.current) {
        const deliveredUsage = surface.latestSuccess?.status === "ok" ? surface.latestSuccess.data?.automation?.aiUsage : null;
        const available = [deliveredUsage?.status === "ok" ? deliveredUsage : null, parsedPersistedUsage?.status === "ok" ? parsedPersistedUsage : null]
          .filter((value): value is AiUsageOk => value !== null)
          .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt))[0];
        if (available) setLastAiUsage(previous => !previous || Date.parse(available.measuredAt) > Date.parse(previous.measuredAt) ? available : previous);
        setResponse(payload); setError("");
      }
    } catch (reason) {
      if (request === generation.current && (timedOut || !(reason instanceof DOMException && reason.name === "AbortError"))) setError(timedOut ? "Automation telemetry timed out. The last valid observation is preserved." : reason instanceof Error ? reason.message : "Automation telemetry is unavailable.");
    } finally { window.clearTimeout(timeout); if (request === generation.current) { requestController.current = null; inFlight.current = false; setLoading(false); } }
  }, []);
  useEffect(() => { if (!active) return; const initial = window.setTimeout(() => void refresh(), 0), timer = window.setInterval(() => void refresh(), 5_000); return () => { window.clearTimeout(initial); window.clearInterval(timer); generation.current += 1; requestController.current?.abort(); requestController.current = null; inFlight.current = false; }; }, [active, refresh]);
  const latest = response?.surfaces.recovery.latest ?? null, success = response?.surfaces.recovery.latestSuccess ?? null;
  const automation = success?.status === "ok" ? success.data?.automation : null;
  const stale = !!(success && response && new Date(response.serverTime).valueOf() - new Date(success.observedAt).valueOf() > 15 * 60_000);
  const usageStale = !!(automation?.aiUsage && response && new Date(response.serverTime).valueOf() - new Date(automation.aiUsage.measuredAt).valueOf() > 15 * 60_000);
  const persistedAiUsage = response?.surfaces.recovery.latestAiUsage ?? null;
  const availableAiUsage = [automation?.aiUsage?.status === "ok" ? automation.aiUsage : null, persistedAiUsage, lastAiUsage]
    .filter((value): value is AiUsageOk => value !== null)
    .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt))[0] ?? null;
  const activeWorkflows = automation?.workflows.filter(item => item.active).length ?? 0;
  const lastWorkflow = automation?.lastExecution ? automation.workflows.find(item => item.id === automation.lastExecution?.workflowId) : null;
  const feedState = error ? "unavailable" : latest?.status === "error" ? "error" : stale ? "stale" : latest ? "current" : "pending";

  return <div className="n8n-environment">
    <div className="view-heading automation-heading">
      <div><p className="eyebrow">N8N / MONITORED AUTOMATION</p><h1>WORKFLOW TELEMETRY<span className="heading-dot">.</span></h1></div>
      <button className="outline-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={18} className={loading ? "spin" : ""} />{loading ? "Refreshing" : "Refresh feed"}</button>
    </div>
    <div className={`feed-status ${feedState}`} role={feedState === "error" || feedState === "unavailable" ? "alert" : "status"}>
      <span className="feed-state-icon">{feedState === "current" ? <CheckCircle2 size={20} /> : <Network size={20} />}</span>
      <div><strong>{error ? "Dashboard feed unavailable" : latest?.status === "error" ? "Latest automation collection failed" : stale ? "Automation telemetry is stale" : latest ? "Automation inventory current" : "Awaiting first observation"}</strong><span>{error || (latest ? `Observed ${time(latest.observedAt)} · received ${time(latest.receivedAt)}` : "No automation observation has been delivered.")}</span></div>
      <span className="feed-cadence">VPS / N8N POSTGRESQL<br />COLLECTED EVERY 5 MIN</span>
    </div>
    {!automation ? <section className="automation-awaiting"><AlertTriangle size={34} /><p className="eyebrow">INVENTORY / UNAVAILABLE</p><h2>No automation inventory delivered</h2><p>Workflow state remains unavailable until the sanitized recovery pipeline supplies it.</p></section> : <>
      <section className="automation-summary" aria-label="Automation summary">
        <div className="automation-metric"><Workflow size={24} /><span>Monitored</span><strong>{automation.workflows.length}</strong><small>exact workflows</small></div>
        <div className="automation-metric"><CheckCircle2 size={24} /><span>Published / active</span><strong>{activeWorkflows}</strong><small>of {automation.workflows.length} monitored</small></div>
        <div className="automation-metric measured"><Clock3 size={24} /><span>Inventory measured</span><strong>{time(automation.measuredAt)}</strong><small>actual collector timestamp</small></div>
      </section>
      <AiUsagePanel usage={automation.aiUsage ?? null} lastAvailable={availableAiUsage} telemetryStale={stale || usageStale} feedError={error} collectionFailed={latest?.status === "error"} />
      <div className="automation-grid">
        <section className="automation-card lanes-card" aria-labelledby="workflow-lanes-heading">
          <PanelChrome label="WORKFLOW.MATRIX" />
          <div className="automation-card-heading"><div><p className="eyebrow">COLLECTED SNAPSHOT / READ ONLY</p><h2 id="workflow-lanes-heading">Monitored workflow lanes</h2></div><span>{activeWorkflows}/{automation.workflows.length} ACTIVE</span></div>
          <div className="workflow-lanes">{automation.workflows.length ? automation.workflows.map((workflow, index) => <div className={`workflow-lane ${workflow.active ? "active" : "inactive"}`} key={workflow.id}>
            <span className="lane-index">{String(index + 1).padStart(2, "0")}</span><span className={`ops-dot ${workflow.active ? "success" : ""}`} />
            <div className="lane-identity"><strong>{workflow.name}</strong><span>Workflow ID · {workflow.id}</span></div>
            <b>{workflow.active ? "ACTIVE" : "INACTIVE"}</b>
          </div>) : <p className="ops-empty">No monitored workflows were found.</p>}</div>
        </section>
        <section className="automation-card execution-panel" aria-labelledby="execution-heading">
          <PanelChrome label="EXECUTION.EVIDENCE" />
          <div className="automation-card-heading"><div><p className="eyebrow">POSTGRES RETENTION / EVIDENCE</p><h2 id="execution-heading">Retained execution</h2></div><Clock3 size={22} /></div>
          {!automation.executionHistoryAvailable ? <div className="execution-unavailable"><Clock3 size={30} /><strong>Durable execution history unavailable</strong><p>These workflows have execution persistence disabled. Last-run result, duration, and retained 24-hour error count cannot be reconstructed from retained records.</p></div> : automation.lastExecution ? <dl className="execution-list"><div><dt>Workflow</dt><dd><strong>{lastWorkflow?.name ?? "Unknown monitored workflow"}</strong><span>{automation.lastExecution.workflowId}</span></dd></div><div><dt>Result</dt><dd><span className={`execution-result ${automation.lastExecution.status.toLowerCase()}`}>{automation.lastExecution.status}</span></dd></div><div><dt>Started</dt><dd>{time(automation.lastExecution.startedAt)}</dd></div><div><dt>Duration</dt><dd>{automation.lastExecution.durationMs == null ? "Unavailable" : `${automation.lastExecution.durationMs.toLocaleString()} ms`}</dd></div><div><dt>Retained errors / 24h</dt><dd>{automation.failureCount24h == null ? "Unavailable" : automation.failureCount24h.toLocaleString()}</dd></div></dl> : <p className="ops-empty">Execution retention is present, but no latest execution was reported.</p>}
          <p className="automation-footnote">Only retained database evidence is shown. Missing execution history is unavailable, never interpreted as zero.</p>
        </section>
      </div>
    </>}
  </div>;
}
