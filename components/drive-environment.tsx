"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Database, HardDrive, RefreshCw, RotateCcw, ServerCog } from "lucide-react";
import type { BackupStatus } from "@/lib/backups";
import { deriveDriveStorageMetrics, DRIVE_STORAGE_COLLECTION_MS, DRIVE_STORAGE_STALE_MS, type DriveStorageResponse, type DriveStorageSample } from "@/lib/drive-storage";
import { BackupLibrary } from "./backup-library";
import "./recovery-environment.css";

const UI_REFRESH_MS = 5_000;
type SuccessfulSample = Extract<DriveStorageSample, { status: "ok" }>;
type RestoreCheck = { checkedAt: string; requestedSnapshot: string; sourceCreatedAt?: string; ok: boolean; checksumsVerified?: number; credentialDecryptionVerified?: boolean; counts?: { credentials: number; users: number; workflows: number }; dashboard?: { databases: number; files: number }; serverDashboard?: { messages: number; tables: number } };
type RecoveryData = { schemaVersion: 1; generatedAt: string; backupFolder: { name: "Dupdash Backups"; bytes: number; objects: number; measuredAt: string }; restoreChecks: RestoreCheck[] };
type RecoveryObservation = { surface: "recovery"; observedAt: string; receivedAt: string; status: "ok" | "partial" | "error"; data?: RecoveryData; errorCode?: string };
const SUCCESS_SAMPLE = (sample: DriveStorageSample): sample is SuccessfulSample => sample.status === "ok" && deriveDriveStorageMetrics(sample) !== null;
const errorCodes = new Set(["authorization_required", "provider_unavailable", "invalid_response"]);

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSample(value: unknown): value is DriveStorageSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sample = value as Record<string, unknown>;
  if (sample.provider !== "google-drive" || !isTimestamp(sample.observedAt) || !isTimestamp(sample.receivedAt)) return false;
  if (sample.status === "error") return typeof sample.errorCode === "string" && errorCodes.has(sample.errorCode);
  if (sample.status !== "ok" || !sample.quota || typeof sample.quota !== "object" || Array.isArray(sample.quota)) return false;
  return deriveDriveStorageMetrics(sample as DriveStorageSample) !== null;
}

function isDriveStorageResponse(value: unknown): value is DriveStorageResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (!isTimestamp(response.serverTime) || !Array.isArray(response.history) || !response.history.every(isSample)) return false;
  if (response.latest !== null && !isSample(response.latest)) return false;
  return response.latestSuccess === null || (isSample(response.latestSuccess) && response.latestSuccess.status === "ok");
}

function nonNegative(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isRecoveryObservation(value: unknown): value is RecoveryObservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>, data = item.data as Record<string, unknown> | undefined;
  if (item.surface === "recovery" && item.status === "error") return isTimestamp(item.observedAt) && isTimestamp(item.receivedAt) && typeof item.errorCode === "string" && ["authorization_required","provider_unavailable","rate_limited","invalid_response","incomplete_collection"].includes(item.errorCode);
  const folder = data?.backupFolder as Record<string, unknown> | undefined;
  return item.surface === "recovery" && item.status === "ok" && isTimestamp(item.observedAt) && isTimestamp(item.receivedAt)
    && data?.schemaVersion === 1 && isTimestamp(data.generatedAt) && folder?.name === "Dupdash Backups" && nonNegative(folder.bytes) && nonNegative(folder.objects) && isTimestamp(folder.measuredAt)
    && Array.isArray(data.restoreChecks) && data.restoreChecks.every(raw => { const check = raw as Record<string, unknown>; return isTimestamp(check.checkedAt) && typeof check.requestedSnapshot === "string" && typeof check.ok === "boolean"; });
}

type DriveEnvironmentProps = {
  permissions?: import('@/lib/demo-permissions').TeamPermissions;
  active: boolean;
  backup: BackupStatus | null;
  backupLoading: boolean;
  backupError: string;
  onStartBackup: () => void;
};

