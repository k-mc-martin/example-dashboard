import type { SQLiteDatabase } from "../db/index.ts";
import type { z } from "zod";
import type { inboundMessage } from "./inbound.ts";
import {
  feedbackSourceFingerprint,
  type FeedbackAnalysis,
  type FeedbackEnvironment,
  type FeedbackInterpretation,
  type FeedbackItem,
  type FeedbackObstructionAttention,
  type FeedbackQuery,
  type FeedbackSummary,
} from "./feedback.ts";

type InboundMessage = z.infer<typeof inboundMessage>;

const messageUpsert = `INSERT INTO messages (id,sender,subject,body,received_at,category,support_kind,source_url,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
  sender=excluded.sender,subject=excluded.subject,body=excluded.body,received_at=excluded.received_at,
  category=excluded.category,support_kind=excluded.support_kind,source_url=excluded.source_url,updated_at=excluded.updated_at`;

export async function messageWithFeedbackStatements(db: SQLiteDatabase, id: string, message: InboundMessage, now = new Date().toISOString()) {
  const source = db.prepare(messageUpsert).bind(
    id, message.sender, message.subject, message.body, message.receivedAt, message.category,
    message.supportKind || null, message.sourceUrl || null, now,
  );
  if (!message.feedback) {
    return [source];
  }
  const feedback = message.feedback;
  const fingerprint = await feedbackSourceFingerprint(message.subject, message.body);
  const analysis = db.prepare(`INSERT INTO feedback_analysis
    (message_id,environment,interpretation,evidence_quotes_json,rationale,context,intended_experience_reference,source_fingerprint,analyzed_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(message_id) DO UPDATE SET
    environment=excluded.environment,interpretation=excluded.interpretation,evidence_quotes_json=excluded.evidence_quotes_json,
    rationale=excluded.rationale,context=excluded.context,intended_experience_reference=excluded.intended_experience_reference,
    source_fingerprint=excluded.source_fingerprint,
    analyzed_at=CASE WHEN feedback_analysis.environment=excluded.environment
      AND feedback_analysis.interpretation=excluded.interpretation
      AND feedback_analysis.evidence_quotes_json=excluded.evidence_quotes_json
      AND feedback_analysis.rationale=excluded.rationale AND feedback_analysis.context=excluded.context
      AND feedback_analysis.intended_experience_reference IS excluded.intended_experience_reference
      AND feedback_analysis.source_fingerprint=excluded.source_fingerprint
      THEN feedback_analysis.analyzed_at ELSE excluded.analyzed_at END`).bind(
        id, feedback.environment, feedback.interpretation, JSON.stringify(feedback.evidenceQuotes),
        feedback.rationale, feedback.context, feedback.intendedExperienceReference, fingerprint, now,
      );
  return [source, analysis];
}
export async function storeMessageWithFeedback(db: SQLiteDatabase, id: string, message: InboundMessage, now = new Date().toISOString()) {
  await db.batch(await messageWithFeedbackStatements(db,id,message,now));
}

type AnalysisRow = {
  messageId: string; subject: string; body: string; environment: FeedbackEnvironment;
  interpretation: FeedbackInterpretation; evidenceQuotesJson: string; rationale: string; context: string;
  intendedExperienceReference: string | null; sourceFingerprint: string; analyzedAt: string;
};

async function staleMessageIds(rows: AnalysisRow[]): Promise<Set<string>> {
  const stale = new Set<string>();
  await Promise.all(rows.map(async row => {
    if (await feedbackSourceFingerprint(row.subject, row.body) !== row.sourceFingerprint) stale.add(row.messageId);
  }));
  return stale;
}

export async function readFeedbackSummary(db: SQLiteDatabase): Promise<FeedbackSummary> {
  const [messageRows, analysisResult] = await db.batch([
    db.prepare("SELECT id,category FROM messages"),
    db.prepare(`SELECT f.message_id AS messageId,m.subject,m.body,f.environment,f.interpretation,
      f.evidence_quotes_json AS evidenceQuotesJson,f.rationale,f.context,
      f.intended_experience_reference AS intendedExperienceReference,f.source_fingerprint AS sourceFingerprint,
      f.analyzed_at AS analyzedAt FROM feedback_analysis f JOIN messages m ON m.id=f.message_id`),
  ]);
  const messages = messageRows.results as Array<{ id: string; category: string }>;
  const analyses = analysisResult.results as AnalysisRow[];
  const stale = await staleMessageIds(analyses);
  const analyzed = new Set(analyses.map(row => row.messageId));
  const summary: FeedbackSummary = {
    counts: { beta: 0, customer: 0, unclassified: 0 },
    betaInterpretations: { experience_reached: 0, experience_obstructed: 0, misinterpretation: 0, preference: 0, unclassified: 0 },
    betaUnclassified: 0,
    betaStale: 0,
    awaitingAnalysis: messages.filter(row => row.category === "beta" && !analyzed.has(row.id)).length,
    staleAnalysis: stale.size,
    assessedMessages: analyses.length,
    totalMessages: messages.length,
    lastAnalyzedAt: analyses.reduce<string | null>((latest, row) => !latest || row.analyzedAt > latest ? row.analyzedAt : latest, null),
  };
  for (const row of analyses) {
    if (row.environment !== "none") summary.counts[row.environment] += 1;
    if (row.environment === "beta") {
      if (stale.has(row.messageId)) summary.betaStale += 1;
      else if (row.interpretation !== "unclassified") summary.betaInterpretations[row.interpretation] += 1;
    }
  }
  summary.counts.beta += summary.awaitingAnalysis;
  summary.betaUnclassified = summary.awaitingAnalysis
    + analyses.filter(row => row.environment === "beta" && (stale.has(row.messageId) || row.interpretation === "unclassified")).length;
  summary.betaInterpretations.unclassified = summary.betaUnclassified;
  return summary;
}

