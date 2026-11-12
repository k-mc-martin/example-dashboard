"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Cloud, CreditCard, Globe2, RefreshCw, ShieldCheck } from "lucide-react";
import {
  parseProviderTelemetry, type AzureTelemetryData, type CloudflareTelemetryData,
  type GoDaddyTelemetryData, type LemonSqueezyTelemetryData, type ProviderSurface,
  type ProviderTelemetry,
} from "@/lib/provider-telemetry";
import "./operations.css";

type Observation = ProviderTelemetry & { receivedAt: string };
type CompactEvent = { surface: string; observedAt: string; receivedAt: string; status: "ok" | "partial" | "error"; errorCode?: string };
type SurfaceRecord = { latest: Observation | null; latestSuccess: Observation | null; history: CompactEvent[] };
type OperationsResponse = { surfaces: Partial<Record<ProviderSurface, SurfaceRecord>>; serverTime: string };

const LABELS: Record<ProviderSurface, { eyebrow: string; title: string; icon: typeof Cloud }> = {
  cloudflare: { eyebrow: "CLOUDFLARE / DELIVERY & OBJECT STORAGE", title: "EDGE OPERATIONS", icon: Cloud },
  azure: { eyebrow: "AZURE / ARTIFACT SIGNING", title: "SIGNING CONTROL", icon: ShieldCheck },
  godaddy: { eyebrow: "GODADDY / EXAMPLE.INVALID", title: "DOMAIN CONTROL", icon: Globe2 },
  lemonsqueezy: { eyebrow: "LEMON SQUEEZY / STORE 100001", title: "COMMERCE LEDGER", icon: CreditCard },
};

function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validObservation(value: unknown, surface: ProviderSurface): value is Observation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const { receivedAt: _receivedAt, ...envelope } = record;
  return timestamp(record.receivedAt) && parseProviderTelemetry(envelope)?.surface === surface;
}
function validEvent(value: unknown, surface: ProviderSurface): value is CompactEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return event.surface === surface && timestamp(event.observedAt) && timestamp(event.receivedAt) && ["ok", "partial", "error"].includes(String(event.status));
}
function validResponse(value: unknown): value is OperationsResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (!timestamp(response.serverTime) || !response.surfaces || typeof response.surfaces !== "object" || Array.isArray(response.surfaces)) return false;
  return Object.entries(response.surfaces).every(([key, raw]) => {
    if (key === "recovery") return !!raw && typeof raw === "object" && !Array.isArray(raw);
    if (!["cloudflare", "azure", "godaddy", "lemonsqueezy"].includes(key) || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const item = raw as Record<string, unknown>, surface = key as ProviderSurface;
    return Array.isArray(item.history) && item.history.every(entry => validEvent(entry, surface))
      && (item.latest === null || validObservation(item.latest, surface))
      && (item.latestSuccess === null || validObservation(item.latestSuccess, surface));
  });
}

