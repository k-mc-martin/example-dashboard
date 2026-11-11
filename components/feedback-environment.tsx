"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, ExternalLink, FileQuestion, MessageSquareQuote, RefreshCw, Search, Sparkles } from "lucide-react";
import type { FeedbackInterpretation, FeedbackItem } from "@/lib/feedback";
import type { Message } from "@/lib/dashboard";
import { useFeedbackFeed } from "@/lib/use-feedback-feed";
import "./feedback-environment.css";

type Lane = "beta" | "customer" | "unclassified";
type Props = { active: boolean; targetMessageId: string | null; onSourceMessage: (message: Message) => void };
const PAGE_SIZE = 50;
const interpretationOptions: Array<{ value: FeedbackInterpretation; label: string; short: string; description: string }> = [
  { value: "experience_reached", label: "Experience reached", short: "Reached", description: "The tester understood and used the intended workflow." },
  { value: "experience_obstructed", label: "Experience obstructed", short: "Obstructed", description: "A technical, performance, or UX barrier blocked the experience." },
  { value: "misinterpretation", label: "Misinterpretation", short: "Misread", description: "The interface or onboarding led to the wrong mental model." },
  { value: "preference", label: "Preference", short: "Preference", description: "The intended workflow was experienced, but a different behavior was preferred." },
  { value: "unclassified", label: "Unclassified interpretation", short: "Unclassified", description: "No known interpretation is currently grounded." },
];

function time(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : "Not yet analyzed"; }
function statusLabel(item: FeedbackItem) {
  if (item.status === "awaiting") return "Awaiting analysis";
  if (item.status === "stale") return "Stale analysis";
  return "Analysis current";
}

