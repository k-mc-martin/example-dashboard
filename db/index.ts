import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

type SqlValue = null | number | bigint | string | Uint8Array;
type Row = Record<string, unknown>;

export type DatabaseResult<T extends Row = Row> = {
  results: T[];
  success: true;
  meta: { changes: number; last_row_id: number | bigint };
};

const createTable = `
CREATE TABLE IF NOT EXISTS messages (
  id text PRIMARY KEY NOT NULL,
  sender text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  received_at text NOT NULL,
  category text NOT NULL,
  support_kind text,
  source_url text,
  updated_at text NOT NULL
);`;
const createIndex = "CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages (received_at)";
const createFeedbackAnalysis = `
CREATE TABLE IF NOT EXISTS feedback_analysis (
  message_id text PRIMARY KEY NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  environment text NOT NULL,
  interpretation text NOT NULL,
  evidence_quotes_json text NOT NULL,
  rationale text NOT NULL,
  context text NOT NULL,
  intended_experience_reference text,
  source_fingerprint text NOT NULL,
  analyzed_at text NOT NULL
);`;
const createFeedbackEnvironmentIndex = "CREATE INDEX IF NOT EXISTS idx_feedback_analysis_environment ON feedback_analysis (environment)";
const createProviderConnections = `
CREATE TABLE IF NOT EXISTS provider_connections (
  provider text PRIMARY KEY NOT NULL,
  status text NOT NULL,
  identity_json text NOT NULL,
  checked_at text NOT NULL,
  updated_at text NOT NULL
);`;
const createDriveStorageSamples = `
CREATE TABLE IF NOT EXISTS drive_storage_samples (
  observed_at text PRIMARY KEY NOT NULL,
  provider text NOT NULL,
  status text NOT NULL,
  limit_bytes text,
  used_bytes text,
  drive_bytes text,
  trash_bytes text,
  error_code text,
  received_at text NOT NULL
);`;
const createDriveStorageReceivedIndex = "CREATE INDEX IF NOT EXISTS idx_drive_storage_received_at ON drive_storage_samples (received_at)";
const createAttentionDismissals = `
CREATE TABLE IF NOT EXISTS attention_dismissals (
  identity text PRIMARY KEY NOT NULL,
  condition_revision text NOT NULL,
  dismissed_at text NOT NULL
);`;
const expectedColumns = [
  ["id", "TEXT", 1, 1], ["sender", "TEXT", 1, 0], ["subject", "TEXT", 1, 0],
  ["body", "TEXT", 1, 0], ["received_at", "TEXT", 1, 0], ["category", "TEXT", 1, 0],
  ["support_kind", "TEXT", 0, 0], ["source_url", "TEXT", 0, 0], ["updated_at", "TEXT", 1, 0],
] as const;
const expectedFeedbackColumns = [
  ["message_id", "TEXT", 1, 1], ["environment", "TEXT", 1, 0],
  ["interpretation", "TEXT", 1, 0], ["evidence_quotes_json", "TEXT", 1, 0],
  ["rationale", "TEXT", 1, 0], ["context", "TEXT", 1, 0],
  ["intended_experience_reference", "TEXT", 0, 0], ["source_fingerprint", "TEXT", 1, 0],
  ["analyzed_at", "TEXT", 1, 0],
] as const;
const expectedProviderColumns = [
  ["provider", "TEXT", 1, 1], ["status", "TEXT", 1, 0],
  ["identity_json", "TEXT", 1, 0], ["checked_at", "TEXT", 1, 0],
  ["updated_at", "TEXT", 1, 0],
] as const;
const expectedDriveStorageColumns = [
  ["observed_at", "TEXT", 1, 1], ["provider", "TEXT", 1, 0],
  ["status", "TEXT", 1, 0], ["limit_bytes", "TEXT", 0, 0],
  ["used_bytes", "TEXT", 0, 0], ["drive_bytes", "TEXT", 0, 0],
  ["trash_bytes", "TEXT", 0, 0], ["error_code", "TEXT", 0, 0],
  ["received_at", "TEXT", 1, 0],
] as const;
const expectedAttentionDismissalColumns = [
  ["identity", "TEXT", 1, 1], ["condition_revision", "TEXT", 1, 0],
  ["dismissed_at", "TEXT", 1, 0],
] as const;

