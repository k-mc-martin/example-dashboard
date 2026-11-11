import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { closeDb, getDb } from "../db/index.ts";
import { channels } from "../lib/dashboard.ts";
import { inboundMessage, messageKey } from "../lib/inbound.ts";

const originalPath = process.env.SECDASH_DATABASE_PATH;

test("infrastructure is a distinct accepted dashboard category", () => {
  const parsed = inboundMessage.parse({
    source: "secdash-mail",
    messageId: "infrastructure-category-contract",
    sender: "Provider status",
    subject: "Delivery failed",
    body: "The full original body remains intact.",
    receivedAt: "2026-09-30T12:00:00.000Z",
    category: "infrastructure",
  });

  assert.equal(parsed.category, "infrastructure");
  assert.equal(channels.find(channel => channel.id === "errors")?.name, "Product Errors");
  assert.equal(channels.find(channel => channel.id === "infrastructure")?.name, "Infrastructure Errors");
});

test("infrastructure intake persists unchanged content and contributes its own count", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "secdash-infrastructure-"));
  const databasePath = path.join(directory, "dashboard.sqlite");
  process.env.SECDASH_DATABASE_PATH = databasePath;
  t.after(() => {
    closeDb();
    if (originalPath === undefined) delete process.env.SECDASH_DATABASE_PATH;
    else process.env.SECDASH_DATABASE_PATH = originalPath;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const message = inboundMessage.parse({
    source: "secdash-mail",
    messageId: "infrastructure-storage",
    sender: "Provider status",
    subject: "Delivery failed",
    body: "Exact body with punctuation, Unicode café, and a second line.\nNo rewrite permitted.",
    receivedAt: "2026-09-30T12:00:00.000Z",
    category: "infrastructure",
  });
  const id = await messageKey(message.source, message.messageId);
  const db = getDb();
  const upsert = `INSERT INTO messages (id,sender,subject,body,received_at,category,support_kind,source_url,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,category=excluded.category,updated_at=excluded.updated_at`;
  await db.prepare(upsert).bind(id, message.sender, message.subject, message.body, message.receivedAt, "unsorted", null, null, "2026-09-30T12:01:00.000Z").run();
  await db.prepare(upsert).bind(id, message.sender, message.subject, message.body, message.receivedAt, message.category, null, null, "2026-09-30T12:02:00.000Z").run();

  const stored = await db.prepare("SELECT id,body,category FROM messages WHERE id = ?").bind(id).first();
  const counts = await db.prepare("SELECT category,COUNT(*) AS count FROM messages GROUP BY category").all();
  assert.deepEqual(stored, { id, body: message.body, category: "infrastructure" });
  assert.deepEqual(counts.results, [{ category: "infrastructure", count: 1 }]);
});