function size(value: number | null): string {
  if (value == null) return "Not reported";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** order).toFixed(order > 2 ? 2 : 1)} ${units[order]}`;
}

function shortSize(value: number, range = value): string {
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1);
  const unit = 1024 ** (order + 1);
  const precision = Math.min(6, Math.max(1, Math.ceil(-Math.log10(Math.max(range / unit, 1e-6))) + 1));
  return `${(value / unit).toFixed(precision)} ${units[order]}`;
}

function time(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "Not yet observed";
}

function errorLabel(sample: Extract<DriveStorageSample, { status: "error" }> | null): string {
  if (!sample) return "The n8n storage feed has not delivered an observation yet.";
  if (sample.errorCode === "authorization_required") return "Google authorization is required before n8n can read quota data.";
  if (sample.errorCode === "invalid_response") return "Google returned a quota response that could not be validated.";
  return "Google Drive quota is temporarily unavailable from the provider.";
}

function PanelChrome({ label }: { label: string }) {
  return <div className="panel-chrome" aria-hidden="true"><span className="panel-controls"><i /><i /><i /></span><span>{label}</span><span className="panel-readout">SecDash // FEED</span></div>;
}

function StorageGauge({ sample }: { sample: SuccessfulSample }) {
  const metrics = deriveDriveStorageMetrics(sample)!;
  const total = metrics.limitBytes;
  const used = metrics.usedBytes;
  const drive = Math.min(metrics.driveBytes, used);
  const trash = Math.min(metrics.trashBytes, drive);
  const driveActive = Math.max(drive - trash, 0);
  const other = Math.max(used - drive, 0);
  const available = total == null ? null : Math.max(total - used, 0);
  const overCapacity = total == null ? null : Math.max(used - total, 0);
  const scale = Math.max(total ?? 0, used, 1);
  const segments = [
    { label: "Drive files", value: driveActive, color: "#d8cec1" },
    { label: "Drive trash", value: trash, color: "#ca3444" },
    { label: "Other Google services", value: other, color: "#716b78" },
    ...(available == null ? [] : [{ label: "Available", value: available, color: "#282b36" }]),
  ];
  let offset = 0;
  return <div className="quota-gauge">
    <div className="quota-gauge-ring" role="img" aria-label={`${size(used)} used${total == null ? "; total quota not reported" : ` of ${size(total)} total`}`}>
      <svg viewBox="0 0 220 132" aria-hidden="true">
        <path className="gauge-track" pathLength="100" d="M 20 112 A 90 90 0 0 1 200 112" />
        {segments.map(segment => {
          const start = offset;
          const width = Math.min(Math.max(segment.value / scale * 100, 0), 100 - offset);
          offset += width;
          return <path key={segment.label} d="M 20 112 A 90 90 0 0 1 200 112" pathLength="100" fill="none" stroke={segment.color} strokeWidth="18" strokeDasharray={`${width} ${100 - width}`} strokeDashoffset={-start} />;
        })}
      </svg>
      <div className="gauge-reading"><strong>{size(used)}</strong><span>USED</span></div>
    </div>
    <div className="quota-totals"><div className="available-total"><span>Available</span><strong>{size(available)}</strong></div><div><span>Total</span><strong>{size(total)}</strong></div>{overCapacity && overCapacity > 0 ? <div className="over-capacity"><span>Over reported limit</span><strong>{size(overCapacity)}</strong></div> : null}</div>
    <div className="quota-legend">{segments.map(segment => <div key={segment.label}><span className="legend-swatch" style={{ background: segment.color }} /><span>{segment.label}</span><strong>{size(segment.value)}</strong></div>)}</div>
    <p className="drive-note">Google account quota includes Drive and other Google services. Drive trash is shown inside Drive usage and is not counted twice.</p>
  </div>;
}

function HistoryChart({ samples, selectedAt, onSelect }: { samples: SuccessfulSample[]; selectedAt: string | null; onSelect: (sample: SuccessfulSample) => void }) {
  if (samples.length === 0) return <div className="chart-empty"><Database size={25} /><strong>No successful quota observations</strong><span>The chart begins when n8n delivers a valid Google quota sample.</span></div>;
  const width = 720, height = 310, left = 22, right = 22, top = 22, bottom = 22;
  const values = samples.map(sample => deriveDriveStorageMetrics(sample)!.usedBytes);
  const times = samples.map(sample => new Date(sample.observedAt).valueOf());
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const valuePadding = rawMax === rawMin ? Math.max(rawMax * .04, 1) : (rawMax - rawMin) * .12;
  const min = Math.max(rawMin - valuePadding, 0), max = rawMax + valuePadding, span = Math.max(max - min, 1);
  const minTime = Math.min(...times), maxTime = Math.max(...times), timeSpan = Math.max(maxTime - minTime, 1);
  const points = samples.map((sample, index) => ({ sample, value: values[index], x: samples.length === 1 ? (left + width - right) / 2 : left + ((times[index] - minTime) / timeSpan) * (width - left - right), y: top + ((max - values[index]) / span) * (height - top - bottom) }));
  const polyline = points.map(point => `${point.x},${point.y}`).join(" ");
  const ticks = [max, min + span / 2, min];
  return <div className="history-chart">
    <div className="chart-stage">
      <div className="chart-y-axis" aria-hidden="true">{ticks.map((tick, index) => <span key={index}>{shortSize(tick, span)}</span>)}</div>
      <div className="chart-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Google account used storage across ${samples.length} observed ${samples.length === 1 ? "sample" : "samples"}`}>
          {ticks.map((_, index) => <line key={index} x1={left} x2={width - right} y1={top + index * (height - top - bottom) / 2} y2={top + index * (height - top - bottom) / 2} className="chart-gridline" />)}
          {samples.length > 1 ? <polyline points={polyline} className="chart-line" vectorEffect="non-scaling-stroke" /> : null}
          {points.map(point => <g key={point.sample.observedAt}><circle className={selectedAt === point.sample.observedAt ? "chart-point selected" : "chart-point"} cx={point.x} cy={point.y} r={selectedAt === point.sample.observedAt ? 6 : 2.4} vectorEffect="non-scaling-stroke" /><circle className="chart-hit" cx={point.x} cy={point.y} r="24" role="button" tabIndex={0} aria-label={`${time(point.sample.observedAt)}, ${size(point.value)} used`} onClick={() => onSelect(point.sample)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.sample); } }} /></g>)}
        </svg>
      </div>
    </div>
    <p className="drive-note chart-scale-note">Vertical scale fitted to observed usage · window change {values.at(-1)! >= values[0] ? "+" : "−"}{size(Math.abs(values.at(-1)! - values[0]))}</p>
    <div className="chart-axis"><span>{time(samples[0].observedAt)}</span><span>{samples.length === 1 ? "ONE REAL OBSERVATION" : time(samples.at(-1)?.observedAt)}</span></div>
  </div>;
}