function databasePath(): string {
  const configured = process.env.SECDASH_DATABASE_PATH;
  if (!configured) throw new Error("SECDASH_DATABASE_PATH is required.");
  if (!isAbsolute(configured)) throw new Error("SECDASH_DATABASE_PATH must be an absolute path.");
  return resolve(configured);
}

function initialize(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(createTable);
  const columns = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
  const valid = columns.length === expectedColumns.length && columns.every((column, index) => {
    const expected = expectedColumns[index];
    return column.name === expected[0] && column.type.toUpperCase() === expected[1] && column.notnull === expected[2] && column.pk === expected[3];
  });
  if (!valid) {
    throw new Error("The messages table does not match the expected schema; no data was changed.");
  }
  db.exec(createFeedbackAnalysis);
  const feedbackColumns = db.prepare("PRAGMA table_info(feedback_analysis)").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
  const feedbackValid = feedbackColumns.length === expectedFeedbackColumns.length && feedbackColumns.every((column, index) => {
    const expected = expectedFeedbackColumns[index];
    return column.name === expected[0] && column.type.toUpperCase() === expected[1] && column.notnull === expected[2] && column.pk === expected[3];
  });
  if (!feedbackValid) throw new Error("The feedback_analysis table does not match the expected schema; no data was changed.");
  db.exec(createProviderConnections);
  const providerColumns = db.prepare("PRAGMA table_info(provider_connections)").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
  const providerValid = providerColumns.length === expectedProviderColumns.length && providerColumns.every((column, index) => {
    const expected = expectedProviderColumns[index];
    return column.name === expected[0] && column.type.toUpperCase() === expected[1] && column.notnull === expected[2] && column.pk === expected[3];
  });
  if (!providerValid) throw new Error("The provider_connections table does not match the expected schema; no data was changed.");
  db.exec(createDriveStorageSamples);
  const driveStorageColumns = db.prepare("PRAGMA table_info(drive_storage_samples)").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
  const driveStorageValid = driveStorageColumns.length === expectedDriveStorageColumns.length && driveStorageColumns.every((column, index) => {
    const expected = expectedDriveStorageColumns[index];
    return column.name === expected[0] && column.type.toUpperCase() === expected[1] && column.notnull === expected[2] && column.pk === expected[3];
  });
  if (!driveStorageValid) throw new Error("The drive_storage_samples table does not match the expected schema; no data was changed.");
  db.exec(createAttentionDismissals);
  const attentionColumns = db.prepare("PRAGMA table_info(attention_dismissals)").all() as Array<{ name: string; type: string; notnull: number; pk: number }>;
  const attentionValid = attentionColumns.length === expectedAttentionDismissalColumns.length && attentionColumns.every((column, index) => {
    const expected = expectedAttentionDismissalColumns[index];
    return column.name === expected[0] && column.type.toUpperCase() === expected[1] && column.notnull === expected[2] && column.pk === expected[3];
  });
  if (!attentionValid) throw new Error("The attention_dismissals table does not match the expected schema; no data was changed.");
  db.exec(`CREATE TABLE IF NOT EXISTS operational_observations (
    surface TEXT NOT NULL, observed_at TEXT NOT NULL, status TEXT NOT NULL,
    payload_json TEXT NOT NULL, received_at TEXT NOT NULL,
    PRIMARY KEY(surface, observed_at)
  );`);
  const operationColumns = db.prepare("PRAGMA table_info(operational_observations)").all();
  if (operationColumns.length !== 5 || operationColumns.some((c,i) => c.name !== ['surface','observed_at','status','payload_json','received_at'][i] || c.type !== 'TEXT' || c.notnull !== 1 || c.pk !== (i < 2 ? i+1 : 0))) throw new Error('Unexpected operational observation schema');
  db.exec(createIndex);
  db.exec(createFeedbackEnvironmentIndex);
  db.exec(createDriveStorageReceivedIndex);
}