function bytes(value: number): string {
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** order).toFixed(order > 1 ? 1 : 0)} ${units[order]}`;
}
function money(value: number): string { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value / 100); }
function date(value?: string): string { return value ? new Date(value).toLocaleString() : "Unavailable"; }
function bool(value?: boolean): string { return value == null ? "Unavailable" : value ? "Enabled" : "Disabled"; }

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="ops-metric"><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>;
}

function PaneHeading({ kicker, title, badge }: { kicker: string; title: string; badge?: ReactNode }) {
  return <div className="ops-section-heading">
    <div className="ops-pane-copy"><p className="ops-kicker">{kicker}</p><h2>{title}</h2></div>
    <div className="ops-pane-tools">{badge == null ? null : <span className="ops-pane-badge">{badge}</span>}<span className="ops-pane-controls" aria-hidden="true"><i /><i /><i /></span></div>
  </div>;
}

function objectPath(key: string): { directory: string; filename: string } {
  const separator = key.lastIndexOf("/");
  if (separator < 0) return { directory: "Bucket root", filename: key };
  return { directory: key.slice(0, separator) || "Bucket root", filename: key.slice(separator + 1) || key };
}

function CloudflareView({ data }: { data: CloudflareTelemetryData }) {
  const [expanded, setExpanded] = useState(false);
  const largestPrefix = data.r2.byPrefix.reduce<(typeof data.r2.byPrefix)[number] | null>((largest, item) => !largest || item.bytes > largest.bytes ? item : largest, null);
  const largestShare = largestPrefix && data.r2.totalBytes ? largestPrefix.bytes / data.r2.totalBytes * 100 : 0;
  return <>
    <div className="ops-metrics">
      <Metric label="R2 objects" value={data.r2.objectCount} />
      <Metric label="R2 stored" value={bytes(data.r2.totalBytes)} />
      <Metric label="Inventory pages" value={data.r2.pageCount} />
    </div>
    <div className="ops-grid ops-grid--cloudflare">
      <section className="ops-card ops-deployments-card">
        <PaneHeading kicker="DELIVERY LANES" title="Pages deployments" badge={`${data.pages.length} projects`} />
        {data.pages.length ? data.pages.map(page => <div className="ops-lane" key={page.projectName}>
          <div className="ops-lane-heading"><div><strong>{page.projectName}</strong><span>{page.complete ? "Complete collection" : "Partial collection"}</span></div><span>{page.deployments.length} records{page.deploymentsTruncated ? " · bounded to 30" : ""}</span></div>
          <div className="ops-deployment-list">{(expanded ? page.deployments : page.deployments.slice(0, 4)).map(item => <article className="ops-deployment" key={item.id}>
            <span className={`ops-dot ${item.status}`} aria-hidden="true" />
            <div><strong>{item.environment}</strong><span>Environment</span></div>
            <div><strong>{item.status} / {item.stage}</strong><span>Result / stage</span></div>
            <div><time>{date(item.modifiedAt)}</time><span>Modified</span></div>
          </article>)}</div>
        </div>) : <p className="ops-empty">No Pages projects were returned.</p>}
        {data.pages.some(page => page.deployments.length > 4) ? <button className="outline-button ops-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show recent deployments" : "Show all received deployments"}</button> : null}
      </section>
      <section className="ops-card ops-composition-card">
        <PaneHeading kicker="STORAGE PROFILE" title="R2 composition" badge={`${data.r2.byPrefix.length} groups`} />
        {largestPrefix ? <div className="r2-composition-visual">
          <div className="r2-gauge" style={{ "--r2-share": `${largestShare}%` } as CSSProperties}><div><strong>{largestShare.toFixed(1)}%</strong><span>largest group</span></div></div>
          <div className="r2-dominant"><span>Dominant prefix</span><strong>{largestPrefix.key}</strong><b>{bytes(largestPrefix.bytes)} / {bytes(data.r2.totalBytes)}</b></div>
        </div> : null}
        {data.r2.byPrefix.length ? data.r2.byPrefix.slice(0, 8).map(item => <div className="ops-bar-row" key={item.key}><span>{item.key}</span><div><i style={{ width: `${data.r2.totalBytes ? Math.max(item.bytes / data.r2.totalBytes * 100, 1) : 0}%` }} /></div><strong>{bytes(item.bytes)}</strong></div>) : <p className="ops-empty">No prefix groups were returned.</p>}
      </section>
    </div>
    <section className="ops-card ops-inventory-card">
      <PaneHeading kicker="OBJECT INDEX" title="R2 inventory" badge={`${data.r2.objects.length} records`} />
      <p className="ops-completeness">Collection: {data.r2.complete ? "complete" : "partial"} · {data.r2.objects.length} object records{data.r2.objectsTruncated ? " shown of the full inventory; bounded to 75" : ""}. Totals and composition cover the collected inventory.</p>
      <div className="ops-inventory">{data.r2.objects.length ? data.r2.objects.map(item => {
        const path = objectPath(item.key);
        return <article className="ops-inventory-row" key={item.key}>
          <div className="ops-inventory-primary"><code title={item.key}>{path.filename}</code><span><b>Directory</b>{path.directory}</span></div>
          <dl className="ops-inventory-meta"><div><dt>Size</dt><dd>{bytes(item.sizeBytes)}</dd></div><div><dt>Modified</dt><dd><time>{date(item.lastModifiedAt)}</time></dd></div></dl>
        </article>;
      }) : <p className="ops-empty">No objects were returned.</p>}</div>
    </section>
  </>;
}

// Built-in role labels: https://github.com/microsoft/azure-roles/blob/main/azure_roles.json (2026-09-30).
const azureRoleNames: Record<string,string> = {'8e3af657-a8ff-443c-a75c-2fe8c4bcb635':'Owner','acdd72a7-3385-48ef-bd42-f606fba81ae7':'Reader','4339b7cf-9826-4e41-b4ed-c7f4505dac08':'Artifact Signing Identity Verifier','2837e146-70d7-4cfd-ad55-7efa6464f958':'Artifact Signing Certificate Profile Signer'};
function AzureView({ data }: { data: AzureTelemetryData }) {
  return <>
    <div className="ops-metrics"><Metric label="Provisioning" value={data.provisioningState ?? "Unavailable"} /><Metric label="Signing profiles" value={data.profiles.length} /><Metric label="Role assignments" value={data.roleAssignments.length} /></div>
    <div className="ops-grid ops-grid--azure">
      <section className="ops-card"><PaneHeading kicker="CONTROL ACCOUNT" title="Artifact signing account" /><dl className="ops-list"><div><dt>Account</dt><dd>{data.accountName}</dd></div><div><dt>Resource group</dt><dd>{data.resourceGroup}</dd></div><div><dt>Location</dt><dd>{data.location ?? "Unavailable"}</dd></div></dl></section>
      <section className="ops-card"><PaneHeading kicker="SIGNING ASSETS" title="Certificate profiles" badge={`${data.profiles.length} profiles`} />{data.profiles.length ? data.profiles.map(profile => <div className="ops-record" key={profile.resourceId}><strong>{profile.name}</strong><span>{profile.profileType ?? "Type unavailable"}</span><span>{profile.status ?? "Status unavailable"}</span></div>) : <p className="ops-empty">No profiles were returned by this collection.</p>}</section>
    </div>
    <section className="ops-card permission-card">
      <PaneHeading kicker="ACCESS TOPOLOGY" title="Permission edges" badge={`${data.roleAssignments.length} assignments`} />
      <div className="permission-graph">
        <div className="permission-node account"><span>Signing account</span><strong>{data.accountName}</strong></div>
        <div className="permission-edges">{data.roleAssignments.length ? data.roleAssignments.map((role, index) => {
          const roleId = role.roleDefinitionId.split("/").at(-1)!;
          const scope = role.scope.toLowerCase() === data.resourceId.toLowerCase() ? "Signing account" : role.scope.toLowerCase().includes("/certificateprofiles/") ? `Profile / ${role.scope.split("/").at(-1)}` : role.scope.includes("/resourceGroups/") ? `Resource group / ${role.scope.split("/")[4]}` : "Subscription";
          return <div className="permission-edge" key={`${role.scope}-${role.principalId}-${role.roleDefinitionId}-${index}`}><i aria-hidden="true" /><div className="permission-node"><span>{role.principalType}</span><strong>{azureRoleNames[roleId] ?? roleId}</strong><code title={role.principalId}>{role.principalId}</code><small title={role.scope}>Scope: {scope}</small></div></div>;
        }) : <p className="ops-empty">No role assignments were returned.</p>}</div>
      </div>
      <p className="ops-completeness">Profiles: {data.profilesComplete ? "complete" : "partial"} · Roles: {data.roleAssignmentsComplete ? "complete" : "partial"}</p>
      <p className="ops-completeness">Reader access shows configuration and applicable role assignments. Signing-event history and principal display names are not available through this connection.</p>
    </section>
  </>;
}

function GoDaddyView({ data }: { data: GoDaddyTelemetryData }) {
  const created = data.createdAt ? new Date(data.createdAt).valueOf() : null, expires = data.expiresAt ? new Date(data.expiresAt).valueOf() : null;
  const lifecycle = created !== null && expires !== null && expires > created ? Math.min(Math.max((Date.now() - created) / (expires - created) * 100, 0), 100) : null;
  return <>
    <div className="ops-metrics"><Metric label="Domain status" value={data.status} /><Metric label="Expires" value={data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : "Unavailable"} /><Metric label="Name servers" value={data.nameServers.length} /></div>
    <div className="ops-grid ops-grid--domain">
      <section className="ops-card domain-route-card">
        <PaneHeading kicker="REGISTRATION WINDOW" title="Lifecycle runway" badge={data.domain} />
        <div className="domain-runway"><div><span>Created</span><strong>{date(data.createdAt)}</strong></div><div className="runway-track">{lifecycle === null ? <span>Lifecycle unavailable</span> : <i style={{ width: `${lifecycle}%` }} />}</div><div><span>Expires</span><strong>{date(data.expiresAt)}</strong></div></div>
        <h3>Name-server fanout</h3><div className="ns-fanout"><div className="ns-root"><span>Authoritative domain</span><strong>{data.domain}</strong></div><div className="ns-routes">{data.nameServers.length ? data.nameServers.map(server => <div className="ns-edge" key={server}><i aria-hidden="true" /><span>{server}</span></div>) : <p className="ops-empty">No name servers were returned.</p>}</div></div>
      </section>
      <section className="ops-card domain-protection-card"><PaneHeading kicker="REGISTRAR GUARD" title="Domain protections" /><dl className="ops-list ops-list--protections"><div><dt>Automatic renewal</dt><dd>{bool(data.autoRenew)}</dd></div><div><dt>Privacy</dt><dd>{bool(data.privacy)}</dd></div><div><dt>Transfer lock</dt><dd>{bool(data.transferLock)}</dd></div><div><dt>Renew by</dt><dd>{date(data.renewBy)}</dd></div></dl></section>
    </div>
  </>;
}

function RevenuePlot({ days }: { days: LemonSqueezyTelemetryData["live"]["byDay"] }) {
  if (!days.length) return <p className="ops-empty">No live daily totals were returned.</p>;
  const width = 760, height = 280, pad = { top: 40, right: 28, bottom: 50, left: 92 }, maxGross = Math.max(...days.map(day => day.grossCents)), scaleMax = Math.max(maxGross, 1);
  const first = Date.parse(days[0].date), span = Date.parse(days.at(-1)!.date) - first;
  const baseline = height - pad.bottom, plotWidth = width - pad.left - pad.right, plotHeight = height - pad.top - pad.bottom;
  const points = days.map(day => ({ ...day, x: span === 0 ? pad.left + plotWidth / 2 : pad.left + (Date.parse(day.date) - first) / span * plotWidth, y: baseline - day.grossCents / scaleMax * plotHeight }));
  const maxIndex = points.findIndex(point => point.grossCents === maxGross);
  const labelIndexes = new Set(days.length <= 6 ? points.map((_, index) => index) : [0, maxIndex, points.length - 1]);
  const area = `${pad.left},${baseline} ${points.map(point => `${point.x},${point.y}`).join(" ")} ${width - pad.right},${baseline}`;
  return <div className="revenue-plot"><div className="revenue-plot-scroll"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Actual daily paid-order totals across ${days.length} days`}>
    <line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={pad.top} y2={pad.top} /><line className="chart-grid" x1={pad.left} x2={width - pad.right} y1={baseline - plotHeight / 2} y2={baseline - plotHeight / 2} /><line className="chart-axis" x1={pad.left} x2={width - pad.right} y1={baseline} y2={baseline} />
    <text className="chart-scale" x={pad.left - 14} y={pad.top + 5} textAnchor="end">{money(maxGross)}</text><text className="chart-scale" x={pad.left - 14} y={baseline + 5} textAnchor="end">$0</text><text className="chart-unit" x={pad.left} y="20">GROSS / USD</text>
    <polygon className="chart-area" points={area} /><polyline className="chart-line" points={points.map(point => `${point.x},${point.y}`).join(" ")} />
    {points.map((point, index) => <g key={point.date}><circle cx={point.x} cy={point.y} r="6" className={point.grossCents === 0 ? "zero" : ""} /><title>{point.date}: {money(point.grossCents)} gross, {point.orderCount} orders</title>{labelIndexes.has(index) ? <text className="chart-value" x={point.x} y={Math.max(point.y - 14, pad.top - 10)} textAnchor="middle">{money(point.grossCents)}</text> : null}</g>)}
    <text className="chart-date" x={pad.left} y={height - 14}>{days[0].date}</text><text className="chart-date" x={width - pad.right} y={height - 14} textAnchor="end">{days.at(-1)?.date}</text>
  </svg></div><div className="revenue-legend"><strong>Paid-order totals · tax included</strong><span>Source: live mode orders</span></div></div>;
}

