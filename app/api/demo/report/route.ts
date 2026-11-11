import {
  demoEnabled,
  demoOriginAllowed,
  workspaceId,
  memberHost,
} from '@/lib/demo-session';
import { currentAccount, retiredWorkspace } from '@/lib/demo-login';
import { runFor } from '@/lib/security-lab/store';
import { exerciseByNumber } from '@/lib/security-lab/catalog';
import { manualReport } from '@/lib/review/manual';
import { pdfDownload } from '@/lib/review/report';
export async function GET(req: Request) {
  const w = demoEnabled() && demoOriginAllowed(req) && workspaceId(req);
  if (!w || retiredWorkspace(w)) return new Response(null, { status: 403 });
  const ex = exerciseByNumber(runFor(w)?.n),
    account = currentAccount(req);
  if (
    !ex ||
    (!account &&
      (ex.category !== 'Evidence' || memberHost(req.headers.get('host'))))
  )
    return new Response(null, { status: 403 });
  return pdfDownload(
    manualReport(
      ex,
      w,
      account?.id || 'reviewer',
      account?.role || 'Reviewer',
      process.env.SECDASH_REVISION || 'local',
    ),
    'SecDash-exercise-' + ex.n + '-report.pdf',
  );
}
