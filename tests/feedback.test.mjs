import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SQLiteDatabase } from "../db/index.ts";
import { inboundMessage } from "../lib/inbound.ts";
import { readFeedbackObstructionAttention, readFeedbackPage, readFeedbackSummary, storeMessageWithFeedback } from "../lib/feedback-store.ts";
import { parseFeedbackQuery, parseFeedbackSummary, validateFeedbackEvidence } from "../lib/feedback.ts";

function message(id, overrides = {}) {
  return inboundMessage.parse({
    source: "mail", messageId: id, sender: `${id}@example.com`, subject: `Subject ${id}`,
    body: `Body evidence ${id}`, receivedAt: "2026-10-01T12:00:00Z", category: "beta",
    ...overrides,
  });
}

function feedback(overrides = {}) {
  return {
    environment: "beta", interpretation: "experience_reached", evidenceQuotes: ["Body evidence"],
    rationale: "The expected path was reached.", context: "Beta report from the source message.",
    intendedExperienceReference: null, ...overrides,
  };
}

test("feedback storage is additive, atomic, idempotent, stale-aware, and pageable", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "secdash-feedback-"));
  t.after(() => rmSync(directory, { recursive: true }));
  const db = new SQLiteDatabase(join(directory, "dashboard.sqlite"));
  t.after(() => db.close());

  const first = message("one", { feedback: feedback() });
  await storeMessageWithFeedback(db, "one", first, "2026-10-01T12:01:00.000Z");
  await storeMessageWithFeedback(db, "one", first, "2026-10-01T12:02:00.000Z");
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM messages").first("count"), 1);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM feedback_analysis").first("count"), 1);
  assert.equal(await db.prepare("SELECT analyzed_at FROM feedback_analysis WHERE message_id='one'").first("analyzed_at"), "2026-10-01T12:01:00.000Z");
  assert.deepEqual(await db.prepare("SELECT subject,body FROM messages WHERE id='one'").first(), { subject: "Subject one", body: "Body evidence one" });

  await storeMessageWithFeedback(db, "one", message("one", { subject: "Changed subject", body: "Changed source", category: "support" }), "2026-10-01T12:03:00.000Z");
  const stalePage = await readFeedbackPage(db, { environment: "beta", offset: 0 });
  assert.equal(stalePage.items[0].status, "stale");
  assert.equal(stalePage.items[0].analysis?.evidenceQuotes[0], "Body evidence");
  assert.equal(stalePage.items[0].message.subject, "Changed subject");

  const invalid = message("invalid", { feedback: feedback({ evidenceQuotes: ["not in source"] }) });
  assert.equal(validateFeedbackEvidence(invalid.feedback, invalid), false);
  assert.throws(() => inboundMessage.parse({ ...message("shape"), feedback: feedback({ environment: "customer", interpretation: "preference" }) }));

  const atomic = message("atomic", { feedback: feedback() });
  atomic.feedback.rationale = undefined;
  await assert.rejects(storeMessageWithFeedback(db, "atomic", atomic, "2026-10-01T12:04:00.000Z"));
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM messages WHERE id='atomic'").first("count"), 0);

  await storeMessageWithFeedback(db, "awaiting", message("awaiting"), "2026-10-01T12:05:00.000Z");
  await storeMessageWithFeedback(db, "beta-unclassified", message("beta-unclassified", {
    feedback: feedback({ interpretation: "unclassified" }),
  }), "2026-10-01T12:06:00.000Z");
  let summary = await readFeedbackSummary(db);
  assert.equal(summary.awaitingAnalysis, 1);
  assert.equal(summary.staleAnalysis, 1);
  assert.equal(summary.assessedMessages, 2);
  assert.equal(summary.betaInterpretations.experience_reached, 0);
  assert.equal(summary.betaInterpretations.unclassified, 3);
  assert.equal(summary.betaUnclassified, 3);
  assert.equal(summary.betaStale, 1);
  assert.equal(summary.lastAnalyzedAt, "2026-10-01T12:06:00.000Z");
  assert.deepEqual(parseFeedbackSummary(summary), summary);
  const unclassifiedBeta = await readFeedbackPage(db, { environment: "beta", interpretation: "unclassified", offset: 0 });
  assert.equal(unclassifiedBeta.total, summary.betaInterpretations.unclassified);
  assert.deepEqual(new Set(unclassifiedBeta.items.map(item => item.status)), new Set(["awaiting", "current", "stale"]));
  const reachedBeta = await readFeedbackPage(db, { environment: "beta", interpretation: "experience_reached", offset: 0 });
  assert.equal(reachedBeta.total, summary.betaInterpretations.experience_reached);

  for (let index = 0; index < 51; index += 1) {
    const id = `customer-${String(index).padStart(2, "0")}`;
    const row = message(id, {
      category: "unsorted",
      subject: index === 50 ? "Needle subject" : `Customer ${index}`,
      feedback: feedback({ environment: "customer", interpretation: "unclassified", evidenceQuotes: [id] }),
    });
    await storeMessageWithFeedback(db, id, row, `2026-10-01T13:${String(index).padStart(2, "0")}:00.000Z`);
  }
  const pageOne = await readFeedbackPage(db, { environment: "customer", offset: 0 });
  const pageTwo = await readFeedbackPage(db, { environment: "customer", offset: 50 });
  assert.equal(pageOne.items.length, 50);
  assert.equal(pageOne.total, 51);
  assert.equal(pageTwo.items.length, 1);
  const searched = await readFeedbackPage(db, { environment: "customer", q: "Needle subject", offset: 0 });
  assert.equal(searched.total, 1);

  const emptyDb = new SQLiteDatabase(join(directory, "empty.sqlite"));
  t.after(() => emptyDb.close());
  summary = await readFeedbackSummary(emptyDb);
  assert.equal(summary.totalMessages, 0);
  assert.equal(summary.assessedMessages, 0);
  assert.equal(summary.lastAnalyzedAt, null);
});