function result<T extends Row>(db: DatabaseSync, rows: T[] = []): DatabaseResult<T> {
  const [meta] = db.prepare("SELECT changes() AS changes, last_insert_rowid() AS lastRowId").all() as Array<{ changes: number; lastRowId: number | bigint }>;
  return { results: rows.map((row) => ({ ...row })), success: true, meta: { changes: meta.changes, last_row_id: meta.lastRowId } };
}

function returnsRows(sql: string): boolean {
  const command = sql.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "").match(/^([a-z]+)/i)?.[1]?.toUpperCase();
  return command === "SELECT" || command === "PRAGMA" || command === "EXPLAIN" || command === "WITH" || /\bRETURNING\b/i.test(sql);
}

export class SQLitePreparedStatement<T extends Row = Row> {
  readonly #owner: SQLiteDatabase;
  readonly #statement: StatementSync;
  readonly #sql: string;
  readonly #values: SqlValue[];

  constructor(owner: SQLiteDatabase, sql: string, values: SqlValue[] = []) {
    this.#owner = owner;
    this.#statement = owner.native.prepare(sql);
    this.#sql = sql;
    this.#values = values;
  }
  bind(...values: SqlValue[]): SQLitePreparedStatement<T> { return new SQLitePreparedStatement<T>(this.#owner, this.#sql, values); }
  async run(): Promise<DatabaseResult<T>> { return this.executeForBatch(); }
  async first(column?: string): Promise<T | unknown | null> {
    const row = this.#statement.get(...this.#values) as T | undefined;
    if (!row) return null;
    return column === undefined ? { ...row } : row[column] ?? null;
  }
  async all(): Promise<DatabaseResult<T>> {
    return result(this.#owner.native, this.#statement.all(...this.#values) as T[]);
  }
  executeForBatch(): DatabaseResult<T> {
    if (returnsRows(this.#sql)) return result(this.#owner.native, this.#statement.all(...this.#values) as T[]);
    const runResult = this.#statement.run(...this.#values);
    return { results: [], success: true, meta: { changes: Number(runResult.changes), last_row_id: runResult.lastInsertRowid } };
  }
  belongsTo(database: SQLiteDatabase): boolean { return this.#owner === database; }
}

export class SQLiteDatabase {
  readonly native: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.native = new DatabaseSync(path);
    try { initialize(this.native); } catch (error) { this.native.close(); throw error; }
  }
  prepare<T extends Row = Row>(sql: string): SQLitePreparedStatement<T> { return new SQLitePreparedStatement<T>(this, sql); }
  async batch<T extends Row = Row>(statements: SQLitePreparedStatement<T>[]): Promise<DatabaseResult<T>[]> {
    if (statements.some((statement) => !statement.belongsTo(this))) throw new Error("All batched statements must belong to this database.");
    return this.transaction(() => statements.map(statement => statement.executeForBatch()));
  }
  transaction<T>(run: () => T): T {
    this.native.exec("BEGIN IMMEDIATE");
    try {
      const results = run();
      this.native.exec("COMMIT");
      return results;
    } catch (error) {
      this.native.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void { this.native.close(); }
}

let openDatabase: { path: string; database: SQLiteDatabase } | undefined;
export function getDb(): SQLiteDatabase {
  const path = databasePath();
  if (openDatabase && openDatabase.path !== path) throw new Error("SECDASH_DATABASE_PATH changed while the database was open.");
  if (!openDatabase) openDatabase = { path, database: new SQLiteDatabase(path) };
  return openDatabase.database;
}
export function closeDb(): void { openDatabase?.database.close(); openDatabase = undefined; }
