import { sqliteTable, text, index, primaryKey } from "drizzle-orm/sqlite-core";
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sender: text("sender").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  receivedAt: text("received_at").notNull(),
  category: text("category").notNull(),
  supportKind: text("support_kind"),
  sourceUrl: text("source_url"),
  updatedAt: text("updated_at").notNull(),
}, table => [index("idx_messages_received_at").on(table.receivedAt)]);

export const feedbackAnalysis = sqliteTable("feedback_analysis", {
  messageId: text("message_id").primaryKey().references(() => messages.id, { onDelete: "cascade" }),
  environment: text("environment").notNull(),
  interpretation: text("interpretation").notNull(),
  evidenceQuotesJson: text("evidence_quotes_json").notNull(),
  rationale: text("rationale").notNull(),
  context: text("context").notNull(),
  intendedExperienceReference: text("intended_experience_reference"),
  sourceFingerprint: text("source_fingerprint").notNull(),
  analyzedAt: text("analyzed_at").notNull(),
});

export const providerConnections = sqliteTable("provider_connections", {
  provider: text("provider").primaryKey(),
  status: text("status").notNull(),
  identityJson: text("identity_json").notNull(),
  checkedAt: text("checked_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const driveStorageSamples = sqliteTable("drive_storage_samples", {
  observedAt: text("observed_at").primaryKey(),
  provider: text("provider").notNull(),
  status: text("status").notNull(),
  limitBytes: text("limit_bytes"),
  usedBytes: text("used_bytes"),
  driveBytes: text("drive_bytes"),
  trashBytes: text("trash_bytes"),
  errorCode: text("error_code"),
  receivedAt: text("received_at").notNull(),
}, table => [index("idx_drive_storage_received_at").on(table.receivedAt)]);

export const operationalObservations = sqliteTable("operational_observations", {
  surface: text("surface").notNull(), observedAt: text("observed_at").notNull(),
  status: text("status").notNull(), payloadJson: text("payload_json").notNull(),
  receivedAt: text("received_at").notNull(),
}, table => [primaryKey({columns:[table.surface, table.observedAt]})]);

export const attentionDismissals = sqliteTable("attention_dismissals", {
  identity: text("identity").primaryKey(),
  conditionRevision: text("condition_revision").notNull(),
  dismissedAt: text("dismissed_at").notNull(),
});