export async function readFeedbackObstructionAttention(db: SQLiteDatabase): Promise<FeedbackObstructionAttention[]> {
  const result = await db.prepare<AnalysisRow & { receivedAt: string }>(`SELECT f.message_id AS messageId,m.subject,m.body,
    m.received_at AS receivedAt,f.environment,f.interpretation,f.evidence_quotes_json AS evidenceQuotesJson,
    f.rationale,f.context,f.intended_experience_reference AS intendedExperienceReference,
    f.source_fingerprint AS sourceFingerprint,f.analyzed_at AS analyzedAt
    FROM feedback_analysis f JOIN messages m ON m.id=f.message_id
    WHERE f.environment='beta' AND f.interpretation='experience_obstructed'
    ORDER BY m.received_at DESC,m.id DESC`).all();
  const rows = result.results;
  const stale = await staleMessageIds(rows);
  return rows.filter(row => !stale.has(row.messageId)).map(row => ({
    messageId: row.messageId,
    subject: row.subject,
    receivedAt: row.receivedAt,
    context: row.context,
    sourceFingerprint: row.sourceFingerprint,
    analyzedAt: row.analyzedAt,
  }));
}

export async function readFeedbackPage(db: SQLiteDatabase, query: FeedbackQuery): Promise<{ items: FeedbackItem[]; total: number }> {
  const where: string[] = [];
  const values: string[] = [];
  if (query.environment === "beta") {
    where.push("(f.environment = 'beta' OR (f.message_id IS NULL AND m.category = 'beta'))");
  } else {
    where.push("f.environment = ?"); values.push(query.environment);
  }
  if (query.messageId) {
    where.push("m.id = ?"); values.push(query.messageId);
  }
  if (query.q) {
    where.push("(m.subject LIKE ? ESCAPE '\\' OR m.sender LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\' OR f.context LIKE ? ESCAPE '\\' OR f.rationale LIKE ? ESCAPE '\\')");
    const pattern = `%${query.q.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  const clause = where.join(" AND ");
  const select = `FROM messages m LEFT JOIN feedback_analysis f ON f.message_id=m.id WHERE ${clause}`;
  const [rowsResult, countResult] = await db.batch([
    db.prepare(
      `SELECT m.id,m.sender,m.subject,m.body,substr(m.body,1,500) AS bodyPreview,m.received_at AS receivedAt,m.category,
       m.support_kind AS supportKind,m.source_url AS sourceUrl,f.message_id AS messageId,f.environment,f.interpretation,
       f.evidence_quotes_json AS evidenceQuotesJson,f.rationale,f.context,
       f.intended_experience_reference AS intendedExperienceReference,f.source_fingerprint AS sourceFingerprint,
       f.analyzed_at AS analyzedAt ${select} ORDER BY m.received_at DESC,m.id DESC`,
    ).bind(...values),
    db.prepare(`SELECT COUNT(*) AS count ${select}`).bind(...values),
  ]);
  const rows = rowsResult.results as Array<AnalysisRow & { id: string; sender: string; bodyPreview: string; receivedAt: string; category: string; supportKind: string | null; sourceUrl: string | null }>;
  const analysisRows = rows.filter(row => row.messageId) as typeof rows;
  const stale = await staleMessageIds(analysisRows);
  const items = rows.map(row => {
    let analysis: FeedbackAnalysis | null = null;
    if (row.messageId) {
      analysis = {
        environment: row.environment, interpretation: row.interpretation,
        evidenceQuotes: JSON.parse(row.evidenceQuotesJson) as string[], rationale: row.rationale, context: row.context,
        intendedExperienceReference: row.intendedExperienceReference, sourceFingerprint: row.sourceFingerprint,
        analyzedAt: row.analyzedAt, stale: stale.has(row.id),
      };
    }
    return {
      message: { id: row.id, sender: row.sender, subject: row.subject, bodyPreview: row.bodyPreview, receivedAt: row.receivedAt, category: row.category, supportKind: row.supportKind, sourceUrl: row.sourceUrl },
      analysis,
      status: analysis ? (analysis.stale ? "stale" : "current") : "awaiting",
    } satisfies FeedbackItem;
  }).filter(item => {
    if (!query.interpretation) return true;
    if (query.environment === "beta" && query.interpretation === "unclassified") {
      return item.status !== "current" || item.analysis?.interpretation === "unclassified";
    }
    if (item.status === "stale") return false;
    return item.analysis?.interpretation === query.interpretation;
  });
  const total = query.interpretation ? items.length : Number((countResult.results[0] as { count?: number } | undefined)?.count || 0);
  return { items: items.slice(query.offset, query.offset + 50), total };
}
