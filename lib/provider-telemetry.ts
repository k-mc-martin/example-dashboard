import { z } from "zod";

export const providerSurfaces = ["cloudflare", "azure", "godaddy", "lemonsqueezy"] as const;
export type ProviderSurface = typeof providerSurfaces[number];

export const providerTelemetryErrorCodes = [
  "authorization_required",
  "provider_unavailable",
  "rate_limited",
  "invalid_response",
  "incomplete_collection",
] as const;
export type ProviderTelemetryErrorCode = typeof providerTelemetryErrorCodes[number];

const isoTimestamp = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
const optionalTimestamp = isoTimestamp.optional();
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const shortText = z.string().min(1).max(280).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const resourceId = z.string().min(1).max(700).regex(/^\/subscriptions\//i);
const uuid = z.string().uuid();

const deployment = z.object({
  id: z.string().min(1).max(80),
  environment: z.enum(["production", "preview"]),
  url: z.string().url().max(500),
  createdAt: isoTimestamp,
  modifiedAt: isoTimestamp.optional(),
  stage: z.enum(["queued", "initialize", "clone_repo", "build", "deploy"]),
  status: z.enum(["success", "idle", "active", "failure", "canceled", "skipped"]),
  stageStartedAt: optionalTimestamp,
  stageEndedAt: optionalTimestamp,
  branch: shortText.optional(),
  commitHash: z.string().max(128).regex(/^[a-fA-F0-9]+$/).optional(),
  triggerType: z.enum(["github:push", "ad_hoc", "deploy_hook"]).optional(),
  skipped: z.boolean(),
  skipReason: z.enum([
    "commit_message", "preview_deployments_disabled", "production_deployments_disabled",
    "path_config", "branch_config", "pages_to_workers_conversion", "superseded_queued_build",
  ]).optional(),
  usesFunctions: z.boolean().optional(),
}).strict();

const countBytes = z.object({ key: shortText, count: safeInteger, bytes: safeInteger }).strict();

export const cloudflareTelemetryDataSchema = z.object({
  accountId: z.string().regex(/^[a-f0-9]{32}$/),
  pages: z.array(z.object({
    projectName: z.enum(["dupdash-public", "dupdash-beta"]),
    complete: z.boolean(),
    deploymentsTruncated: z.boolean(),
    deployments: z.array(deployment).max(30),
  }).strict()).length(2).refine(items => new Set(items.map(item => item.projectName)).size === 2),
  r2: z.object({
    bucketName: z.literal("dupdash-downloads"),
    complete: z.boolean(),
    objectsTruncated: z.boolean(),
    pageCount: safeInteger,
    objectCount: safeInteger,
    totalBytes: safeInteger,
    oldestModifiedAt: optionalTimestamp,
    newestModifiedAt: optionalTimestamp,
    byPrefix: z.array(countBytes).max(100),
    byExtension: z.array(countBytes).max(100),
    objects: z.array(z.object({
      key: z.string().min(1).max(1024).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
      sizeBytes: safeInteger,
      lastModifiedAt: isoTimestamp,
      storageClass: z.enum(["Standard", "InfrequentAccess"]).optional(),
    }).strict()).max(75),
  }).strict(),
}).strict();

export const godaddyTelemetryDataSchema = z.object({
  domain: z.literal("example.invalid"),
  status: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/),
  expiresAt: optionalTimestamp,
  renewBy: optionalTimestamp,
  createdAt: optionalTimestamp,
  updatedAt: optionalTimestamp,
  autoRenew: z.boolean().optional(),
  privacy: z.boolean().optional(),
  transferLock: z.boolean().optional(),
  nameServers: z.array(z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/)).max(13),
}).strict();

