// Portable strict contract: embedded unchanged in the n8n projection node.
export function sanitizeAiUsage(value) {
  const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
  const iso = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(v);
  const count = v => Number.isSafeInteger(v) && v >= 0;
  const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
  const totalKeys = ['calls', 'inputTokens', 'outputTokens', 'estimatedCostUsd'];
  const total = v => exact(v, totalKeys) && count(v.calls) && count(v.inputTokens) && count(v.outputTokens) && money(v.estimatedCostUsd)
    && (v.calls > 0 || (v.inputTokens === 0 && v.outputTokens === 0 && v.estimatedCostUsd === 0));
  if (value?.status === 'unavailable') {
    return exact(value, ['status', 'measuredAt', 'errorCode']) && iso(value.measuredAt) && value.errorCode === 'usage_unavailable' ? { ...value } : null;
  }
  const keys = ['status','measuredAt','trackingStartedAt','windowStartedAt','model','currency','monthKey','today','month','window','reservedMonthUsd','limits','daily','unresolvedCalls'];
  if (!exact(value, keys) || value.status !== 'ok' || value.model !== 'gpt-5.6-luna' || value.currency !== 'USD'
    || !iso(value.measuredAt) || !iso(value.trackingStartedAt) || !iso(value.windowStartedAt)
    || !total(value.today) || !total(value.month) || !total(value.window) || !count(value.unresolvedCalls)
    || !money(value.reservedMonthUsd) || !exact(value.limits, ['perRunUsd','perDayUsd','perMonthUsd'])
    || !Object.values(value.limits).every(v => money(v) && v > 0) || !Array.isArray(value.daily) || value.daily.length > 31) return null;
  const measured = Date.parse(value.measuredAt), start = Date.parse(value.windowStartedAt), tracking = Date.parse(value.trackingStartedAt);
  const today = new Date(measured).toISOString().slice(0,10);
  if (tracking > start || start > measured || measured - start > 30 * 86400000 + 1000 || value.monthKey !== today.slice(0,7)) return null;
  let previous = '', sums = {calls:0,inputTokens:0,outputTokens:0,estimatedCostUsd:0};
  for (const row of value.daily) {
    if (!exact(row, ['date', ...totalKeys]) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(Date.parse(row.date))
      || new Date(row.date).toISOString().slice(0,10) !== row.date || row.date <= previous || row.date > today || row.date < new Date(start).toISOString().slice(0,10)
      || !total(Object.fromEntries(totalKeys.map(k => [k,row[k]])))) return null;
    previous = row.date;
    for (const key of totalKeys) sums[key] += row[key];
  }
  if (totalKeys.some(k => Math.abs(sums[k] - value.window[k]) > (k === 'estimatedCostUsd' ? 1e-9 : 0))) return null;
  if (totalKeys.some(k => value.today[k] > value.month[k] + 1e-9)) return null;
  return JSON.parse(JSON.stringify(value));
}

export function calculateAiProjection(usage) {
  const elapsedDays = (Date.parse(usage.measuredAt) - Date.parse(usage.windowStartedAt)) / 86400000;
  return {
    elapsedDays,
    annualizedUsd: elapsedDays > 0 ? usage.window.estimatedCostUsd / elapsedDays * 365 : null,
    annualBudgetUsd: usage.limits.perMonthUsd * 12,
    monthUsedPercent: usage.month.estimatedCostUsd / usage.limits.perMonthUsd * 100,
    monthReservedPercent: usage.reservedMonthUsd / usage.limits.perMonthUsd * 100,
    provisional: elapsedDays < 7,
  };
}
