import type { SQLiteDatabase } from "../db/index.ts";
import { z } from "zod";

const checkedAt = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
const fixed = <T extends z.ZodRawShape>(provider: string, identity: T) => z.object({
  provider: z.literal(provider),
  status: z.literal("verified"),
  identity: z.object(identity).strict(),
  checkedAt,
}).strict();

export const inboundProviderConnection = z.discriminatedUnion("provider", [
  fixed("cloudflare", {
    accountId: z.literal("00000000000000000000000000000001"),
    pagesProjects: z.tuple([z.literal("dupdash-public"), z.literal("dupdash-beta")]),
    r2Bucket: z.literal("dupdash-downloads"),
  }),
  fixed("lemonsqueezy", {
    storeId: z.literal("100001"),
    domain: z.literal("store.example.invalid"),
  }),
  fixed("godaddy", { domain: z.literal("example.invalid") }),
  fixed("azure", {
    subscriptionId: z.literal("00000000-0000-4000-8000-000000000001"),
    resourceGroup: z.literal("demo-signing-rg"),
    resourceType: z.literal("Microsoft.CodeSigning/codeSigningAccounts"),
    accountName: z.literal("demo-signing"),
  }),
]);

export type ProviderConnection = z.infer<typeof inboundProviderConnection>;

export function connectionStatement(db: SQLiteDatabase, connection: ProviderConnection, time = new Date().toISOString()) {
  return db.prepare(`INSERT INTO provider_connections (provider,status,identity_json,checked_at,updated_at)
      VALUES (?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET status=excluded.status,identity_json=excluded.identity_json,checked_at=excluded.checked_at,updated_at=excluded.updated_at`)
      .bind(connection.provider, connection.status, JSON.stringify(connection.identity), connection.checkedAt, time);
}
