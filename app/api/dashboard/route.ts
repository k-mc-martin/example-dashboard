import { currentAccount } from '@/lib/demo-login';
import { demoEnabled } from '@/lib/demo-session';
import { withDashboardDb } from "@/lib/demo-db";
import { readFeedbackObstructionAttention, readFeedbackSummary } from "@/lib/feedback-store";
import { authorized, denied } from "@/lib/server-auth";
export async function GET(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  try {
    return await withDashboardDb(request, async db => {
      const [rows, counts, latest] = await db.batch([
        db.prepare("SELECT id,sender,subject,substr(body,1,180) AS body,received_at AS receivedAt,category,support_kind AS supportKind,source_url AS sourceUrl FROM messages ORDER BY received_at DESC,id DESC LIMIT 501"),
        db.prepare("SELECT category,COUNT(*) AS count FROM messages GROUP BY category"),
        db.prepare("SELECT MAX(updated_at) AS lastSync FROM messages"),
      ]);
      const grouped = counts.results as {category:string;count:number}[];
      const sync = latest.results as {lastSync:string | null}[];
      const inbox = {messages: rows.results.slice(0,500), hasMore: rows.results.length > 500,
        counts: Object.fromEntries(grouped.map(r => [r.category,r.count])), lastSync: sync[0]?.lastSync || null};
      if (demoEnabled() && currentAccount(request)?.role !== 'Owner') return Response.json(inbox);
      const providerRows = await db.prepare<{provider:string;status:string;identityJson:string;checkedAt:string}>("SELECT provider,status,identity_json AS identityJson,checked_at AS checkedAt FROM provider_connections ORDER BY provider").all();
      const providerConnections = Object.fromEntries((providerRows.results as Array<{provider:string;status:string;identityJson:string;checkedAt:string}>).map(row => [row.provider, { provider: row.provider, status: row.status, identity: JSON.parse(row.identityJson), checkedAt: row.checkedAt }]));
      const [feedback, attentionFeedbackObstructions] = await Promise.all([
        readFeedbackSummary(db),
        readFeedbackObstructionAttention(db),
      ]);
      return Response.json({ feedback, attentionFeedbackObstructions, ...inbox, providerConnections }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    });
  } catch { return Response.json({ error: "The inbox is unavailable. Saved messages are unchanged." }, { status: 503 }); }
}
