import type { AiUsageOk } from './ai-usage';

export const operationSurfaces = ['recovery','cloudflare','azure','godaddy','lemonsqueezy'] as const;
export type OperationSurface = typeof operationSurfaces[number];
export type OperationObservation = {
  surface: OperationSurface; observedAt: string; receivedAt: string;
  status: 'ok' | 'partial' | 'error'; data?: unknown; errorCode?: string;
};
export type OperationEvent = Omit<OperationObservation,'data'>;
export type OperationsResponse = {
  surfaces: Record<OperationSurface, {latest: OperationObservation|null; latestSuccess: OperationObservation|null; history: OperationEvent[]; latestAiUsage?: AiUsageOk|null}>;
  serverTime: string;
};
