CREATE TABLE IF NOT EXISTS attention_dismissals (
  identity TEXT PRIMARY KEY NOT NULL,
  condition_revision TEXT NOT NULL,
  dismissed_at TEXT NOT NULL
);
