import { observed } from '@/lib/review/manual';
import { readFile } from 'node:fs/promises';
import {
  demoEnabled,
  demoOriginAllowed,
  primaryHost,
  workspaceId,
} from '@/lib/demo-session';
import { retiredWorkspace } from '@/lib/demo-login';
import { runFor } from '@/lib/security-lab/store';
import { exerciseByNumber } from '@/lib/security-lab/catalog';

async function handleGET(request: Request) {
  const workspace = workspaceId(request);
  if (
    !demoEnabled() ||
    !demoOriginAllowed(request) ||
    !primaryHost(request.headers.get('host')) ||
    !workspace ||
    retiredWorkspace(workspace) ||
    exerciseByNumber(runFor(workspace)?.n)?.category !== 'Evidence'
  ) {
    return new Response(null, { status: 403 });
  }
  const commit = process.env.SECDASH_REVISION || 'local';
  if (/^[a-f0-9]{40}$/.test(commit)) {
    try {
      const report = JSON.parse(
        await readFile('/demo-evidence/' + commit + '.json', 'utf8'),
      );
      if (
        report.commit === commit &&
        Array.isArray(report.runs) &&
        Array.isArray(report.checks)
      ) {
        return Response.json(report);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return Response.json(
          { error: 'The published evidence could not be read.' },
          { status: 503 },
        );
      }
    }
  }
  return Response.json({ commit, runs: [], checks: [] });
}

export function GET(req:Request){return observed(req, handleGET);}
