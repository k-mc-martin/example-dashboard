import { withDashboardDb } from "@/lib/demo-db";
import { parseFeedbackQuery, type FeedbackResponse } from "@/lib/feedback";
import { readFeedbackPage, readFeedbackSummary } from "@/lib/feedback-store";
import { authorized, denied } from "@/lib/server-auth";

export async function GET(request: Request) {
  if (!authorized(request, "operator")) return denied(request);
  let query;
  try { query = parseFeedbackQuery(new URL(request.url).searchParams); } catch {
    return Response.json({ error: "Invalid feedback query." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    return await withDashboardDb(request, async db => {
      const [summary, page] = await Promise.all([
        readFeedbackSummary(db),
        readFeedbackPage(db, query),
      ]);
      const response: FeedbackResponse = {
        fetchedAt: new Date().toISOString(), summary, items: page.items, total: page.total,
        offset: query.offset, hasMore: query.offset + page.items.length < page.total,
      };
      return Response.json(response, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    });
  } catch {
    return Response.json({ error: "Feedback is unavailable. Saved messages are unchanged." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
