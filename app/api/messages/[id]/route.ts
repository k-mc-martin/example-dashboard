import { withDashboardDb } from "@/lib/demo-db";
import { authorized, denied } from "@/lib/server-auth";
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  if (!authorized(request, "operator")) return denied(request);
  const {id} = await params;
  if (!/^[a-f0-9]{64}$/.test(id)) return Response.json({error:"Invalid message ID"},{status:400});
  try {
    const message = await withDashboardDb(request, db => db.prepare("SELECT id,sender,subject,body,received_at AS receivedAt,category,support_kind AS supportKind,source_url AS sourceUrl FROM messages WHERE id = ?").bind(id).first());
    return message ? Response.json({message}, {headers:{"Cache-Control":"no-store"}}) : Response.json({error:"Message not found"},{status:404});
  } catch { return Response.json({error:"Message is temporarily unavailable"},{status:503}); }
}