const commerceSlice = z.object({
  orderCount: safeInteger,
  grossCents: safeInteger,
  refundedCents: safeInteger,
  netCents: safeInteger,
  taxCents: safeInteger,
  discountCents: safeInteger,
  byStatus: z.array(z.object({ status: z.enum(["pending", "failed", "paid", "refunded", "partial_refund", "fraudulent"]), count: safeInteger }).strict()).max(6),
  byDay: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), orderCount: safeInteger, grossCents: safeInteger, refundedCents: safeInteger, netCents: safeInteger }).strict()).max(366),
  byProduct: z.array(z.object({
    productId: safeInteger,
    variantId: safeInteger,
    productName: shortText,
    variantName: shortText,
    orderCount: safeInteger,
    grossCents: safeInteger,
  }).strict()).max(100),
}).strict().refine(value => value.netCents === value.grossCents - value.refundedCents, "Net must equal gross minus refunds");

export const lemonSqueezyTelemetryDataSchema = z.object({
  storeId: z.literal("100001"),
  currency: z.literal("USD"),
  complete: z.boolean(),
  pageCount: safeInteger,
  live: commerceSlice,
  test: commerceSlice,
}).strict();

export const azureTelemetryDataSchema = z.object({
  subscriptionId: z.literal("00000000-0000-4000-8000-000000000001"),
  resourceGroup: z.literal("demo-signing-rg"),
  accountName: z.literal("demo-signing"),
  resourceId,
  location: shortText.optional(),
  provisioningState: shortText.optional(),
  profilesComplete: z.boolean(),
  profiles: z.array(z.object({
    name: shortText,
    resourceId,
    profileType: shortText.optional(),
    status: shortText.optional(),
  }).strict()).max(50),
  roleAssignmentsComplete: z.boolean(),
  roleAssignments: z.array(z.object({
    scope: resourceId,
    roleDefinitionId: resourceId,
    principalId: uuid,
    principalType: z.enum(["User", "Group", "ServicePrincipal", "ForeignGroup", "Device", "AgentUser", "AgentServicePrincipal", "Unknown"]),
  }).strict()).max(100),
}).strict();

const dataBySurface = {
  cloudflare: cloudflareTelemetryDataSchema,
  azure: azureTelemetryDataSchema,
  godaddy: godaddyTelemetryDataSchema,
  lemonsqueezy: lemonSqueezyTelemetryDataSchema,
} as const;

const statusFields = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), errorCode: z.never().optional() }),
  z.object({ status: z.literal("partial"), errorCode: z.enum(providerTelemetryErrorCodes).optional() }),
  z.object({ status: z.literal("error"), errorCode: z.enum(providerTelemetryErrorCodes) }),
]);

function envelope<S extends ProviderSurface>(surface: S) {
  return z.object({
    surface: z.literal(surface),
    observedAt: isoTimestamp,
    data: dataBySurface[surface],
  }).and(statusFields).superRefine((value, context) => {
    const incomplete = surface === "cloudflare"
      ? !(value.data as z.infer<typeof cloudflareTelemetryDataSchema>).r2.complete || (value.data as z.infer<typeof cloudflareTelemetryDataSchema>).pages.some(page => !page.complete)
      : surface === "azure"
        ? !(value.data as z.infer<typeof azureTelemetryDataSchema>).profilesComplete || !(value.data as z.infer<typeof azureTelemetryDataSchema>).roleAssignmentsComplete
        : surface === "lemonsqueezy"
          ? !(value.data as z.infer<typeof lemonSqueezyTelemetryDataSchema>).complete
          : false;
    if (value.status === "ok" && incomplete) context.addIssue({ code: "custom", message: "Incomplete collections cannot have ok status" });
  });
}

const providerTelemetrySchema = z.union([
  envelope("cloudflare"), envelope("azure"), envelope("godaddy"), envelope("lemonsqueezy"),
]);

export type CloudflareTelemetryData = z.infer<typeof cloudflareTelemetryDataSchema>;
export type AzureTelemetryData = z.infer<typeof azureTelemetryDataSchema>;
export type GoDaddyTelemetryData = z.infer<typeof godaddyTelemetryDataSchema>;
export type LemonSqueezyTelemetryData = z.infer<typeof lemonSqueezyTelemetryDataSchema>;
export type ProviderTelemetry = z.infer<typeof providerTelemetrySchema>;

export function parseProviderTelemetry(value: unknown): ProviderTelemetry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some(key => !["surface", "observedAt", "status", "data", "errorCode"].includes(key))) return null;
  const parsed = providerTelemetrySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
