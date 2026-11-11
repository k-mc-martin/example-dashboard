import { sanitizeAiUsage, calculateAiProjection } from './ai-usage-contract.mjs';

export type AiUsageTotals = { calls: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
export type AiUsageOk = {
  status: 'ok'; measuredAt: string; trackingStartedAt: string; windowStartedAt: string;
  model: 'gpt-5.6-luna'; currency: 'USD'; monthKey: string;
  today: AiUsageTotals; month: AiUsageTotals; window: AiUsageTotals;
  reservedMonthUsd: number; limits: { perRunUsd: number; perDayUsd: number; perMonthUsd: number };
  daily: (AiUsageTotals & { date: string })[]; unresolvedCalls: number;
};
export type AiUsage = AiUsageOk | { status: 'unavailable'; measuredAt: string; errorCode: 'usage_unavailable' };
export function parseAiUsage(value: unknown): AiUsage | null { return sanitizeAiUsage(value) as AiUsage | null; }
export function projectAiUsage(usage: AiUsageOk): { elapsedDays: number; annualizedUsd: number | null; annualBudgetUsd: number; monthUsedPercent: number; monthReservedPercent: number; provisional: boolean } { return calculateAiProjection(usage); }
