"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Activity, ArrowUpRight, Check, ChevronRight, Cloud, CreditCard, DatabaseBackup, Gauge, Globe, HardDrive, Mail, Monitor, RefreshCw, ShieldCheck, TriangleAlert, Workflow, X } from "lucide-react";
import { attentionRevision, backupAttentionRevision, feedAttentionRevision, visibleAttention } from "@/lib/attention";
import { deriveCommandDeck, type CommandDeckFeedState } from "@/lib/command-deck";
import { useCommandDeckFeed } from "@/lib/use-command-deck-feed";
import { deriveDriveStorageMetrics, isDriveStorageStale } from "@/lib/drive-storage";
import { projectAiUsage } from "@/lib/ai-usage";
import { channels, type Category, type Message } from "@/lib/dashboard";
import type { ProviderSurface } from "@/lib/provider-telemetry";
import "./command-deck.css";

type Props = { revision?: number; active: boolean; onSection: (section: string) => void; onOperation: (surface: ProviderSurface | "n8n") => void; onFeedbackReport: (messageId: string) => void; onMail: (category: Category, message?: Message) => void };
const providerLabels = { cloudflare: "Cloudflare", azure: "Azure", godaddy: "GoDaddy", lemonsqueezy: "Lemon Squeezy", recovery: "n8n / recovery" };
const stateLabels = { ok: "Current", partial: "Partial", error: "Collection failed", stale: "Stale", unavailable: "Unavailable" };
function stamp(value?: string | null) { return value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "No observation"; }
function age(value: string | null | undefined, now: number) { if (!value) return "Awaiting data"; const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000)); return minutes < 1 ? "Just observed" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`; }
function money(cents: number | undefined) { return cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function bytes(value: number | null | undefined) { if (value == null) return "—"; if (value === 0) return "0 B"; const order = Math.min(4, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** order).toFixed(order >= 3 ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][order]}`; }
function FeedTag({ state }: { state: CommandDeckFeedState }) { return <span className={`deck-feed-tag tone-${state}`}><i />{stateLabels[state]}</span>; }
function Panel({ title, code, children, className = "", action }: { title: string; code: string; children: ReactNode; className?: string; action?: () => void }) {
  return <section className={`deck-panel ${className}`} aria-label={title}><header className="deck-panel-header"><div><span className="deck-code">{code}</span><h2>{title}</h2></div>{action && <button className="deck-open" onClick={action} aria-label={`Open ${title}`}><ArrowUpRight size={21} /></button>}</header>{children}</section>;
}
function OrbitGauge({ fraction, value, label, violet = false }: { fraction: number | null; value: string; label: string; violet?: boolean }) {
  const radius = 66, circumference = 2 * Math.PI * radius;
  return <div className={`deck-orbit ${violet ? "violet" : ""}`}><svg viewBox="0 0 180 180" aria-hidden="true"><circle className="orbit-guide" cx="90" cy="90" r="83" /><circle className="orbit-ticks" cx="90" cy="90" r="77" /><circle className="orbit-track" cx="90" cy="90" r={radius} />{fraction !== null && <circle className="orbit-value" cx="90" cy="90" r={radius} strokeDasharray={`${Math.min(1, Math.max(0, fraction)) * circumference} ${circumference}`} transform="rotate(-90 90 90)" />}</svg><div><strong>{value}</strong><span>{label}</span></div></div>;
}
function SalesPlot({ days }: { days: { date: string; grossCents: number; refundedCents: number }[] }) {
  const id = useId().replaceAll(":", "");
  if (!days.length) return <div className="deck-plot-empty">No paid-order history in this observation.</div>;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const start = Date.parse(sorted[0].date), end = Date.parse(sorted.at(-1)!.date), peak = Math.max(...sorted.map(d => Math.max(d.grossCents, d.refundedCents)), 1);
  const point = (d: typeof sorted[number], refunded = false) => [24 + (end === start ? .5 : (Date.parse(d.date) - start) / (end - start)) * 552, 160 - ((refunded ? d.refundedCents : d.grossCents) / peak) * 126];
  const line = sorted.map(d => point(d).join(",")).join(" ");
  const first = point(sorted[0]), last = point(sorted.at(-1)!);
  return <><div className="deck-chart-labels"><span>{money(peak === 1 && sorted.every(d => !d.grossCents && !d.refundedCents) ? 0 : peak)}</span><span>Daily totals · USD</span></div><svg className="deck-sales-plot" viewBox="0 0 600 190" role="img" aria-label={`Daily gross sales and refunds from ${sorted[0].date} to ${sorted.at(-1)!.date}`} aria-describedby={`${id}-values`}><desc id={`${id}-values`}>{sorted.map(d => `${d.date}: gross ${money(d.grossCents)}, refunds ${money(d.refundedCents)}.`).join(" ")}</desc><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#82e8ed" stopOpacity=".28" /><stop offset="1" stopColor="#82e8ed" stopOpacity="0" /></linearGradient></defs>{[34, 76, 118, 160].map(y => <path key={y} d={`M24 ${y}H576`} className="deck-chart-grid" />)}<polygon points={`${first[0]},160 ${line} ${last[0]},160`} fill={`url(#${id})`} /><polyline points={line} className="deck-gross-line" />{sorted.map(d => { const [x, y] = point(d); const [, refundY] = point(d, true); return <g key={d.date}><title>{d.date}: gross {money(d.grossCents)}; refunds {money(d.refundedCents)}</title>{d.refundedCents > 0 && <path d={`M${x} 160V${refundY}`} className="deck-refund-line" />}<circle cx={x} cy={y} r="4" className="deck-chart-point" /></g>; })}</svg><div className="deck-chart-labels"><span>{sorted[0].date}</span><span>{sorted.at(-1)!.date}</span></div><div className="deck-legend"><span><i />Gross sales</span><span><i className="refund" />Refunds</span></div></>;
}