test("feedback query parsing rejects duplicate, unknown, and oversized raw parameters", () => {
  assert.deepEqual(parseFeedbackQuery(new URLSearchParams()), { environment: "beta", offset: 0, interpretation: undefined, q: undefined, messageId: undefined });
  const messageId = "a".repeat(64);
  assert.deepEqual(parseFeedbackQuery(new URLSearchParams(`environment=beta&interpretation=experience_obstructed&messageId=${messageId}`)), {
    environment: "beta", offset: 0, interpretation: "experience_obstructed", q: undefined, messageId,
  });
  assert.throws(() => parseFeedbackQuery(new URLSearchParams("environment=beta&environment=customer")));
  assert.throws(() => parseFeedbackQuery(new URLSearchParams("limit=10")));
  assert.throws(() => parseFeedbackQuery(new URLSearchParams("messageId=invalid")));
  assert.throws(() => parseFeedbackQuery(new URLSearchParams(`messageId=${messageId}&q=conflict`)));
  assert.throws(() => parseFeedbackQuery(new URLSearchParams(`q=${encodeURIComponent(" ".repeat(201))}`)));
});

test("obstruction attention exposes current reports individually and excludes stale analysis", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "secdash-feedback-attention-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = new SQLiteDatabase(join(directory, "dashboard.sqlite"));
  t.after(() => db.close());

  for (const id of ["one", "two"]) {
    await storeMessageWithFeedback(db, id, message(id, {
      feedback: feedback({ interpretation: "experience_obstructed", context: `Obstruction ${id}` }),
    }), `2026-10-17T12:0${id === "one" ? "1" : "2"}:00.000Z`);
  }
  let reports = await readFeedbackObstructionAttention(db);
  assert.deepEqual(reports.map(report => report.messageId), ["two", "one"]);
  assert.deepEqual(reports.map(report => report.context), ["Obstruction two", "Obstruction one"]);
  const exact = await readFeedbackPage(db, { environment: "beta", interpretation: "experience_obstructed", messageId: "two", offset: 0 });
  assert.deepEqual(exact.items.map(item => item.message.id), ["two"]);

  await storeMessageWithFeedback(db, "one", message("one", { body: "Changed source evidence" }), "2026-10-17T12:03:00.000Z");
  reports = await readFeedbackObstructionAttention(db);
  assert.deepEqual(reports.map(report => report.messageId), ["two"]);
});