export function FeedbackEnvironment({ active, targetMessageId, onSourceMessage }: Props) {
  const [lane, setLane] = useState<Lane>("beta");
  const [interpretation, setInterpretation] = useState<FeedbackInterpretation | undefined>(targetMessageId ? "experience_obstructed" : undefined);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [targetId, setTargetId] = useState<string | null>(targetMessageId);
  const [selectedId, setSelectedId] = useState<string | null>(targetMessageId);
  const [fullMessage, setFullMessage] = useState<{ id: string; message: Message } | null>(null);
  const [messageError, setMessageError] = useState<{ id: string; text: string } | null>(null);
  const [reading, setReading] = useState(false);
  const messageGeneration = useRef(0);
  const sourceController = useRef<AbortController | null>(null);
  const feed = useFeedbackFeed(active, { environment: lane, interpretation: lane === "beta" ? interpretation : undefined, q: query, messageId: targetId ?? undefined, offset });
  const items = useMemo(() => feed.data?.items ?? [], [feed.data?.items]);
  const selected = items.find(item => item.message.id === selectedId) ?? items[0] ?? null;
  const selectedMessageId = selected?.message.id ?? null;

  useEffect(() => {
    const generation = ++messageGeneration.current;
    sourceController.current?.abort();
    sourceController.current = null;
    if (!active || !selectedMessageId) return;
    const controller = new AbortController();
    const messageId = selectedMessageId;
    const start = window.setTimeout(() => {
      setReading(true);
      void fetch(`/api/messages/${encodeURIComponent(messageId)}`, { cache: "no-store", signal: controller.signal })
        .then(async response => { if (!response.ok) throw new Error("The full source message could not be loaded."); return response.json() as Promise<{ message: Message }>; })
        .then(payload => { if (generation === messageGeneration.current) { setFullMessage({ id: messageId, message: payload.message }); setMessageError(null); } })
        .catch(error => { if (generation === messageGeneration.current && !(error instanceof DOMException && error.name === "AbortError")) setMessageError({ id: messageId, text: error instanceof Error ? error.message : "The full source message could not be loaded." }); })
        .finally(() => { if (generation === messageGeneration.current) setReading(false); });
    }, 0);
    return () => { window.clearTimeout(start); controller.abort(); };
  }, [active, selectedMessageId]);

  const summary = feed.data?.summary;
  const betaStates = useMemo(() => interpretationOptions.slice(0, 4).map(option => ({ ...option, count: summary?.betaInterpretations[option.value as keyof typeof summary.betaInterpretations] ?? 0 })), [summary]);
  function changeLane(next: Lane) { setTargetId(null); setLane(next); setInterpretation(undefined); setOffset(0); setSelectedId(null); }
  function applySearch(event: React.FormEvent) { event.preventDefault(); setTargetId(null); setQuery(searchDraft.trim()); setOffset(0); }
  async function openSource() {
    if (!active) return;
    if (fullMessage?.id === selected?.message.id) { onSourceMessage(fullMessage.message); return; }
    if (!selected) return;
    const messageId = selected.message.id;
    const generation = ++messageGeneration.current;
    sourceController.current?.abort();
    const controller = new AbortController();
    sourceController.current = controller;
    setReading(true); setMessageError(null);
    try {
      const response = await fetch(`/api/messages/${encodeURIComponent(messageId)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("The source message could not be opened.");
      const payload = await response.json() as { message: Message };
      if (generation !== messageGeneration.current || !active) return;
      setFullMessage({ id: messageId, message: payload.message }); setMessageError(null); onSourceMessage(payload.message);
    } catch (error) { if (generation === messageGeneration.current && !(error instanceof DOMException && error.name === "AbortError")) setMessageError({ id: messageId, text: error instanceof Error ? error.message : "The source message could not be opened." }); }
    finally { if (generation === messageGeneration.current) { sourceController.current = null; setReading(false); } }
  }

  return <div className="feedback-environment">
    <div className="view-heading feedback-heading"><div><p className="eyebrow">VOICE / EXPERIENCE DIAGNOSTICS</p><h1>FEEDBACK<span className="heading-dot">.</span></h1></div><button className="outline-button" onClick={() => void feed.refresh()} disabled={feed.loading}><RefreshCw size={16} className={feed.loading ? "spin" : ""} />{feed.loading ? "Refreshing" : "Refresh analysis"}</button></div>

    <div className={`feedback-feed-state ${feed.error ? "failed" : "current"}`} role={feed.error ? "alert" : "status"}><span>{feed.error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}</span><div><strong>{feed.error ? feed.data ? "Analysis feed unavailable · retained results for this query are stale" : "Analysis feed unavailable" : feed.data ? "Analysis feed current" : "Loading feedback analysis"}</strong><p>{feed.error || (feed.data ? `Fetched ${time(feed.data.fetchedAt)} · ${feed.data.summary.assessedMessages.toLocaleString()} assessed of ${feed.data.summary.totalMessages.toLocaleString()} stored messages` : "Reading the saved feedback assessment feed.")}</p></div><small>Display refresh {feed.refreshEveryMs / 1000}s<br />Server-wide query</small></div>

    <div className="feedback-tabs" role="tablist" aria-label="Feedback audience">
      <button role="tab" aria-selected={lane === "beta"} onClick={() => changeLane("beta")}><span>01 / BETA</span><strong>Beta experience</strong><b>{summary?.counts.beta ?? "—"}</b></button>
      <button role="tab" aria-selected={lane === "customer"} onClick={() => changeLane("customer")}><span>02 / CUSTOMER</span><strong>Customer feedback</strong><b>{summary?.counts.customer ?? "—"}</b></button>
      <button role="tab" aria-selected={lane === "unclassified"} onClick={() => changeLane("unclassified")}><span>03 / REVIEW</span><strong>Audience unclear</strong><b>{summary?.counts.unclassified ?? "—"}</b></button>
    </div>

    {lane === "beta" && <section className="beta-state-rack" aria-label="Beta interpretation counts">
      {betaStates.map(state => <button key={state.value} aria-pressed={interpretation === state.value} onClick={() => { setTargetId(null); setInterpretation(current => current === state.value ? undefined : state.value); setOffset(0); }}><span><b>{state.label}</b><small>{state.description}</small></span><strong>{summary ? state.count.toLocaleString() : "—"}</strong><i aria-hidden="true" /></button>)}
      <div className="beta-aux-states"><span><Clock3 size={16} /> Awaiting <strong>{summary?.awaitingAnalysis ?? "—"}</strong></span><button aria-pressed={interpretation === "unclassified"} onClick={() => { setTargetId(null); setInterpretation(current => current === "unclassified" ? undefined : "unclassified"); setOffset(0); }}><FileQuestion size={16} /> Unclassified <strong>{summary?.betaUnclassified ?? "—"}</strong></button><span className={(summary?.betaStale ?? 0) > 0 ? "attention" : ""}><AlertTriangle size={16} /> Stale <strong>{summary?.betaStale ?? "—"}</strong></span></div>
    </section>}

    {lane === "customer" && <div className="feedback-lane-note"><Sparkles size={18} /><div><strong>Customer evidence</strong><span>Customer feedback is kept separate from beta experience analysis.</span></div></div>}
    {lane === "unclassified" && <div className="feedback-lane-note review"><FileQuestion size={18} /><div><strong>Audience review lane</strong><span>Only assessed feedback whose audience remains unknown appears here. Unassessed messages are excluded.</span></div></div>}

    <form className="feedback-search" role="search" onSubmit={applySearch}><label htmlFor="feedback-query">Search all stored feedback</label><div><Search size={17} aria-hidden="true" /><input id="feedback-query" value={searchDraft} maxLength={200} onChange={event => setSearchDraft(event.target.value)} placeholder="Sender, subject, message, or analysis" /><button type="submit">Search</button>{(query || targetId) && <button type="button" onClick={() => { setTargetId(null); setSearchDraft(""); setQuery(""); setOffset(0); }}>Clear</button>}</div></form>

    <div className="feedback-workbench">
      <section className="feedback-list-panel" aria-label={`${lane} feedback results`}><div className="feedback-panel-chrome"><span>RESULT.INDEX</span><span>{feed.data ? `${feed.data.total.toLocaleString()} MATCHES` : "AWAITING FEED"}</span></div>
        {!feed.data && feed.error ? <div className="feedback-empty"><AlertTriangle /><strong>Results unavailable</strong><span>No retained results exist for this exact lane, filter, search, and page. Retry the feed to determine whether feedback is present.</span></div> : !feed.data ? <div className="feedback-empty"><RefreshCw className="spin" /><strong>Loading saved feedback</strong></div> : items.length === 0 ? <div className="feedback-empty"><MessageSquareQuote /><strong>{lane === "beta" && !query && !interpretation ? "No beta feedback observed" : "No matching feedback"}</strong><span>{lane === "beta" && !query && !interpretation ? "No messages have been assessed as beta feedback. Older or unassessed mail may still exist in Communications." : "Change the search or selected analysis state."}</span></div> : <div className="feedback-result-list">{items.map(item => <button key={item.message.id} className={selected?.message.id === item.message.id ? "selected" : ""} onClick={() => setSelectedId(item.message.id)}><span className="result-meta"><b className={item.status}>{statusLabel(item)}</b><time>{new Date(item.message.receivedAt).toLocaleDateString()}</time></span><strong>{item.message.subject}</strong><span className="result-sender">{item.message.sender}</span><p>{item.message.bodyPreview}</p>{item.analysis && <span className="result-analysis">{item.analysis.environment === "beta" ? interpretationOptions.find(option => option.value === item.analysis?.interpretation)?.label ?? "Unclassified" : item.analysis.environment === "customer" ? "Customer" : "Audience unclear"}</span>}</button>)}</div>}
        <div className="feedback-pagination"><button disabled={offset === 0 || feed.loading || !!targetId} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ArrowLeft size={16} /> Previous</button><span>{feed.data?.total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, feed.data.total)} of ${feed.data.total}` : "0 results"}</span><button disabled={!feed.data?.hasMore || feed.loading || !!targetId} onClick={() => setOffset(offset + PAGE_SIZE)}>Next <ArrowRight size={16} /></button></div>
      </section>

      <section className="feedback-detail-panel" aria-label="Feedback evidence"><div className="feedback-panel-chrome"><span>EVIDENCE.TRACE</span><span>{selected ? selected.message.id.slice(0, 12) : "NO SELECTION"}</span></div>
        {!selected ? <div className="feedback-empty detail"><MessageSquareQuote /><strong>Select feedback to inspect its evidence.</strong></div> : <div className="feedback-detail"><div className="detail-heading"><div><span>{statusLabel(selected)}</span><h2>{selected.message.subject}</h2><p>{selected.message.sender} · {time(selected.message.receivedAt)}</p></div><button onClick={() => void openSource()} disabled={reading}><ExternalLink size={16} />{reading ? "Loading source" : "Open in Communications"}</button></div>
          {messageError?.id === selected.message.id && <div className="feedback-inline-error" role="alert"><span>{messageError.text}</span><button onClick={() => void openSource()}>Retry source read</button></div>}
          <div className="source-body"><span>{fullMessage?.id === selected.message.id ? "SOURCE MESSAGE · COMPLETE" : "SOURCE PREVIEW · PARTIAL"}</span><p>{reading && fullMessage?.id !== selected.message.id ? "Loading the complete source message…" : fullMessage?.id === selected.message.id ? fullMessage.message.body : selected.message.bodyPreview}</p></div>
          {selected.analysis ? <div className="analysis-trace">
            <div className="trace-block quotes"><span>GROUNDED QUOTES</span>{selected.analysis.evidenceQuotes.map((quote, index) => <blockquote key={`${quote}-${index}`}>“{quote}”</blockquote>)}</div>
            <div className="trace-grid"><div className="trace-block"><span>RATIONALE</span><p>{selected.analysis.rationale}</p></div><div className="trace-block"><span>CONTEXT</span><p>{selected.analysis.context}</p></div></div>
            <div className="trace-block intended"><span>INTENDED-EXPERIENCE REFERENCE</span><p>{selected.analysis.intendedExperienceReference ?? "Missing — no explicit intended-experience reference was grounded in the source message."}</p></div>
            <dl><div><dt>Audience</dt><dd>{selected.analysis.environment === "none" ? "Not feedback" : selected.analysis.environment}</dd></div><div><dt>Interpretation</dt><dd>{selected.analysis.interpretation.replaceAll("_", " ")}</dd></div><div><dt>Analyzed</dt><dd>{time(selected.analysis.analyzedAt)}</dd></div></dl>
          </div> : <div className="analysis-awaiting"><Clock3 size={20} /><div><strong>Awaiting analysis</strong><p>This source message has no stored feedback assessment. No interpretation has been inferred in the interface.</p></div></div>}
        </div>}
      </section>
    </div>
  </div>;
}
