"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, ArrowRight, Radio, Mail, ShieldCheck, RefreshCw, HardDrive, Globe, KeyRound, Inbox, CircleHelp, ChevronRight, Search, AlertTriangle, Cloud, CreditCard, Workflow, Gauge, Users, Layers, FolderOpen, Radar, MessageSquareText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDashboardTools } from "@/lib/use-dashboard-tools";
import { channels, accounts, type Message, type ProviderConnections, type ProviderKey } from "@/lib/dashboard";
import type { BackupStatus } from "@/lib/backups";
import { N8nEnvironment } from "@/components/n8n-environment";
import { OperationsEnvironment } from "@/components/operations-environments";
import type { ProviderSurface } from "@/lib/provider-telemetry";
import { DriveEnvironment } from "@/components/drive-environment";
import { CommandDeck } from "@/components/command-deck";
import { releaseSites } from "@/lib/release-sites";
import { PublishedRelease } from "@/components/published-release";
import { FeedbackEnvironment } from "@/components/feedback-environment";

import { TeamSettings } from "./team-settings";
import { accountSections, type DemoAccount } from "@/lib/demo-permissions";
const privateSections = ["command", "communications", "feedback", "accounts", "website", "storage", "operations"];
const railMediaQuery = "(min-width: 761px)";
function subscribeRailLayout(listener: () => void) {
  const query = window.matchMedia(railMediaQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function readRailLayout() { return window.matchMedia(railMediaQuery).matches; }
function serverRailLayout() { return true; }

export default function Dashboard({ revision = 0, account }: { revision?: number; account?: DemoAccount } = {}) {
  const verticalRail = useSyncExternalStore(subscribeRailLayout, readRailLayout, serverRailLayout);
  const role = account?.role;
  const sections: readonly string[] = useMemo(() => account ? accountSections(account) : privateSections, [account]);
  const home = sections.includes("command") ? "command" : "communications";
  const [view, selectView] = useState(home);
  const [accessResult, setAccessResult] = useState('');
  const lostSection = !sections.includes(view);
  async function refreshRestricted() {
    const route = view === 'deployments' ? '/api/operations?surface=cloudflare' : '/api/backups';
    try {
      const response = await fetch(route, { cache: 'no-store' });
      setAccessResult(response.status === 403 ? 'Access denied (403).' : response.ok ? 'Access restored.' : 'Your session could not refresh this view.');
    } catch { setAccessResult('The connection failed. Try again.'); }
  }
  const setView = useCallback((next: string) => {
    if (sections.includes(next)) { setAccessResult(''); selectView(next); }
  }, [sections]);
  const canUseStorage = sections.includes("storage");
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  useDashboardTools(setView, sections);
  const [operation, setOperation] = useState<ProviderSurface | "n8n">("cloudflare");
  function openOperation(surface: ProviderSurface | "n8n") { if (surface === "cloudflare" && role) setView("deployments");
    else { setOperation(surface); setView("operations"); } }
  const [channel, setChannel] = useState("beta");
  const [selected, setSelected] = useState<Message | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [help, setHelp] = useState<string | null>(null);
  const [coverage, setCoverage] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [providerConnections, setProviderConnections] = useState<ProviderConnections>({});
  const selectionVersion = useRef(0);
  const [reading, setReading] = useState(false);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState("");
  async function refreshBackup() {
    try {
      const response = await fetch("/api/backups", { cache: "no-store" });
      if (!response.ok) throw new Error("Backup status is unavailable. Check that the local backup service is running.");
      setBackup(await response.json() as BackupStatus); setBackupError("");
    } catch (e) { setBackupError(e instanceof Error ? e.message : "Backup status is unavailable."); }
  }
  async function startBackup() {
    setBackupLoading(true); setBackupError("");
    try {
      const response = await fetch("/api/backups", { method: "POST" });
      if (response.status === 403) throw new Error("Access denied (403). You need permission to start a backup.");
      if (!response.ok) throw new Error("The backup could not be started. Check the local backup service and try again.");
      setBackup(await response.json() as BackupStatus);
    } catch (e) { setBackupError(e instanceof Error ? e.message : "The backup could not be started."); }
    finally { setBackupLoading(false); }
  }
  async function readMessage(message: Message) {
    const version = ++selectionVersion.current;
    setSelected(message); setReading(true); setError("");
    try {
      const response = await fetch(`/api/messages/${message.id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load this message. Select it again to retry.");
      const data = await response.json() as { message: Message };
      if (version === selectionVersion.current) setSelected(data.message);
    } catch (e) { if (version === selectionVersion.current) setError(e instanceof Error ? e.message : "Could not read message."); }
    finally { if (version === selectionVersion.current) setReading(false); }
  }
  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("The local inbox could not be loaded. Your saved messages have been kept. Try refreshing.");
      const data = await response.json() as { messages: Message[]; lastSync: string | null; hasMore: boolean; counts: Record<string,number>; providerConnections: ProviderConnections };
      setMessages(data.messages); setLastSync(data.lastSync); setCoverage(data.hasMore); setCounts(data.counts); setProviderConnections(data.providerConnections ?? {});
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the inbox."); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [revision]);
  useEffect(() => {
    if (!canUseStorage) return;
    const timer = window.setTimeout(() => void refreshBackup(), 0);
    return () => window.clearTimeout(timer);
  }, [canUseStorage]);
  useEffect(() => {
    if (backup?.state !== "running") return;
    const timer = window.setTimeout(() => void refreshBackup(), 2000);
    return () => window.clearTimeout(timer);
  }, [backup]);
  const filtered = useMemo(() => {
    const rows = messages.filter(m => m.category === channel && `${m.subject} ${m.sender} ${m.body}`.toLowerCase().includes(query.toLowerCase()));
    // A Feedback result may be older than the recent-mail window.
    if (!query && selected?.category === channel && !rows.some(m => m.id === selected.id)) return [selected, ...rows];
    return rows;
  }, [messages, channel, query, selected]);
  const displayAccounts = useMemo(() => accounts.map(account => {
    const provider = ("provider" in account ? account.provider : undefined) as ProviderKey | undefined;
    if (!provider) return { ...account, status: revision ? "Simulated" : account.status, checkedAt: null };
    const connection = providerConnections[provider];
    return { ...account, status: connection?.status === "verified" ? "Verified" : "Pending", checkedAt: connection?.checkedAt ?? null };
  }), [providerConnections, revision]);
  const currentChannel = channels.find(c => c.id === channel)!;
  const hasData = lastSync !== null;
  const chosenAccount = displayAccounts.find(a => a.id === help);
  return <main data-view={view} className={`cockpit ${["command", "feedback", "storage", "operations", "deployments"].includes(view) ? "storage-focused" : ""}`}>
    <header className="masthead">
      <button className="wordmark" onClick={() => setView(home)} aria-label="SecDash home"><Layers size={34} aria-hidden="true" /><span>SecDash<span className="wordmark-small">SECURITY DASHBOARD</span></span></button>
      <div className="session"><span className="indicator" /> {revision ? "DEMO WORKSPACE" : "PRIVATE / MAC ACCESS"} <span className="session-divider">/</span> <span>01</span></div>
    </header>
    <Tabs value={view} onValueChange={next => { if (next === "feedback") setFeedbackTarget(null); setView(next); }} orientation={verticalRail ? "vertical" : "horizontal"} className="main-tabs">
      <TabsList className="navigation" aria-label="SecDash sections">
        <div className="rail-caption" aria-hidden="true"><span>SecDash</span><strong>SECURITY<br />DASHBOARD</strong><i /></div>
        {sections.includes("command") && <TabsTrigger value="command"><span className="nav-index">00 / OVERVIEW</span><Radar aria-hidden="true" /><span className="nav-label">Overview</span></TabsTrigger>}
        {sections.includes("communications") && <TabsTrigger value="communications"><span className="nav-index">01 / MAIL</span><Mail aria-hidden="true" /><span className="nav-label">Communications</span></TabsTrigger>}
        {sections.includes("feedback") && <TabsTrigger value="feedback"><span className="nav-index">01B / FEEDBACK</span><MessageSquareText aria-hidden="true" /><span className="nav-label">Feedback</span></TabsTrigger>}
        {sections.includes("accounts") && <TabsTrigger value="accounts"><span className="nav-index">02 / ACCESS</span><Layers aria-hidden="true" /><span className="nav-label">Accounts</span></TabsTrigger>}
        {sections.includes("website") && <TabsTrigger value="website"><span className="nav-index">03 / DELIVERY</span><FolderOpen aria-hidden="true" /><span className="nav-label">Website &amp; releases</span></TabsTrigger>}
        {sections.includes("deployments") && <TabsTrigger value="deployments"><span className="nav-index">03B / EDGE</span><Cloud aria-hidden="true" /><span className="nav-label">Deployments</span></TabsTrigger>}
        {sections.includes("storage") && <TabsTrigger value="storage"><span className="nav-index">04 / RECOVERY</span><HardDrive aria-hidden="true" /><span className="nav-label">Storage &amp; recovery</span></TabsTrigger>}
        {sections.includes("operations") && <TabsTrigger value="operations"><span className="nav-index">05 / TELEMETRY</span><Gauge aria-hidden="true" /><span className="nav-label">Operations</span></TabsTrigger>}
        {sections.includes("teams") && <TabsTrigger value="teams"><Users aria-hidden="true" /><span className="nav-label">Teams</span></TabsTrigger>}
        <div className="rail-foot" aria-hidden="true"><span>LOCAL INTERFACE</span><b>{revision ? "SIMULATION" : "PRIVATE EDITION"}</b><i /></div>
      </TabsList>
      {sections.includes("teams") && <TabsContent value="teams" className="view"><TeamSettings /></TabsContent>}
      {lostSection && <section className="view" role="region" aria-label="Access changed">
        <h1>Access changed</h1><p>Your access to {view === 'deployments' ? 'Deployments' : 'Storage & recovery'} has changed.</p>
        <button className="outline-button" onClick={() => void refreshRestricted()}>Refresh feed</button>
        <p role="status">{accessResult}</p>
      </section>}
      {sections.includes("command") && <TabsContent value="command" className="view">
        <CommandDeck revision={revision} active={view === "command"} onSection={section => { if (section === "feedback") setFeedbackTarget(null); setView(section); }} onOperation={openOperation} onFeedbackReport={messageId => { setFeedbackTarget(messageId); setView("feedback"); }} onMail={(category, message) => { selectionVersion.current++; setReading(false); setChannel(category); setSelected(null); setQuery(""); setView("communications"); void refresh(); if (message) void readMessage(message); }} />
      </TabsContent>}
      {sections.includes("communications") && <TabsContent value="communications" className="view">
        <div className="view-heading"><div><p className="eyebrow">CONTACT@EXAMPLE.INVALID</p><h1>COMMUNICATIONS<span className="heading-dot">.</span></h1></div><button className="outline-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Refreshing" : "Refresh"}</button></div>
        <div className="signal-strip"><div><Radio size={16} /><span>{hasData ? `Last received ${new Date(lastSync!).toLocaleString()}` : "Awaiting first dashboard delivery"}</span></div><button onClick={() => setHelp("mail")}>Connection details<ArrowUpRight size={15} /></button></div>
        {error && <div className="error" role="alert"><AlertTriangle size={18} />{error}</div>}
        <button className="text-link feedback-entry" onClick={() => setView("feedback")}><MessageSquareText size={18} /> Open Feedback · beta experience &amp; customer evidence <ArrowRight size={17} /></button>
        <div className="channel-grid" aria-label="Communication streams">
          {channels.filter(c => c.id !== "unsorted" || (counts.unsorted || 0) > 0).map((c, i) => <button key={c.id} aria-pressed={channel === c.id} className={`channel ${channel === c.id ? "active" : ""}`} onClick={() => { selectionVersion.current++; setReading(false); setChannel(c.id); setSelected(null); setQuery(""); }}><span className="channel-code">0{i + 1} / {c.code}</span><span className="channel-number">{hasData ? (counts[c.id] || 0).toLocaleString() : "—"}</span><span className="channel-label">{c.name}<ChevronRight size={18} /></span></button>)}
        </div>
        <section className="comms-body" aria-label={currentChannel.name}>
          <div className="stream-header"><h2>{currentChannel.name}</h2><span className="minor-label">{hasData ? `${filtered.length} in this view` : "AWAITING FIRST DELIVERY"}</span></div>
          {messages.length > 0 && <div className="search"><Search size={17} /><Input aria-label="Search messages" placeholder="Search recent senders, subjects and previews" value={query} onChange={e => setQuery(e.target.value)} /></div>}
          {coverage && <p className="notice">Showing the most recent 500 messages. Earlier messages remain saved.</p>}
          {filtered.length === 0 ? <div className="inbox-empty"><div className="empty-mark"><Inbox size={36} strokeWidth={1} /></div><p className="eyebrow">{hasData ? "STREAM CLEAR" : "READY FOR DELIVERY"}</p><h3>{hasData ? "No matching messages." : "A clear view of what comes in."}</h3><p>{hasData ? "Choose another stream or change your search." : "Beta feedback, purchases, product errors, infrastructure errors and support will arrive here in separate streams after the first dashboard delivery."}</p>{!hasData && <button className="primary-button" onClick={() => setHelp("mail")}>Connection details <ArrowRight size={18} /></button>}</div> : <div className="message-columns"><div className="message-list">{filtered.map(m => <button key={m.id} className={`message-row ${selected?.id === m.id ? "selected" : ""}`} onClick={() => void readMessage(m)}><span className="message-meta">{m.sender}<time>{new Date(m.receivedAt).toLocaleDateString()}</time></span><strong>{m.subject}</strong><span>{m.body.slice(0, 135)}</span>{m.supportKind && <small>{m.supportKind}</small>}</button>)}</div><div className="message-detail">{selected ? <><p className="eyebrow">{currentChannel.name}</p><h3>{selected.subject}</h3><p className="message-meta">{selected.sender}</p><p className="message-text">{reading ? "Loading message…" : selected.body}</p>{selected.sourceUrl && <a className="text-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">Open in email <ArrowUpRight size={15} /></a>}<p className="footnote">Category supplied by n8n. Source email remains in your mailbox.</p></> : <div className="detail-empty"><Mail size={24} /><p>Select a message to read it.</p></div>}</div></div>}
        </section>
        {sections.includes("accounts") && <div className="bottom-grid"><section className="automation-panel"><div className="mini-heading"><span className="n8n-mark">n8n</span><span className="minor-label">AUTOMATION LAYER</span></div><h3>Your inbox. Less excavation.</h3><p>n8n will pass organized messages to this dashboard. Your email account stays the source.</p><button className="text-link" onClick={() => setHelp("n8n")}>Connection details <ArrowUpRight size={15} /></button></section><section className="account-summary"><div className="mini-heading"><h3>Business accounts</h3><button className="text-link" onClick={() => setView("accounts")}>View all <ArrowRight size={15} /></button></div>{displayAccounts.filter(a => !["mail", "n8n"].includes(a.id)).map(a => <button className="account-line" key={a.id} onClick={() => { setView("accounts"); setHelp(a.id); }}><span>{a.name}</span><span className="connection-label">{a.status} <ArrowUpRight size={13} /></span></button>)}</section></div>}
      </TabsContent>}
      {sections.includes("feedback") && <TabsContent value="feedback" className="view">
        <FeedbackEnvironment key={feedbackTarget ?? "feedback"} active={view === "feedback"} targetMessageId={feedbackTarget} onSourceMessage={message => { selectionVersion.current++; setReading(false); setChannel(message.category); setSelected(null); setQuery(""); setView("communications"); void refresh(); void readMessage(message); }} />
      </TabsContent>}
      {sections.includes("accounts") && <TabsContent value="accounts" className="view">
        <div className="view-heading"><div><p className="eyebrow">SecDash / PROVIDERS</p><h1>ACCOUNTS<span className="heading-dot">.</span></h1></div><span className="minor-label">PROVIDER CONNECTIONS</span></div>
        <p className="section-intro">One place to reach your services and see which data connections are ready.</p>
        <section className="storage-strip backup-strip" aria-labelledby="backup-heading"><HardDrive size={25} /><div><p className="eyebrow">GOOGLE DRIVE BACKUP</p><h3 id="backup-heading">Dashboard + n8n</h3><p>{backup?.state === "running" ? "Backup running…" : backup?.state === "succeeded" ? `Backup completed ${new Date(backup.finishedAt!).toLocaleString()}.` : backup?.state === "failed" ? `Last backup failed${backup.finishedAt ? ` ${new Date(backup.finishedAt).toLocaleString()}` : ""}.` : "Back up the dashboard and private n8n service to encrypted Google Drive storage."}</p>{backup?.summary && backup.state !== "never" && <p className="backup-summary">{backup.summary}</p>}{backupError && <p className="backup-error" role="alert">{backupError}</p>}</div><button className="outline-button" onClick={() => void startBackup()} disabled={backupLoading || backup?.state === "running"}><RefreshCw size={16} className={backup?.state === "running" ? "spin" : ""} />{backup?.state === "running" ? "Backing up" : backupLoading ? "Starting" : "Back Up Now"}</button></section>
        <div className="accounts-grid">{displayAccounts.map((a, i) => <section className="account-card" key={a.id}><div className="mini-heading"><span className="account-index">0{i + 1}</span><span className="connection-label">{a.status}</span></div><h2>{a.name}</h2><p>{a.purpose}</p><div className="account-identity">{a.identity}{a.checkedAt && <><br />Checked {new Date(a.checkedAt).toLocaleString()}</>}</div><div className="account-actions"><button className="outline-button" onClick={() => "provider" in a ? openOperation(a.provider as ProviderSurface) : a.id === "n8n" ? openOperation("n8n") : setHelp(a.id)}>{"provider" in a ? "Open environment" : a.action} <ArrowRight size={15} /></button>{a.url && <a className="external-button" href={a.url} target="_blank" rel="noreferrer" aria-label={`Open ${a.name}`}><ArrowUpRight size={20} /></a>}</div></section>)}</div>
      </TabsContent>}
      {sections.includes("website") && <TabsContent value="website" className="view">
        <div className="view-heading"><div><h1>WEBSITE & RELEASES<span className="heading-dot">.</span></h1></div></div>
        <PublishedRelease revision={revision} active={view === "website"} openEdge={canUseStorage ? () => openOperation("cloudflare") : undefined} />
        <div className="website-grid">
          <section className="web-panel">
            <Globe size={23} /><h2>Websites</h2>
            <a href={releaseSites.public} target="_blank" rel="noopener noreferrer">Public website <ArrowUpRight size={17} /></a>
            <a href={releaseSites.beta} target="_blank" rel="noopener noreferrer">Beta landing page <ArrowUpRight size={17} /></a>
          </section>
          <section className="web-panel"><KeyRound size={23} /><h2>Editing & cleanup</h2><p>Next: edit copy and images, preview changes, and manage previous installers from here.</p><p className="footnote">Publishing and deletion are not connected yet. Current installers and rollback copies remain in place.</p><button className="text-link" onClick={() => setHelp("website")}>See the current setup <ArrowRight size={16} /></button></section></div>
      </TabsContent>}
      {sections.includes("storage") && <TabsContent value="storage" className="view">
        <DriveEnvironment permissions={account?.permissions} active={view === "storage"} backup={backup} backupLoading={backupLoading} backupError={backupError} onStartBackup={() => void startBackup()} />
      </TabsContent>}
      {sections.includes("deployments") && <TabsContent value="deployments" className="view">
        <OperationsEnvironment surface="cloudflare" active={view === "deployments"} />
      </TabsContent>}
      {sections.includes("operations") && <TabsContent value="operations" className="view">
        <nav className="domain-navigation" aria-label="Operational environments">
          {([['cloudflare','Cloudflare',Cloud],['azure','Azure',ShieldCheck],['godaddy','GoDaddy',Globe],['lemonsqueezy','Lemon Squeezy',CreditCard],['n8n','n8n',Workflow]] as const).map(([id,label,Icon]) => <button key={id} aria-pressed={operation===id} onClick={()=>setOperation(id)}><Icon aria-hidden="true" size={19} />{label}</button>)}
        </nav>
        {operation === "n8n" ? <N8nEnvironment active={view === "operations"} /> : <OperationsEnvironment surface={operation} active={view === "operations"} />}
      </TabsContent>}
    </Tabs>
    <footer className="footer"><span><ShieldCheck size={14} /> SecDash / {role ?? "OPERATOR ONLY"}</span><button onClick={() => setHelp("about")}><CircleHelp size={14} /> About SecDash</button><span>{revision ? "SIMULATION" : "PRIVATE EDITION"} / 01</span></footer>
    <Dialog open={help !== null} onOpenChange={open => { if (!open) setHelp(null); }}><DialogContent className="connection-dialog"><DialogHeader><p className="eyebrow">CONNECTION DETAILS</p><DialogTitle>{chosenAccount?.name || (help === "website" ? "Website editing & releases" : "SecDash")}</DialogTitle><DialogDescription>{chosenAccount?.purpose || "Security dashboard for a fictional business."}</DialogDescription></DialogHeader><div className="connection-body">{chosenAccount ? <><div className="setup-status"><span className="indicator muted" /> {chosenAccount.status}</div>{chosenAccount.checkedAt && <p className="footnote">Manually verified {new Date(chosenAccount.checkedAt).toLocaleString()}.</p>}<p>{chosenAccount.setup}</p><p className="footnote">{"provider" in chosenAccount ? "This records the original identity check. Open the provider environment for the latest operational observation, collection time and connection health." : "Signing in to a service in another browser tab does not automatically connect its data here."}</p>{chosenAccount.url && <a className="primary-button" href={chosenAccount.url} target="_blank" rel="noreferrer">Open {chosenAccount.name}<ArrowUpRight size={17} /></a>}</> : help === "website" ? <><p>The release cards in this dashboard use fictional data and download sample manifests.</p><p>Copy and pictures are currently edited in the website source. A visual editor and a release cleanup flow will be added here after the account connections are established.</p><p>Cleanup will need to identify every live download and retained rollback before offering an installer for deletion.</p></> : <><p>SecDash brings together communications, business accounts, and the recorded ExampleApp release.</p><p>The demo uses fictional provider data.</p></>}</div></DialogContent></Dialog>
  </main>;
}
