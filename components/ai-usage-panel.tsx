"use client";

import { Activity, AlertTriangle, Bot, CalendarRange, Coins, Gauge, TimerReset } from "lucide-react";
import type { AiUsage } from "../lib/ai-usage";
import { projectAiUsage } from "../lib/ai-usage";
import "./ai-usage-panel.css";

type AvailableUsage = Extract<AiUsage, { status: "ok" }>;

type AiUsagePanelProps = {
  usage: AiUsage | null;
  lastAvailable: AvailableUsage | null;
  telemetryStale: boolean;
  feedError?: string;
  collectionFailed?: boolean;
};

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Unavailable";
}

function usd(value: number) {
  if (value === 0) return "$0.00";
  const magnitude = Math.abs(value);
  if (magnitude < 0.000001) return value > 0 ? "<$0.000001" : ">−$0.000001";
  const digits = magnitude >= 1 ? 2 : magnitude >= 0.1 ? 4 : magnitude >= 0.01 ? 5 : magnitude >= 0.001 ? 5 : 6;
  return `${value < 0 ? "−" : ""}$${magnitude.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function count(value: number) {
  return value.toLocaleString();
}

function projectedUsd(value: number | null) {
  return value == null ? "Unavailable" : usd(value);
}

function elapsed(value: number) {
  if (value < 1) {
    const hours = value * 24;
    const amount = hours > 0 && hours < 0.1 ? "<0.1" : hours.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return `${amount} elapsed ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} elapsed ${value === 1 ? "day" : "days"}`;
}

function PanelChrome() {
  return <div className="ai-usage-chrome" aria-hidden="true"><span className="ai-panel-controls"><i /><i /><i /></span><span>MODEL.USAGE // COST ESTIMATE</span><span className="ai-panel-readout">N8N ROUTING · READ ONLY</span></div>;
}

function DailyCostChart({ daily }: { daily: AvailableUsage["daily"] }) {
  if (daily.length === 0) {
    return <div className="ai-chart-empty"><Activity size={25} /><strong>No daily cost samples</strong><span>The chart begins when the collector reports recorded routing activity.</span></div>;
  }

  const width = Math.max(760, daily.length * 30 + 135);
  const height = 250;
  const pad = { left: 115, right: 20, top: 34, bottom: 42 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxCost = Math.max(...daily.map(day => day.estimatedCostUsd));
  const y = (value: number) => maxCost === 0 ? pad.top + plotHeight : pad.top + plotHeight - value / maxCost * plotHeight;
  const x = (index: number) => daily.length === 1 ? pad.left + plotWidth / 2 : pad.left + index / (daily.length - 1) * plotWidth;
  const points = daily.map((day, index) => ({ day, x: x(index), y: y(day.estimatedCostUsd) }));
  const area = `${pad.left},${pad.top + plotHeight} ${points.map(point => `${point.x},${point.y}`).join(" ")} ${pad.left + plotWidth},${pad.top + plotHeight}`;
  const midCost = maxCost / 2;

  return <div className="ai-daily-chart">
    <div className="ai-chart-scroll">
      <svg width={width} height={height} style={{ width: `${width}px`, minWidth: `${width}px` }} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Estimated daily model cost for ${daily.length} recorded ${daily.length === 1 ? "day" : "days"}`}>
        {[pad.top, pad.top + plotHeight / 2, pad.top + plotHeight].map(lineY => <line key={lineY} className="ai-chart-gridline" x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} />)}
        <text className="ai-chart-scale" x={pad.left - 12} y={pad.top + 5} textAnchor="end">{usd(maxCost)}</text>
        <text className="ai-chart-scale" x={pad.left - 12} y={pad.top + plotHeight / 2 + 5} textAnchor="end">{usd(midCost)}</text>
        <text className="ai-chart-scale" x={pad.left - 12} y={pad.top + plotHeight + 5} textAnchor="end">$0.00</text>
        <text className="ai-chart-unit" x={pad.left} y="20">ESTIMATED COST / USD PER UTC DAY</text>
        {maxCost > 0 ? <polygon className="ai-chart-area" points={area} /> : null}
        {daily.length > 1 ? <polyline className="ai-chart-line" points={points.map(point => `${point.x},${point.y}`).join(" ")} /> : null}
        {points.map(point => <g key={point.day.date}>
          <circle className="ai-chart-point" cx={point.x} cy={point.y} r="4.5" />
          <title>{point.day.date}: {usd(point.day.estimatedCostUsd)} estimated · {count(point.day.calls)} calls · {count(point.day.inputTokens)} input tokens · {count(point.day.outputTokens)} output tokens</title>
        </g>)}
        <text className="ai-chart-date" x={pad.left} y={height - 12}>{daily[0].date}</text>
        <text className="ai-chart-date" x={width - pad.right} y={height - 12} textAnchor="end">{daily.at(-1)?.date}</text>
      </svg>
    </div>
  </div>;
}