function LemonView({ data }: { data: LemonSqueezyTelemetryData }) {
  return <><div className="ops-metrics"><Metric label="Live orders" value={data.live.orderCount} /><Metric label="Live gross" value={money(data.live.grossCents)} /><Metric label="Live total after refunds" value={money(data.live.netCents)} /><Metric label="Test orders" value={data.test.orderCount} /></div>
    <section className="ops-card revenue-card"><PaneHeading kicker="LIVE MODE" title="Daily paid-order totals" badge={`${data.live.byDay.length} days`} /><RevenuePlot days={data.live.byDay} /><p className="ops-completeness">Paid and refunded orders only. Totals include tax and are before platform fees; these are not profit or payout figures. Refunds are attributed to the original order date.</p></section><div className="ops-grid ops-grid--commerce"><section className="ops-card"><PaneHeading kicker="ORDER MIX" title="Live order status" />{data.live.byStatus.length ? data.live.byStatus.map(item => <div className="ops-bar-row" key={item.status}><span>{item.status.replaceAll("_", " ")}</span><div><i style={{ width: `${data.live.orderCount ? Math.max(item.count / data.live.orderCount * 100, 1) : 0}%` }} /></div><strong>{item.count}</strong></div>) : <p className="ops-empty">No live order statuses were returned.</p>}<p className="ops-completeness">Collection: {data.complete ? "complete" : "partial"} · {data.pageCount} API pages</p></section>
      <section className="ops-card"><PaneHeading kicker="CATALOG SIGNAL" title="Products / first order item" />{data.live.byProduct.length ? data.live.byProduct.slice(0, 8).map(item => <div className="ops-record" key={`${item.productId}-${item.variantId}`}><strong>{item.productName}</strong><span>{item.variantName}</span><span>{item.orderCount} orders · {money(item.grossCents)}</span></div>) : <p className="ops-empty">No live product totals were returned.</p>}</section></div></>;
}

