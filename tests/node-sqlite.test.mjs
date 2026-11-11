import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { closeDb, getDb, SQLiteDatabase } from "../db/index.ts";

const fields = ["id", "sender", "subject", "body", "received_at", "category", "support_kind", "source_url", "updated_at"];
const row = (id, subject) => [id, "sender@example.com", subject, "body", "2026-09-29T19:00:00Z", "beta", null, null, "2026-09-29T19:01:00Z"];
const insert = `INSERT INTO messages (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,updated_at=excluded.updated_at`;

test("persists across reopen and supports upsert/read/batch", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dupdash-db-"));
  t.after(() => { closeDb(); rmSync(directory, { recursive: true }); });
  process.env.DUPDASH_DATABASE_PATH = join(directory, "dashboard.sqlite");
  await getDb().prepare(insert).bind(...row("one", "first")).run();
  await getDb().prepare(insert).bind(...row("one", "updated")).run();
  closeDb();
  const db = getDb();
  assert.equal(await db.prepare("SELECT subject FROM messages WHERE id = ?").bind("one").first("subject"), "updated");
  await db.prepare(`INSERT INTO provider_connections (provider,status,identity_json,checked_at,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET checked_at=excluded.checked_at,updated_at=excluded.updated_at`)
    .bind("godaddy", "verified", JSON.stringify({ domain: "example.invalid" }), "2026-09-30T19:00:00.000Z", "2026-09-30T19:00:00.000Z").run();
  await db.prepare(`INSERT INTO provider_connections (provider,status,identity_json,checked_at,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(provider) DO UPDATE SET checked_at=excluded.checked_at,updated_at=excluded.updated_at`)
    .bind("godaddy", "verified", JSON.stringify({ domain: "example.invalid" }), "2026-09-30T20:00:00.000Z", "2026-09-30T20:00:00.000Z").run();
  assert.equal(await db.prepare("SELECT checked_at FROM provider_connections WHERE provider = ?").bind("godaddy").first("checked_at"), "2026-09-30T20:00:00.000Z");
  const [messages, count] = await db.batch([db.prepare("SELECT id,subject FROM messages ORDER BY id"), db.prepare("SELECT COUNT(*) AS count FROM messages")]);
  assert.deepEqual(messages.results, [{ id: "one", subject: "updated" }]);
  assert.equal(count.results[0].count, 1);
});

test("batch rejects foreign statements and rolls back on failure", async (t) => {
  closeDb();
  const directory = mkdtempSync(join(tmpdir(), "dupdash-db-"));
  const otherDirectory = mkdtempSync(join(tmpdir(), "dupdash-db-"));
  t.after(() => { closeDb(); rmSync(directory, { recursive: true }); rmSync(otherDirectory, { recursive: true }); });
  process.env.DUPDASH_DATABASE_PATH = join(directory, "dashboard.sqlite");
  const db = getDb();
  const other = new SQLiteDatabase(join(otherDirectory, "other.sqlite"));
  t.after(() => other.close());
  await assert.rejects(db.batch([other.prepare("SELECT 1")]));
  await assert.rejects(db.batch([db.prepare(insert).bind(...row("atomic", "created")), db.prepare("INSERT INTO messages (id) VALUES (?)").bind("invalid")]));
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM messages").first("count"), 0);
});

test("requires an absolute configured path", () => {
  closeDb();
  delete process.env.DUPDASH_DATABASE_PATH;
  assert.throws(() => getDb(), /required/);
  process.env.DUPDASH_DATABASE_PATH = "relative.sqlite";
  assert.throws(() => getDb(), /absolute/);
});

test("refuses an existing incompatible schema without replacing it", (t) => {
  closeDb();
  const directory = mkdtempSync(join(tmpdir(), "dupdash-db-"));
  t.after(() => { closeDb(); rmSync(directory, { recursive: true }); });
  const path = join(directory, "dashboard.sqlite");
  process.env.DUPDASH_DATABASE_PATH = path;
  const native = new DatabaseSync(path);
  native.exec("CREATE TABLE messages (id text PRIMARY KEY NOT NULL)");
  native.close();
  assert.throws(() => getDb(), /expected schema/);
});