export function CommandDeck({ revision = 0, active, onSection, onOperation, onFeedbackReport, onMail }: Props) {
  const feed = useCommandDeckFeed(active,revision);
  const [now, setNow] = useState(() => Date.now());
  const [dismissing, setDismissing] = useState<Set<string>>(() => new Set());
  useEffect(() => { if (!active) return; const timer = window.setInterval(() => setNow(Date.now()), 5_000); return () => window.clearInterval(timer); }, [active]);
  const model = useMemo(() => deriveCommandDeck(feed.operations, now), [feed.operations, now]);
  const state = (surface: keyof typeof model.feeds): CommandDeckFeedState => feed.errors.operations ? "unavailable" : model.feeds[surface].state;
  const driveSample = feed.drive?.latestSuccess ?? null, quota = deriveDriveStorageMetrics(driveSample);
  const driveState: CommandDeckFeedState = feed.errors.drive ? "unavailable" : feed.drive?.latest?.status === "error" ? "error" : !quota ? "unavailable" : isDriveStorageStale(driveSample, now) ? "stale" : "ok";
  const sales = model.sales.live, usage = model.ai.usage, projection = usage ? projectAiUsage(usage) : null;
  const aiState = feed.errors.operations ? "unavailable" : model.ai.feed.state;
  const mail = feed.mail, recent = [...(mail?.messages ?? [])].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 3);
  const mailCount = mail?.lastSync ? channels.reduce((sum, channel) => sum + (mail.counts[channel.id] ?? 0), 0) : null;
  const feedback = mail?.feedback;
  const automationEvidence = state("recovery") === "ok" ? "" : `Last known · ${age(model.automation.feed.dataObservedAt, now)} · `;
  const attentionCandidates: { identity: string; conditionRevision: string; title: string; detail: string; open: () => void }[] = [];
  const addAttention = (identity: string, conditionRevision: string, title: string, detail: string, open: () => void) => {
    attentionCandidates.push({ identity, conditionRevision, title, detail, open });
  };
  if (feed.errors.operations) addAttention("connection:operations", feedAttentionRevision("unavailable", feed.errors.operations), "Telemetry connection unavailable", "Last received readings are retained.", () => onOperation("n8n"));
  else for (const surface of Object.keys(model.feeds) as (keyof typeof model.feeds)[]) {
    const item = model.feeds[surface];
    if (item.state !== "ok") addAttention(`feed:${surface}`, feedAttentionRevision(item.state, item.errorCode), `${providerLabels[surface]} · ${stateLabels[item.state].toLowerCase()}`, `${item.errorCode?.replaceAll("_", " ") ?? "Check the latest collection"} · ${age(item.observedAt, now)}`, () => surface === "recovery" ? onOperation("n8n") : onOperation(surface));
  }
  if (driveState !== "ok") addAttention("feed:google-drive", feedAttentionRevision(driveState, feed.drive?.latest?.status === "error" ? feed.drive.latest.errorCode : null), `Google storage · ${stateLabels[driveState].toLowerCase()}`, "Quota readings need attention.", () => onSection("storage"));
  if (feed.errors.mail) addAttention("connection:mail", feedAttentionRevision("unavailable", feed.errors.mail), "Mailbox feed unavailable", "Saved messages remain in their source.", () => onSection("communications"));
  if (!feed.errors.mail) for (const report of mail?.attentionFeedbackObstructions ?? []) {
    addAttention(
      `feedback-obstruction:${report.messageId}`,
      attentionRevision([report.sourceFingerprint, report.analyzedAt]),
      report.subject || "Beta obstruction report",
      `${report.context} · received ${stamp(report.receivedAt)}`,
      () => onFeedbackReport(report.messageId),
    );
  }
  if (model.automation.inactive) {
    const inactiveIds = model.automation.attention.filter(item => item.reason === "inactive").map(item => item.workflowId).sort();
    addAttention("automation:inactive", attentionRevision(inactiveIds), `${automationEvidence}${model.automation.inactive} monitored workflow${model.automation.inactive === 1 ? " is" : "s are"} inactive`, "Review the monitored automation inventory.", () => onOperation("n8n"));
  }
  if (model.automation.failureCount24h) addAttention("automation:failed-runs", attentionRevision([model.automation.failureCount24h, model.automation.lastExecution?.workflowId, model.automation.lastExecution?.status, model.automation.lastExecution?.startedAt]), `${automationEvidence}${model.automation.failureCount24h} retained workflow failure${model.automation.failureCount24h === 1 ? "" : "s"}`, `24-hour window ending ${stamp(model.automation.feed.dataObservedAt)}.`, () => onOperation("n8n"));
  if (feed.errors.catalog || feed.catalog?.source.status === "error" || feed.catalog?.source.status === "stale" || feed.catalog?.update.state === "failed") addAttention("backup:status", backupAttentionRevision({ readError: feed.errors.catalog, sourceStatus: feed.catalog?.source.status, sourceDetail: feed.catalog?.source.detail, updateState: feed.catalog?.update.state, updateJobId: feed.catalog?.update.jobId }), "Backup status needs review", feed.errors.catalog || feed.catalog?.source.detail || "Last update failed.", () => onSection("storage"));
  for (const library of feed.catalog?.libraries.filter(item => item.mode === "active-sync") ?? []) {
    for (const destination of library.destinations) {
      if (!destination.lastSnapshot || destination.status === "error" || destination.lastVerification?.status === "failed") addAttention(`backup:${library.id}:${destination.id}`, attentionRevision([destination.status, destination.lastSnapshot?.snapshotId, destination.lastVerification?.status, destination.lastVerification?.snapshotId]), `${library.name} · ${destination.label}`, !destination.lastSnapshot ? "Backup copy pending; no snapshot recorded at this destination." : "Backup or verification failure reported.", () => onSection("storage"));
    }
  }
  const attention = visibleAttention(attentionCandidates, feed.attentionDismissals);
  const dismiss = async (identity: string, conditionRevision: string) => {
    setDismissing(current => new Set(current).add(identity));
    await feed.dismissAttention(identity, conditionRevision);
    setDismissing(current => { const next = new Set(current); next.delete(identity); return next; });
  };
  const sources = [
    { id: "lemonsqueezy", label: "Commerce", provider: "Lemon Squeezy", icon: CreditCard, status: state("lemonsqueezy"), observed: model.feeds.lemonsqueezy.dataObservedAt },
    { id: "cloudflare", label: "Edge & delivery", provider: "Cloudflare", icon: Cloud, status: state("cloudflare"), observed: model.feeds.cloudflare.dataObservedAt },
    { id: "azure", label: "Artifact signing", provider: "Azure", icon: ShieldCheck, status: state("azure"), observed: model.feeds.azure.dataObservedAt },
    { id: "godaddy", label: "Domain", provider: "GoDaddy", icon: Globe, status: state("godaddy"), observed: model.feeds.godaddy.dataObservedAt },
    { id: "drive", label: "Storage", provider: "Google Drive", icon: HardDrive, status: driveState, observed: driveSample?.observedAt },
  ];
  const currentSources = sources.filter(s => s.status === "ok").length;
  return <div className="command-deck">
    <div className="deck-heading"><div><p className="deck-code">SecDash / OPERATOR OVERVIEW</p><h1>DASHBOARD<span>.</span></h1><p>Every surface. One operational picture.</p></div><button className="outline-button" disabled={feed.refreshing} onClick={() => void feed.refresh()}><RefreshCw size={18} className={feed.refreshing ? "spin" : ""} />Refresh readings</button></div>
    <div className="deck-sync"><span><i className={feed.refreshedAt ? "" : "pending"} />{feed.refreshedAt ? `Display checked ${new Date(feed.refreshedAt).toLocaleTimeString()}` : "Connecting to your feeds"}</span><span>n8n observations · display checks every 5s</span></div>
    <section className={`deck-attention ${attention.length ? "has-attention" : ""}`} aria-label="Needs attention"><header><TriangleAlert size={20} /><h2>Needs attention</h2><span>{feed.refreshedAt ? attention.length : "—"}</span></header>{!feed.refreshedAt ? <p>Waiting for the first feed check.</p> : attention.length ? <div>{attention.map(item => <div className="deck-attention-item" key={item.identity}><button className="deck-attention-open" onClick={item.open}><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={18} /></button><button className="deck-attention-dismiss" disabled={dismissing.has(item.identity)} onClick={() => void dismiss(item.identity, item.conditionRevision)} aria-label={`Dismiss ${item.title}`} title="Dismiss this notification"><X size={17} /></button></div>)}</div> : <p><Check size={18} />No undismissed collection or workflow flags reported. Mail priority is not configured.</p>}{feed.errors.attention && <p className="deck-attention-error">{feed.errors.attention}</p>}</section>
    <div className="deck-readouts">
      <button onClick={() => onOperation("lemonsqueezy")}><CreditCard /><div><span>Sales after refunds</span><strong>{money(sales?.netCents)}</strong><small>Live-mode orders · USD · before fees</small></div><FeedTag state={state("lemonsqueezy")} /></button>
      <button onClick={() => onSection("communications")}><Mail /><div><span>Saved inbox</span><strong>{mailCount?.toLocaleString() ?? "—"}</strong><small>Across all six message categories</small></div><span className="deck-readout-note">{feed.errors.mail ? "Feed unavailable" : "Stored messages"}</span></button>
      <button onClick={() => onSection("accounts")}><Activity /><div><span>Current provider feeds</span><strong>{feed.refreshedAt ? currentSources : "—"}<em>/ 5</em></strong><small>Fresh, complete provider observations</small></div><span className="deck-readout-note">{mail ? Object.keys(mail.providerConnections).length : "—"} verified identities</span></button>
    </div>
    <div className="deck-primary-grid">
      <Panel title="The operational circuit" code="01 / PIPELINE TOPOLOGY" className="deck-circuit" action={() => onOperation("n8n")}>
        <div className="deck-topology"><div className="deck-source-stack">{sources.map(source => <button key={source.id} className={`deck-source tone-${source.status}`} onClick={() => source.id === "drive" ? onSection("storage") : onOperation(source.id as ProviderSurface)}><source.icon size={19} /><span><strong>{source.provider}</strong><small>{source.label} · {age(source.observed, now)}</small></span><i title={stateLabels[source.status]} /><span className="sr-only">{stateLabels[source.status]}</span></button>)}</div><div className="deck-core"><div className={`deck-core-orbit tone-${state("recovery")}`}><OrbitGauge fraction={model.automation.monitored ? (model.automation.active ?? 0) / model.automation.monitored : null} value={model.automation.active == null ? "—" : `${model.automation.active}/${model.automation.monitored}`} label="workflows active" /><span className="deck-core-label"><Workflow size={18} />n8n</span></div><FeedTag state={state("recovery")} /><span className="deck-core-age">{age(model.automation.feed.dataObservedAt, now)}</span><div className="deck-terminal"><Monitor size={23} /><span><strong>LOCAL INTERFACE</strong><small>This Mac · private connection</small></span></div></div></div>
        <p className="deck-note">Providers → n8n → SecDash. Provider collection: 15 min; storage and recovery: 5 min. {model.automation.executionHistoryAvailable === false ? "Execution history is unavailable; active workflows do not confirm successful runs." : "Open n8n for retained execution evidence."}</p>
      </Panel>
      <Panel title="Commerce signal" code="02 / LEMON SQUEEZY" className="deck-commerce" action={() => onOperation("lemonsqueezy")}>
        <div className="deck-commerce-facts"><div><span>Gross sales</span><strong>{money(sales?.grossCents)}</strong></div><div><span>Refunds</span><strong className="deck-refund-value">{money(sales?.refundedCents)}</strong></div></div>
        {sales ? <SalesPlot days={sales.byDay} /> : <div className="deck-plot-empty">Awaiting a valid commerce observation.</div>}
        <div className="deck-panel-bottom"><span>{sales ? `${sales.orderCount} live-mode orders` : "Orders unavailable"}</span><FeedTag state={state("lemonsqueezy")} /></div><p className="deck-note">Observed {stamp(model.sales.feed.dataObservedAt)}. Includes tax; before platform fees. Refunds follow the original order date.</p>
      </Panel>
    </div>
    <div className="deck-secondary-grid">
      <Panel title="Google storage" code="03 / CAPACITY" className="deck-storage" action={() => onSection("storage")}><div className="deck-gauge-row"><OrbitGauge fraction={quota?.usedFraction ?? null} value={quota?.usedFraction != null ? `${(quota.usedFraction * 100).toFixed(1)}%` : "—"} label="capacity used" /><div className="deck-gauge-facts"><span>Available</span><strong>{bytes(quota?.availableBytes)}</strong><small>{bytes(quota?.usedBytes)} used<br />{quota?.limitBytes != null ? `${bytes(quota.limitBytes)} total` : "No limit reported"}</small></div></div><FeedTag state={driveState} /><p className="deck-note">Google account storage across services.<br />Observed {stamp(driveSample?.observedAt)}</p></Panel>
      <Panel title="AI usage" code="04 / BUDGET INSTRUMENT" className="deck-ai" action={() => onOperation("n8n")}><div className="deck-gauge-row"><OrbitGauge fraction={projection ? projection.monthUsedPercent / 100 : null} value={projection ? `${projection.monthUsedPercent.toFixed(1)}%` : "—"} label="month used" violet /><div className="deck-gauge-facts"><span>{usage?.monthKey ?? "Monthly usage"}</span><strong>{usage ? `$${usage.month.estimatedCostUsd.toFixed(4)}` : "—"}</strong><small>{usage ? `of $${usage.limits.perMonthUsd.toFixed(2)} cap` : "No usage delivered"}<br />{usage ? `$${usage.reservedMonthUsd.toFixed(4)} reserved` : ""}</small></div></div><div className="deck-projection"><span>Yearly projection{projection?.provisional ? " · provisional" : ""}</span><strong>{projection?.annualizedUsd != null ? `$${projection.annualizedUsd.toFixed(2)}` : "—"}<small>/ year</small></strong></div><FeedTag state={aiState} /><p className="deck-note">Recurring mail-routing model estimates.<br />Measured {stamp(usage?.measuredAt)}</p></Panel>
      <Panel title="Backup integrity" code="05 / RECOVERY" className="deck-backups" action={() => onSection("storage")}>
        {feed.catalog ? <div className="deck-backup-list">{feed.catalog.libraries.filter(library => library.mode === "active-sync").map(library => <div key={library.id}><h3><DatabaseBackup size={17} />{library.name}</h3>{library.destinations.map(destination => { const exact = !!destination.lastSnapshot && ((destination.lastVerification?.status === "passed" && destination.lastVerification.snapshotId === destination.lastSnapshot.snapshotId) || (library.id === "dashboard-n8n" && model.backups.latestRestore?.ok && model.backups.latestRestore.snapshotId === destination.lastSnapshot.snapshotId)); return <div className="deck-backup-destination" key={destination.id}><span>{destination.label}<small>{stamp(destination.lastSnapshot?.createdAt)}</small></span><b className={exact ? "verified" : "pending"}>{exact ? <><ShieldCheck size={15} />Verified</> : destination.lastVerification?.status === "failed" ? "Failed" : destination.lastSnapshot ? "Unverified" : "Pending"}</b></div>; })}</div>)}</div> : <p className="deck-note">Awaiting backup destinations.</p>}
        <div className="deck-backup-progress"><span><Activity size={16} />{feed.catalog?.update.state === "running" ? "Update in progress" : "Backup activity"}</span><p>{feed.catalog?.update.state === "running" ? feed.catalog.update.summary : feed.catalog?.libraries.find(library => library.id === "cold-storage" && library.phase !== "complete")?.summary || feed.catalog?.update.summary || "No update status received."}</p></div>
        <button className="deck-text-button" onClick={() => onSection("storage")}>Backup controls &amp; history <ChevronRight size={18} /></button><p className="deck-note">{feed.errors.catalog || feed.catalog?.source.detail || "Awaiting recovery feed."}</p>
      </Panel>
    </div>
    <Panel title="Communications" code="06 / INBOX SIGNALS" className="deck-mail" action={() => onSection("communications")}>
      <button className="deck-feedback-brief" onClick={() => onSection("feedback")}><div><span className="deck-code">FEEDBACK / EXPERIENCE EVIDENCE</span><strong>{feedback ? `${feedback.counts.beta} beta · ${feedback.counts.customer} customer · ${feedback.counts.unclassified} audience unclear` : "Feedback assessment not yet available"}</strong><small>{feed.errors.mail ? "Feed unavailable · last received counts retained" : feedback ? `${feedback.assessedMessages} of ${feedback.totalMessages} saved messages assessed · ${feedback.awaitingAnalysis} beta awaiting analysis · last analysis ${stamp(feedback.lastAnalyzedAt)}` : "Open Feedback to inspect the analysis feed."}</small></div><ArrowUpRight size={22} /></button>
      <div className="deck-mail-grid"><div><div className="deck-mail-categories">{channels.map(channel => <button key={channel.id} onClick={() => onMail(channel.id)}><span>{channel.name}</span><strong>{mail?.lastSync ? mail.counts[channel.id] ?? 0 : "—"}</strong><ChevronRight size={16} /></button>)}</div><p className="deck-note"><Gauge size={16} />Priority and awaiting-reply rules are not configured. Category counts are saved messages, not unresolved incidents.</p></div><div className="deck-recent"><h3>Latest received</h3>{recent.length ? recent.map(message => <button key={message.id} onClick={() => onMail(message.category, message)}><span><strong>{message.subject}</strong><small>{message.sender}</small></span><time>{stamp(message.receivedAt)}</time></button>) : <p className="deck-note">No messages available.</p>}<p className="deck-note">{feed.errors.mail || `Last mailbox delivery ${stamp(mail?.lastSync)}${mail?.hasMore ? " · recent 500 available" : ""}`}</p></div></div>
    </Panel>
  </div>;
}