export function OperationsEnvironment({ surface, active, children }: { surface: ProviderSurface; active: boolean; children?: React.ReactNode }) {
  const [response, setResponse] = useState<OperationsResponse | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const inFlight = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    const request = ++generation.current, abort = new AbortController(); controller.current = abort; inFlight.current = true; setLoading(true);
    let timedOut = false; const timeout = window.setTimeout(() => { timedOut = true; abort.abort(); }, 8_000);
    try { const result = await fetch("/api/operations?surface=" + surface, { cache: "no-store", signal: abort.signal, headers: manual ? { "X-SecDash-Review": "1" } : undefined }); if (result.status === 403) { setResponse(null); throw new Error("Access denied (403). Your access to this view has changed."); } if (!result.ok) throw new Error("Operations telemetry is unavailable."); const payload: unknown = await result.json(); if (!validResponse(payload)) throw new Error("Operations telemetry returned an invalid response."); if (request === generation.current) { setResponse(payload); setError(""); } }
    catch (reason) { if (request === generation.current && (timedOut || !(reason instanceof DOMException && reason.name === "AbortError"))) setError(timedOut ? "Operations telemetry timed out. The last valid observation is preserved." : reason instanceof Error ? reason.message : "Operations telemetry is unavailable."); }
    finally { window.clearTimeout(timeout); if (request === generation.current) { inFlight.current = false; controller.current = null; setLoading(false); } }
  }, [surface]);
  useEffect(() => { if (!active) return; const initial = window.setTimeout(() => void refresh(), 0), timer = window.setInterval(() => void refresh(), 5_000); return () => { window.clearTimeout(initial); window.clearInterval(timer); generation.current++; controller.current?.abort(); controller.current = null; inFlight.current = false; }; }, [active, refresh]);
  const record = response?.surfaces[surface], latest = record?.latest, success = record?.latestSuccess, config = LABELS[surface], Icon = config.icon;
  const stale = !!(success && response && new Date(response.serverTime).valueOf() - new Date(success.observedAt).valueOf() > 45 * 60_000);
  return <div className="ops-environment" data-surface={surface}><div className="view-heading drive-heading"><div><p className="eyebrow">{config.eyebrow}</p><h1>{config.title}<span className="heading-dot">.</span></h1></div><button className="outline-button" onClick={() => void refresh(true)} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Refreshing" : "Refresh feed"}</button></div>{children}
    <div className={`feed-status ${error ? "unavailable" : latest?.status === "error" ? "error" : stale ? "stale" : latest?.status ?? "pending"}`}><Icon size={18} /><div><strong>{error ? "Dashboard feed unavailable" : latest?.status === "error" ? "Latest collection failed" : stale ? "Last successful collection is stale" : latest?.status === "ok" ? "Collection complete" : latest?.status === "partial" ? "Partial provider collection" : "Awaiting first observation"}</strong><span>{error || (latest ? `Observed ${date(latest.observedAt)} · received ${date(latest.receivedAt)}` : "No provider observation has been delivered.")}</span></div><span className="feed-cadence">Source: n8n · collects every 15 min<br />Display updates every 5 sec</span></div>
    {!success ? <section className="ops-awaiting"><AlertTriangle size={31} /><h2>No successful provider data</h2><p>Values and diagrams remain unavailable until n8n delivers a validated observation.</p></section> : <>{surface === "cloudflare" ? <CloudflareView data={success.data as CloudflareTelemetryData} /> : surface === "azure" ? <AzureView data={success.data as AzureTelemetryData} /> : surface === "godaddy" ? <GoDaddyView data={success.data as GoDaddyTelemetryData} /> : <LemonView data={success.data as LemonSqueezyTelemetryData} />}<div className="ops-proof"><CheckCircle2 size={16} /> Last successful observation {date(success.observedAt)} · {record?.history.length ?? 0} recent observations returned</div></>}
  </div>;
}