export function DriveEnvironment({ active, backup, backupLoading, backupError, onStartBackup, permissions }: DriveEnvironmentProps) {
  const [response, setResponse] = useState<DriveStorageResponse | null>(null);
  const [requestError, setRequestError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedAt, setSelectedAt] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryObservation | null>(null);
  const [recoveryLatest, setRecoveryLatest] = useState<RecoveryObservation | null>(null);
  const [recoveryServerTime, setRecoveryServerTime] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  const [allRestoreChecks, setAllRestoreChecks] = useState(false);
  const inFlight = useRef(false);
  const requestGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const recoveryInFlight = useRef(false);
  const recoveryController = useRef<AbortController | null>(null);
  const recoveryGeneration = useRef(0);

  const refreshRecovery = useCallback(async () => {
    if (recoveryInFlight.current) return;
    const request = ++recoveryGeneration.current;
    const controller = new AbortController(); recoveryController.current = controller; recoveryInFlight.current = true;
    let timedOut = false; const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8_000);
    try {
      const result = await fetch("/api/operations?surface=recovery", { cache: "no-store", signal: controller.signal });
      if (!result.ok) throw new Error("Recovery telemetry endpoint is unavailable.");
      const payload = await result.json() as { serverTime?: unknown; surfaces?: { recovery?: { latest?: unknown; latestSuccess?: unknown } } };
      if (!isTimestamp(payload.serverTime)) throw new Error("Recovery telemetry returned an invalid response.");
      const latest = payload.surfaces?.recovery?.latest, latestSuccess = payload.surfaces?.recovery?.latestSuccess;
      if (latest != null && !isRecoveryObservation(latest)) throw new Error("Recovery telemetry returned an invalid response.");
      if (latestSuccess != null && !isRecoveryObservation(latestSuccess)) throw new Error("Recovery telemetry returned an invalid response.");
      if (request !== recoveryGeneration.current) return;
      setRecovery(latestSuccess ?? null); setRecoveryLatest(latest ?? null); setRecoveryServerTime(payload.serverTime); setRecoveryError("");
    } catch (error) {
      if (request === recoveryGeneration.current && (timedOut || !(error instanceof DOMException && error.name === "AbortError"))) setRecoveryError(timedOut ? "Recovery telemetry timed out. The last valid measurement is preserved." : error instanceof Error ? error.message : "Recovery telemetry is unavailable.");
    } finally { window.clearTimeout(timeout); if (request === recoveryGeneration.current) { recoveryInFlight.current = false; recoveryController.current = null; } }
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    requestController.current = controller;
    inFlight.current = true;
    setRefreshing(true);
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8_000);
    try {
      const result = await fetch("/api/drive-storage", { cache: "no-store", signal: controller.signal });
      if (!result.ok) throw new Error("Storage telemetry endpoint is unavailable.");
      const payload: unknown = await result.json();
      if (!isDriveStorageResponse(payload)) throw new Error("Storage telemetry returned an invalid response.");
      const next = payload;
      if (generation !== requestGeneration.current) return;
      setResponse(next);
      setRequestError("");
      setSelectedAt(current => current && next.history.some(item => item.status === "ok" && item.observedAt === current) ? current : next.latestSuccess?.observedAt ?? null);
    } catch (error) {
      if (generation === requestGeneration.current && (timedOut || !(error instanceof DOMException && error.name === "AbortError"))) setRequestError(timedOut ? "Storage telemetry timed out. The last valid observation is preserved." : error instanceof Error ? error.message : "Storage telemetry is unavailable.");
    } finally {
      window.clearTimeout(timeout);
      if (generation === requestGeneration.current) {
        inFlight.current = false;
        requestController.current = null;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), UI_REFRESH_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      requestGeneration.current += 1;
      requestController.current?.abort();
      requestController.current = null;
      inFlight.current = false;
    };
  }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    const initial = window.setTimeout(() => void refreshRecovery(), 0), timer = window.setInterval(() => void refreshRecovery(), UI_REFRESH_MS);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); recoveryGeneration.current += 1; recoveryController.current?.abort(); recoveryController.current = null; recoveryInFlight.current = false; };
  }, [active, refreshRecovery]);

  const successes = useMemo(() => response?.history.filter(SUCCESS_SAMPLE) ?? [], [response]);
  const latestSuccess = response?.latestSuccess && SUCCESS_SAMPLE(response.latestSuccess) ? response.latestSuccess : null;
  const selected = successes.find(item => item.observedAt === selectedAt) ?? latestSuccess;
  const selectedMetrics = deriveDriveStorageMetrics(selected);
  const latestError = response?.latest?.status === "error" ? response.latest : null;
  const stale = latestSuccess && response ? new Date(response.serverTime).valueOf() - new Date(latestSuccess.observedAt).valueOf() > DRIVE_STORAGE_STALE_MS : false;
  const feedState = requestError ? "unavailable" : latestError ? "error" : stale ? "stale" : latestSuccess ? "current" : "pending";
  const restoreChecks = recovery?.data?.restoreChecks ?? [];
  const latestRestore = restoreChecks.at(-1) ?? null;
  const recoveryStale = !!(recovery && recoveryServerTime && new Date(recoveryServerTime).valueOf() - new Date(recovery.observedAt).valueOf() > 15 * 60_000);

  return <div className="drive-environment">
    <div className="view-heading drive-heading"><div><p className="eyebrow">GOOGLE DRIVE / STORAGE & RECOVERY</p><h1>STORAGE TELEMETRY<span className="heading-dot">.</span></h1></div><button className="outline-button" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing" : "Refresh feed"}</button></div>
    <div className={`feed-status ${feedState}`} role={feedState === "error" || feedState === "unavailable" ? "alert" : "status"}><span className="feed-state-icon">{feedState === "current" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}</span><div><strong>{feedState === "current" ? "Telemetry current" : feedState === "stale" ? "Last success is stale" : feedState === "error" ? "Latest collection failed" : feedState === "unavailable" ? "Dashboard feed unavailable" : "Awaiting first observation"}</strong><span>{requestError || (latestError ? errorLabel(latestError) : latestSuccess ? `Observed ${time(latestSuccess.observedAt)} · received ${time(latestSuccess.receivedAt)}` : errorLabel(null))}</span></div><span className="feed-cadence">Source: n8n · collects every {DRIVE_STORAGE_COLLECTION_MS / 60_000} min<br />Display updates every {UI_REFRESH_MS / 1_000} sec</span></div>

    <div className="drive-primary-grid">
      <section className="drive-panel quota-panel" aria-labelledby="quota-heading"><PanelChrome label="CAPACITY.MON" /><div className="panel-heading"><div><p className="eyebrow">CAPACITY / BYTES</p><h2 id="quota-heading">Google account storage</h2></div><HardDrive size={23} /></div>{latestSuccess ? <StorageGauge sample={latestSuccess} /> : <div className="panel-unavailable"><HardDrive size={32} /><strong>Quota unavailable</strong><span>No capacity value is shown until n8n supplies a valid observation.</span></div>}</section>
      <section className="drive-panel trend-panel" aria-labelledby="trend-heading"><PanelChrome label="QUOTA.HISTORY" /><div className="panel-heading"><div><p className="eyebrow">OBSERVED USAGE / BYTES</p><h2 id="trend-heading">Quota observations</h2></div><span className="sample-count">{successes.length} SAMPLES</span></div><HistoryChart samples={successes} selectedAt={selectedAt} onSelect={sample => setSelectedAt(sample.observedAt)} /><p className="drive-note">Only quota values actually observed by n8n are plotted. A single point remains a single point; no history is inferred.</p></section>
    </div>

    <div className="drive-secondary-grid">
      <section className="drive-panel inspector" aria-labelledby="observation-heading"><PanelChrome label="SAMPLE.INSPECT" /><div className="panel-heading"><div><p className="eyebrow">SELECTED SAMPLE</p><h2 id="observation-heading">Observation inspector</h2></div><Clock3 size={21} /></div>{selected && selectedMetrics ? <dl><div><dt>Observed at</dt><dd>{time(selected.observedAt)}</dd></div><div><dt>Received by dashboard</dt><dd>{time(selected.receivedAt)}</dd></div><div><dt>Used</dt><dd>{size(selectedMetrics.usedBytes)}</dd></div><div><dt>Drive, including trash</dt><dd>{size(selectedMetrics.driveBytes)}</dd></div><div><dt>Drive trash</dt><dd>{size(selectedMetrics.trashBytes)}</dd></div><div><dt>Reported limit</dt><dd>{size(selectedMetrics.limitBytes)}</dd></div></dl> : <div className="panel-unavailable compact"><strong>No observation selected</strong><span>A valid collection will expose its exact timestamps and quota fields here.</span></div>}</section>
      <section className="drive-panel recovery-panel" aria-labelledby="recovery-heading"><PanelChrome label="RECOVERY.PROOF" /><div className="panel-heading"><div><p className="eyebrow">ENCRYPTED RECOVERY</p><h2 id="recovery-heading">Dashboard + n8n backup</h2></div><RotateCcw size={21} /></div><div className={`recovery-state ${backup?.state ?? "never"}`}><ServerCog size={25} /><div><strong>{backup?.state === "running" ? "Backup in progress" : backup?.state === "succeeded" ? "Last backup completed" : backup?.state === "failed" ? "Last backup failed" : "Manual backup ready"}</strong><span>{backup?.state === "succeeded" ? time(backup.finishedAt) : backup?.state === "failed" ? `${time(backup.finishedAt)} · review local service logs` : backup?.state === "running" ? `Started ${time(backup.startedAt)}` : "No completed backup status is available."}</span></div></div>{backup?.summary && backup.state !== "never" ? <p className="backup-summary">{backup.summary}</p> : null}{backupError ? <p className="backup-error" role="alert">{backupError}</p> : null}{permissions && !permissions.startBackup && <p className="drive-note">You have view access. Starting a backup requires additional permission.</p>}<button className="primary-button recovery-action" onClick={onStartBackup} disabled={backupLoading || backup?.state === "running"}><RefreshCw size={16} className={backup?.state === "running" ? "spin" : ""} />{backup?.state === "running" ? "Backing up" : backupLoading ? "Starting" : "Back Up Now"}</button>{recoveryError || recoveryLatest?.status === "error" || recoveryStale ? <p className="backup-error" role="alert">{recoveryError || (recoveryLatest?.status === "error" ? `Latest recovery collection failed${recoveryLatest.errorCode ? `: ${recoveryLatest.errorCode}` : "."} The last successful measurement is preserved.` : "Recovery telemetry is stale. The last successful measurement is preserved.")}</p> : null}<div className="restore-proof"><strong>{latestRestore ? (latestRestore.ok ? "Latest restore check passed" : "Latest restore check failed") : "No restore check delivered"}</strong>{latestRestore ? <><span>{time(latestRestore.checkedAt)} · snapshot {latestRestore.requestedSnapshot.slice(0, 8)}</span><span>{latestRestore.checksumsVerified ?? "—"} checksums · {latestRestore.counts?.workflows ?? "—"} workflows · {latestRestore.counts?.credentials ?? "—"} credentials</span></> : null}</div><div className="restore-history" aria-label="Restore check history">{(allRestoreChecks ? [...restoreChecks] : restoreChecks.slice(-4)).reverse().map(check => <div key={`${check.checkedAt}-${check.requestedSnapshot}`}><span className={check.ok ? "passed" : "failed"}>{check.ok ? "PASS" : "FAIL"}</span><time>{time(check.checkedAt)}</time><code>{check.requestedSnapshot.slice(0, 8)}</code></div>)}</div>{restoreChecks.length > 4 ? <button className="text-link" aria-expanded={allRestoreChecks} onClick={()=>setAllRestoreChecks(!allRestoreChecks)}>{allRestoreChecks ? "Show recent checks" : `Show all ${restoreChecks.length} restore checks`}</button> : null}<p className="drive-note">Recovery collects every 5 minutes. No backup schedule or retention policy is configured.</p></section>
      <section className="drive-panel folder-panel" aria-labelledby="folder-heading"><PanelChrome label="DRIVE.FOOTPRINT" /><div className="panel-heading"><div><p className="eyebrow">BACKUP FOOTPRINT</p><h2 id="folder-heading">Backup folder</h2></div><Database size={21} /></div>{recovery?.data ? <div className="folder-metric"><span>RECURSIVE DRIVE ROOT</span><strong>{size(recovery.data.backupFolder.bytes)}</strong><div>{recovery.data.backupFolder.objects.toLocaleString()} objects</div><p>Measured {time(recovery.data.backupFolder.measuredAt)}. This folder measurement is separate from account-wide Google quota.</p></div> : <div className="pending-metric"><span>AWAITING MEASUREMENT</span><strong>—</strong><p>No folder-level measurement has been delivered, so no backup footprint is shown.</p></div>}</section>
    </div>
    <BackupLibrary active={active} canSync={permissions?.syncBackups ?? true} />
  </div>;
}
