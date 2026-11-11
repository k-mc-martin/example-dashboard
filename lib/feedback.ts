import { z } from "zod";

export const feedbackEnvironments = ["beta", "customer", "none", "unclassified"] as const;
export const feedbackInterpretations = ["experience_reached", "experience_obstructed", "misinterpretation", "preference", "unclassified"] as const;
export type FeedbackEnvironment = typeof feedbackEnvironments[number];
export type FeedbackInterpretation = typeof feedbackInterpretations[number];

export type FeedbackAnalysis = {
  environment: FeedbackEnvironment;
  interpretation: FeedbackInterpretation;
  evidenceQuotes: string[];
  rationale: string;
  context: string;
  intendedExperienceReference: string | null;
  sourceFingerprint: string;
  analyzedAt: string;
  stale: boolean;
};

export type FeedbackSummary = {
  counts: { beta: number; customer: number; unclassified: number };
  betaInterpretations: {
    experience_reached: number;
    experience_obstructed: number;
    misinterpretation: number;
    preference: number;
    unclassified: number;
  };
  betaUnclassified: number;
  betaStale: number;
  awaitingAnalysis: number;
  staleAnalysis: number;
  assessedMessages: number;
  totalMessages: number;
  lastAnalyzedAt: string | null;
};

export type FeedbackObstructionAttention = {
  messageId: string;
  subject: string;
  receivedAt: string;
  context: string;
  sourceFingerprint: string;
  analyzedAt: string;
};

export const feedbackSummarySchema = z.object({
  counts: z.object({ beta: z.number().int().nonnegative(), customer: z.number().int().nonnegative(), unclassified: z.number().int().nonnegative() }).strict(),
  betaInterpretations: z.object({
    experience_reached: z.number().int().nonnegative(), experience_obstructed: z.number().int().nonnegative(),
    misinterpretation: z.number().int().nonnegative(), preference: z.number().int().nonnegative(), unclassified: z.number().int().nonnegative(),
  }).strict(),
  betaUnclassified: z.number().int().nonnegative(),
  betaStale: z.number().int().nonnegative(),
  awaitingAnalysis: z.number().int().nonnegative(), staleAnalysis: z.number().int().nonnegative(),
  assessedMessages: z.number().int().nonnegative(), totalMessages: z.number().int().nonnegative(),
  lastAnalyzedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export function parseFeedbackSummary(value: unknown): FeedbackSummary {
  return feedbackSummarySchema.parse(value);
}

export type FeedbackItem = {
  message: {
    id: string; sender: string; subject: string; bodyPreview: string; receivedAt: string;
    category: string; supportKind: string | null; sourceUrl: string | null;
  };
  analysis: FeedbackAnalysis | null;
  status: "awaiting" | "current" | "stale";
};

export type FeedbackResponse = {
  fetchedAt: string;
  summary: FeedbackSummary;
  items: FeedbackItem[];
  total: number;
  offset: number;
  hasMore: boolean;
};

export type FeedbackQuery = {
  environment: "beta" | "customer" | "unclassified";
  interpretation?: FeedbackInterpretation;
  q?: string;
  messageId?: string;
  offset: number;
};

export function parseFeedbackQuery(params: URLSearchParams): FeedbackQuery {
  const allowed = new Set(["environment", "interpretation", "q", "messageId", "offset"]);
  const keys = [...params.keys()];
  const environment = params.get("environment") || "beta";
  const interpretation = params.get("interpretation") || undefined;
  const rawQ = params.get("q");
  const q = rawQ?.trim() || undefined;
  const messageId = params.get("messageId") || undefined;
  const offsetText = params.get("offset") || "0";
  if (keys.some(key => !allowed.has(key)) || keys.some((key, index) => keys.indexOf(key) !== index)
    || !["beta", "customer", "unclassified"].includes(environment)
    || (interpretation && !feedbackInterpretations.includes(interpretation as FeedbackInterpretation))
    || (messageId !== undefined && !/^[a-f0-9]{64}$/.test(messageId))
    || (messageId !== undefined && q !== undefined)
    || (rawQ !== null && rawQ.length > 200) || !/^\d+$/.test(offsetText) || Number(offsetText) > 100_000) {
    throw new Error("Invalid feedback query.");
  }
  return { environment: environment as FeedbackQuery["environment"], interpretation: interpretation as FeedbackInterpretation | undefined, q, messageId, offset: Number(offsetText) };
}

const boundedRequired = z.string().trim().min(1).max(1000);
export const inboundFeedback = z.object({
  environment: z.enum(feedbackEnvironments),
  interpretation: z.enum(feedbackInterpretations),
  evidenceQuotes: z.array(z.string().min(1).max(500)).max(3),
  rationale: boundedRequired,
  context: boundedRequired,
  intendedExperienceReference: z.string().min(1).max(500).nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.environment !== "beta" && value.interpretation !== "unclassified") {
    ctx.addIssue({ code: "custom", path: ["interpretation"], message: "Only beta feedback can use a specific interpretation." });
  }
  if (value.environment !== "none" && value.evidenceQuotes.length === 0) {
    ctx.addIssue({ code: "custom", path: ["evidenceQuotes"], message: "Evidence is required for assessed feedback." });
  }
});

export function validateFeedbackEvidence(
  feedback: z.infer<typeof inboundFeedback>,
  source: { subject: string; body: string },
): boolean {
  const present = (value: string) => source.subject.includes(value) || source.body.includes(value);
  return feedback.evidenceQuotes.every(present)
    && (feedback.intendedExperienceReference === null || present(feedback.intendedExperienceReference));
}

export async function feedbackSourceFingerprint(subject: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([subject, body]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