function UsageCounts({ usage }: { usage: AvailableUsage }) {
  const rows = [
    { label: "Today (UTC)", value: usage.today },
    { label: "Month to date (UTC)", value: usage.month },
    { label: "Rate window", value: usage.window },
  ];

  return <div className="ai-count-table" role="table" aria-label="Recorded model calls and token counts">
    <div className="ai-count-row ai-count-header" role="row"><span role="columnheader">Period</span><span role="columnheader">Calls</span><span role="columnheader">Input tokens</span><span role="columnheader">Output tokens</span></div>
    {rows.map(row => <div className="ai-count-row" role="row" key={row.label}><strong role="rowheader">{row.label}</strong><span role="cell">{count(row.value.calls)}</span><span role="cell">{count(row.value.inputTokens)}</span><span role="cell">{count(row.value.outputTokens)}</span></div>)}
  </div>;
}

export function AiUsagePanel({ usage, lastAvailable, telemetryStale, feedError = "", collectionFailed = false }: AiUsagePanelProps) {
  const current = usage?.status === "ok" ? usage : null;
  const displayed = current && lastAvailable
    ? Date.parse(current.measuredAt) >= Date.parse(lastAvailable.measuredAt) ? current : lastAvailable
    : current ?? lastAvailable;
  const unavailable = !!feedError || collectionFailed || usage?.status === "unavailable" || (!usage && !!displayed);
  const preserved = unavailable && !!displayed;
  const status = feedError
    ? { tone: "failed", title: "Operations feed unavailable", detail: preserved ? "Last measured usage is preserved below." : feedError }
    : usage?.status === "unavailable"
      ? { tone: "failed", title: "Usage collection unavailable", detail: preserved ? "Last measured usage is preserved below." : "No valid AI usage measurement has been delivered." }
      : collectionFailed
        ? { tone: "failed", title: "Latest collection failed", detail: preserved ? "Last measured usage is preserved below." : "No valid AI usage measurement has been delivered." }
        : telemetryStale
          ? { tone: "stale", title: "Usage measurement is stale", detail: "The last measured values are preserved below." }
          : !usage && displayed
            ? { tone: "stale", title: "Latest snapshot has no AI usage", detail: "The last measured usage is preserved below." }
          : displayed
            ? { tone: "current", title: "Collector snapshot available", detail: "The display checks every 5 seconds. The usage source and n8n collector each update every 5 minutes on independent cycles, so a new value can take about 10 minutes to arrive." }
            : { tone: "pending", title: "Awaiting AI usage measurement", detail: "No cost or token value is shown until n8n delivers a valid observation." };

  if (!displayed) {
    return <section className="ai-usage-panel" aria-labelledby="ai-usage-heading">
      <PanelChrome />
      <div className={`ai-usage-state ${status.tone}`} role={status.tone === "failed" ? "alert" : "status"}><AlertTriangle size={25} /><div><strong id="ai-usage-heading">{status.title}</strong><span>{status.detail}</span></div></div>
    </section>;
  }

  const projection = projectAiUsage(displayed);
  const usedPercent = Math.max(0, projection.monthUsedPercent);
  const reservedPercent = Math.max(0, projection.monthReservedPercent);
  const visibleUsed = Math.min(100, usedPercent);
  const reservedBeyondRecorded = Math.max(reservedPercent - usedPercent, 0);
  const visibleReserved = Math.min(Math.max(100 - visibleUsed, 0), reservedBeyondRecorded);
  const budgetReachPercent = Math.max(usedPercent, reservedPercent);
  const overLimitSubject = usedPercent > 100 && reservedPercent > 100
    ? "Recorded usage and the conservative commitment exceed"
    : usedPercent > 100 ? "Recorded usage exceeds" : "The conservative commitment exceeds";
  const earlySample = projection.provisional;
  const rollingWindow = projection.elapsedDays >= 30;

  return <section className="ai-usage-panel" aria-labelledby="ai-usage-heading">
    <PanelChrome />
    <div className="ai-usage-heading">
      <div><p className="eyebrow">RECURRING MAIL ROUTING / GPT-5.6 LUNA</p><h2 id="ai-usage-heading">AI usage envelope</h2></div>
      <span className="ai-model-chip"><Bot size={17} />{displayed.model}</span>
    </div>
    <div className={`ai-usage-state ${status.tone}`} role={status.tone === "failed" ? "alert" : "status"}>
      {status.tone === "current" ? <Gauge size={23} /> : <AlertTriangle size={23} />}
      <div><strong>{status.title}</strong><span>{status.detail} Measured {dateTime(displayed.measuredAt)}.</span></div>
      {preserved ? <b>LAST VALID</b> : null}
    </div>

    <div className="ai-usage-layout">
      <section className="ai-budget-instrument" aria-label="Monthly AI usage against budget limit">
        <div className="ai-instrument-label"><span>UTC MONTH · {displayed.monthKey}</span><strong>{usd(displayed.month.estimatedCostUsd)} recorded / {usd(displayed.limits.perMonthUsd)}</strong></div>
        <div className="ai-budget-bar" role="img" aria-label={`${usedPercent.toFixed(2)} percent recorded usage; the inclusive conservative commitment reaches ${reservedPercent.toFixed(2)} percent of the monthly limit`}>
          <span className="ai-budget-used" style={{ width: `${visibleUsed}%` }} />
          <span className="ai-budget-reserved" style={{ left: `${visibleUsed}%`, width: `${visibleReserved}%` }} />
          <i className="ai-budget-limit" />
        </div>
        <div className="ai-budget-legend">
          <div><i className="used" /><span>Recorded cost estimate</span><strong>{usd(displayed.month.estimatedCostUsd)}</strong><small>{usedPercent.toFixed(2)}% of monthly limit</small></div>
          <div><i className="reserved" /><span>Conservative commitment</span><strong>{usd(displayed.reservedMonthUsd)}</strong><small>{reservedPercent.toFixed(2)}% · includes recorded calls</small></div>
          <div><i className="limit" /><span>Approved ceiling</span><strong>{usd(displayed.limits.perMonthUsd)}</strong><small>calendar month · enforced upstream</small></div>
        </div>
        {displayed.unresolvedCalls > 0 ? <p className="ai-unresolved"><AlertTriangle size={16} /> {count(displayed.unresolvedCalls)} unresolved {displayed.unresolvedCalls === 1 ? "call is" : "calls are"} excluded from the recorded cost estimate.</p> : null}
        {budgetReachPercent > 100 ? <p className="ai-over-limit"><AlertTriangle size={16} /> {overLimitSubject} the monthly ceiling.</p> : null}
      </section>

      <section className="ai-projection" aria-label="Annualized usage estimate">
        <div className="ai-projection-icon"><CalendarRange size={28} /></div>
        <p>{earlySample ? "EARLY SAMPLE · SINCE TRACKING START" : rollingWindow ? "ROLLING 30-DAY ANNUALIZED ESTIMATE" : "SINCE TRACKING START · ANNUALIZED"}</p>
        <strong>{projectedUsd(projection.annualizedUsd)}{projection.annualizedUsd == null ? null : <small>/ year</small>}</strong>
        <span>Based on {elapsed(projection.elapsedDays)} and {usd(displayed.window.estimatedCostUsd)} recorded in the rate window.</span>
        <div><TimerReset size={17} /><span>{earlySample ? "Provisional: fewer than 7 elapsed days are available." : `Window started ${dateTime(displayed.windowStartedAt)}.`}</span></div>
      </section>
    </div>

    <div className="ai-annual-ceiling">
      <Coins size={23} /><div><span>Annual budget ceiling</span><strong>{usd(projection.annualBudgetUsd)}</strong></div><p>12 × the approved monthly ceiling. This is a spending boundary, not a prediction.</p>
    </div>

    <div className="ai-usage-details-grid">
      <section className="ai-counts"><div className="ai-subheading"><div><p className="eyebrow">RECORDED ACTIVITY</p><h3>Calls and tokens</h3></div><Activity size={21} /></div><UsageCounts usage={displayed} /></section>
      <section className="ai-daily"><div className="ai-subheading"><div><p className="eyebrow">COLLECTED DAILY SERIES</p><h3>Estimated cost by day</h3></div><span>{displayed.daily.length} {displayed.daily.length === 1 ? "DAY" : "DAYS"}</span></div><DailyCostChart daily={displayed.daily} /></section>
    </div>

    <details className="ai-method-notes">
      <summary>Estimate scope and collector details</summary>
      <div className="ai-notes-grid">
        <p><strong>Estimate, not invoice.</strong> Values use recorded token counts and the configured model estimate. The conservative commitment already includes recorded calls; it is not extra cost. Provider billing may differ.</p>
        <p><strong>Routing scope only.</strong> This covers recurring mail routing. It excludes one-time tests and other provider or hosting costs.</p>
        <p><strong>Read-only display.</strong> Limits are reported by the collector. This panel cannot edit spending limits or contact the model provider.</p>
        <dl><div><dt>Tracking started</dt><dd>{dateTime(displayed.trackingStartedAt)}</dd></div><div><dt>Rate window started</dt><dd>{dateTime(displayed.windowStartedAt)}</dd></div><div><dt>Unresolved calls</dt><dd>{count(displayed.unresolvedCalls)}</dd></div><div><dt>Per-run ceiling</dt><dd>{usd(displayed.limits.perRunUsd)}</dd></div><div><dt>UTC-day ceiling</dt><dd>{usd(displayed.limits.perDayUsd)}</dd></div></dl>
      </div>
    </details>
  </section>;
}
