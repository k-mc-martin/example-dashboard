"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, CheckCircle2, Clock3, DatabaseBackup, HardDrive, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { parseBackupCatalogResponse, type BackupCatalogResponse, type BackupDestination, type BackupLibrary as BackupLibraryRecord } from "@/lib/backup-catalog";
import "./backup-library.css";

const REFRESH_MS = 10_000;

function displayTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not yet recorded";
}

function displaySize(value: number | null): string {
  if (value === null) return "Size not reported";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** order).toFixed(order === 0 ? 0 : 1)} ${units[order]}`;
}

function title(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function statusTone(value: string): "good" | "bad" | "pending" {
  if (["current", "complete", "passed", "succeeded", "initialized"].includes(value)) return "good";
  if (["failed", "error", "unavailable"].includes(value)) return "bad";
  return "pending";
}

function Destination({ destination }: { destination: BackupDestination }) {
  const [showAll, setShowAll] = useState(false);
  const recent = destination.history.toSorted((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const events = showAll ? recent : recent.slice(0, 3);
  return <article className={`backup-destination tone-${statusTone(destination.status)}`}>
    <header>
      <div><span className="backup-kind">{title(destination.kind)}</span><h4>{destination.label}</h4></div>
      <span className={`backup-status tone-${statusTone(destination.status)}`}>{title(destination.status)}</span>
    </header>
    <div className="backup-destination-facts">
      <div><span>LAST SNAPSHOT</span><strong>{displayTime(destination.lastSnapshot?.createdAt ?? null)}</strong><small>{destination.lastSnapshot ? `${destination.lastSnapshot.snapshotId.slice(0, 12)} · ${displaySize(destination.lastSnapshot.sizeBytes)}` : "No snapshot reported"}</small></div>
      <div><span>LAST VERIFICATION</span><strong>{destination.lastVerification ? title(destination.lastVerification.status) : "Not verified"}</strong><small>{displayTime(destination.lastVerification?.verifiedAt ?? null)}</small></div>
      {destination.repositoryBytesStatus ? <div><span>REPOSITORY FOOTPRINT</span><strong>{destination.repositoryBytesStatus === "measured" ? displaySize(destination.repositoryBytes ?? null) : "Unavailable"}</strong><small>{displayTime(destination.repositoryBytesMeasuredAt ?? null)}</small></div> : null}
    </div>
    <div className="backup-history" aria-label={`${destination.label} recent history`}>
      {events.length ? events.map(event => <div key={event.id}>
        <span className={`history-mark tone-${statusTone(event.status)}`} aria-hidden="true" />
        <span><strong>{title(event.kind)}</strong><small>{event.summary}</small></span>
        <time>{displayTime(event.occurredAt)}</time>
      </div>) : <p>No history has been delivered for this destination.</p>}
    </div>
    {destination.history.length > 3 ? <button className="backup-history-toggle" onClick={() => setShowAll(value => !value)} aria-expanded={showAll}>{showAll ? "Show recent history" : `Show all ${destination.history.length} events`}</button> : null}
  </article>;
}

function LibraryCard({ library }: { library: BackupLibraryRecord }) {
  const Icon = library.id === "cold-storage" ? Archive : library.id === "example-app-source" ? HardDrive : DatabaseBackup;
  return <section className={`backup-library-card library-${library.id} tone-${statusTone(library.setup)}`} aria-labelledby={`library-${library.id}`}>
    <header className="backup-library-title">
      <Icon size={23} />
      <div><span>{library.mode === "verified-offload" ? "ONE-TIME VERIFIED OFFLOADS" : "ACTIVE BACKUP SET"}</span><h3 id={`library-${library.id}`}>{library.name}</h3></div>
      <span className={`backup-status tone-${statusTone(library.setup)}`}>{title(library.setup)}</span>
    </header>
    <div className="backup-phase"><span>CURRENT PHASE</span><strong>{title(library.phase)}</strong><p>{library.summary}</p></div>
    {library.sourceLogicalBytes != null ? <p className="archive-boundary"><DatabaseBackup size={16} />Source snapshot logical size: {displaySize(library.sourceLogicalBytes)}</p> : null}
    {library.id === "cold-storage" ? <p className="archive-boundary"><ShieldCheck size={16} />Archive records only. This library is excluded from sync.</p> : null}
    <div className="backup-destinations">{library.destinations.length ? library.destinations.map(destination => <Destination key={destination.id} destination={destination} />) : <div className="backup-empty"><TriangleAlert size={20} /><span>No destinations are configured or available.</span></div>}</div>
  </section>;
}

export function BackupLibrary({ active, canSync = true }: { active: boolean; canSync?: boolean }) {
  const [catalog, setCatalog] = useState<BackupCatalogResponse | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (visible = false) => {
    const request = ++generation.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    if (visible) setRefreshing(true);
    const timeout = window.setTimeout(() => nextController.abort(), 8_000);
    try {
      const response = await fetch("/api/backup-catalog", { cache: "no-store", signal: nextController.signal, headers: visible ? { "X-SecDash-Review": "1" } : undefined });
      if (!response.ok) throw new Error("Backup library endpoint is unavailable.");
      const parsed = parseBackupCatalogResponse(await response.json());
      if (!parsed) throw new Error("Backup library returned an invalid response.");
      let next = parsed;
      try {
        const operationsResponse = await fetch("/api/operations?surface=recovery", { cache: "no-store", signal: nextController.signal });
        if (operationsResponse.ok) {
          const operations = await operationsResponse.json() as {serverTime?:unknown;surfaces?:{recovery?:{latestSuccess?:unknown}}};
          const recovery = operations.surfaces?.recovery as {latest?:unknown;latestSuccess?:unknown} | undefined;
          const success = recovery?.latestSuccess as {observedAt?:unknown;receivedAt?:unknown;data?:{backupCatalog?:unknown}} | undefined;
          const latest = recovery?.latest as {status?:unknown;errorCode?:unknown} | undefined;
          const telemetry = success?.data?.backupCatalog as {generatedAt?:unknown;libraries?:unknown} | undefined;
          if (typeof operations.serverTime === "string" && typeof success?.observedAt === "string" && typeof success.receivedAt === "string" && typeof telemetry?.generatedAt === "string" && Array.isArray(telemetry.libraries)) {
            const cold = parsed.libraries.find(library => library.id === "cold-storage");
            const confirmedLibraries = telemetry.libraries as BackupLibraryRecord[];
            const merged = parsed.libraries.filter(library => library.id !== "cold-storage").map(local => { const confirmed=confirmedLibraries.find(item=>item.id===local.id); return confirmed ? {...local,sourceLogicalBytes:confirmed.sourceLogicalBytes,destinations:local.destinations.map(destination=>{const facts=confirmed.destinations.find(item=>item.id===destination.id);return facts?{...destination,lastSnapshot:facts.lastSnapshot,lastVerification:facts.lastVerification,history:facts.history,repositoryBytes:facts.repositoryBytes,repositoryBytesStatus:facts.repositoryBytesStatus,repositoryBytesMeasuredAt:facts.repositoryBytesMeasuredAt}:destination;})} : local; });
            const now=Date.parse(operations.serverTime), stale=now-Date.parse(success.observedAt)>15*60_000 || now-Date.parse(telemetry.generatedAt)>15*60_000, latestFailed=latest?.status==="error";
            const status=latestFailed?"error":stale?"stale":"current", detail=latestFailed?`Latest recovery collection failed${typeof latest.errorCode==="string"?`: ${latest.errorCode}`:""}. Last confirmed backup history is preserved.`:stale?"Backup history receipt is stale; live controller progress remains separate.":"Backup history confirmed through the n8n recovery feed.";
            const candidate = parseBackupCatalogResponse({...parsed,serverTime:operations.serverTime,source:{kind:"n8n-recovery-feed",observedAt:telemetry.generatedAt,receivedAt:success.receivedAt,status,detail},libraries:[...merged,...(cold?[cold]:[])]});
            if (candidate) next = candidate;
          }
        }
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
      }
      if (request !== generation.current) return;
      setCatalog(next);
      setError("");
    } catch (reason) {
      if (request === generation.current && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Backup library is unavailable.");
    } finally {
      window.clearTimeout(timeout);
      if (request === generation.current) { controller.current = null; setRefreshing(false); }
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError("");
    try {
      const response = await fetch("/api/backup-catalog", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
      if (response.status === 403) throw new Error("Access denied (403). You need permission to sync backups.");
      if (!response.ok) throw new Error(response.status === 409 ? "A backup update is already running." : "Backup update could not be started.");
      const parsed = parseBackupCatalogResponse(await response.json());
      if (!parsed) throw new Error("Backup update returned an invalid response.");
      setCatalog(parsed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Backup update could not be started.");
    } finally { setSyncing(false); }
  }, []);

  useEffect(() => {
    if (!active) return;
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); generation.current += 1; controller.current?.abort(); controller.current = null; };
  }, [active, load]);

  const updateRunning = catalog?.update.state === "running";
  const sourceTone = statusTone(catalog?.source.status ?? "unavailable");
  return <section className="backup-library" aria-labelledby="backup-library-heading">
    <div className="backup-library-chrome"><span><i /><i /><i /></span><span>BACKUP.CATALOG // ALL LIBRARIES</span><span>RECOVERY INDEX</span></div>
    <header className="backup-library-heading">
      <div><p>STORAGE &amp; RECOVERY / BACKUP LIBRARY</p><h2 id="backup-library-heading">Backup catalog</h2><span>Snapshots, verification and update history across every known backup set.</span></div>
      <div className="backup-actions">
        <button className="outline-button" onClick={() => void load(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} />{refreshing ? "Refreshing library" : "Refresh library"}</button>
        {!canSync && <span className="drive-note">Syncing requires additional permission.</span>}
        <button className="primary-button" onClick={() => void sync()} disabled={syncing || updateRunning || !catalog}><DatabaseBackup size={17} className={updateRunning ? "spin" : ""} />{updateRunning ? "Updating backups" : syncing ? "Starting update" : "Update backups"}</button>
      </div>
    </header>
    <div className={`backup-source tone-${sourceTone}`}>
      {sourceTone === "good" ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
      <div><strong>{catalog ? `Catalog source · ${catalog.source.kind === "n8n-recovery-feed" ? "n8n recovery feed" : "Mac backup controller"}` : "Backup catalog unavailable"}</strong><span>{error || catalog?.source.detail || "No catalog response has been received."}</span></div>
      <time>{catalog?.source.observedAt ? `Observed ${displayTime(catalog.source.observedAt)}` : "No source observation"}</time>
    </div>
    <div className={`backup-update tone-${statusTone(catalog?.update.state ?? "unavailable")}`}>
      <Clock3 size={18} /><span><strong>{catalog ? title(catalog.update.state) : "Unavailable"}</strong>{catalog?.update.phase ? ` · ${catalog.update.phase}` : ""}</span><p>{catalog?.update.summary || "Update state has not been reported."}</p><time>{catalog?.update.finishedAt ? displayTime(catalog.update.finishedAt) : catalog?.update.startedAt ? `Started ${displayTime(catalog.update.startedAt)}` : "No update timestamp"}</time>
    </div>
    {error ? <p className="backup-catalog-error" role="alert">{error} Existing catalog values are preserved.</p> : null}
    <div className="backup-library-grid">{catalog ? catalog.libraries.map(library => <LibraryCard key={library.id} library={library} />) : <div className="backup-catalog-placeholder"><TriangleAlert size={25} /><strong>Catalog not initialized</strong><span>No backup setup, destination or success state is inferred while the endpoint is unavailable.</span></div>}</div>
  </section>;
}
