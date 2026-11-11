import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  demoEnabled,
  demoOriginAllowed,
  primaryHost,
  workspaceId,
} from '@/lib/demo-session';
import { catalog } from '@/lib/security-lab/catalog';
import {
  enqueue,
  latestJob,
  type SuiteJob,
  type CaseResult,
} from '@/lib/review/queue';
import { pdfDownload } from '@/lib/review/report';
const cookie = '__Host-secdash_review';
function visitor(request: Request) {
  const w = workspaceId(request);
  if (
    !w ||
    !demoEnabled() ||
    !demoOriginAllowed(request) ||
    !primaryHost(request.headers.get('host'))
  )
    return null;
  const mac = (input: string) =>
    createHmac('sha256', process.env.SECDASH_SESSION_SECRET!)
      .update(input)
      .digest('hex');
  const token = request.headers
    .get('cookie')
    ?.split(/;\s*/)
    .find((v) => v.startsWith(cookie + '='))
    ?.slice(cookie.length + 1);
  const id =
    token &&
    /^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token) &&
    timingSafeEqual(
      Buffer.from(token.slice(65), 'hex'),
      Buffer.from(mac('suite-cookie:' + token.slice(0, 64)), 'hex'),
    )
      ? token.slice(0, 64)
      : mac('suite-visitor:' + w);
  return {
    owner: mac('suite-owner:' + id),
    token: id + '.' + mac('suite-cookie:' + id),
  };
}
function status(job: SuiteJob | undefined | null) {
  if (!job) return null;
  const cases: CaseResult[] = JSON.parse(job.cases);
  return {
    state: job.state,
    completed: cases.filter((c) => c.verdict !== 'running').length,
    passed: cases.filter((c) => c.verdict === 'passed').length,
    failed: cases.filter((c) => c.verdict === 'failed').length,
    current: cases.find((c) => c.verdict === 'running')?.title,
  };
}
export function POST(req: Request) {
  const who = visitor(req);
  if (!who) return new Response(null, { status: 403 });
  const job = enqueue(
    who.owner,
    process.env.SECDASH_REVISION || 'local',
    new URL(req.url).searchParams.get('again') === '1',
  );
  if (!job)
    return NextResponse.json(
      {
        error: 'Six reviews are already queued or running. Try again shortly.',
      },
      { status: 429 },
    );
  const r = NextResponse.json(status(job));
  r.cookies.set(cookie, who.token, {
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 28800,
  });
  return r;
}
export async function GET(req: Request) {
  const who = visitor(req);
  if (!who) return new Response(null, { status: 403 });
  const job = latestJob(who.owner);
  if (!new URL(req.url).searchParams.has('download'))
    return NextResponse.json(status(job));
  if (!job || ['running', 'queued'].includes(job.state))
    return new Response(null, { status: 409 });
  const cases: CaseResult[] = JSON.parse(job.cases);
  const result = status(job)!;
  return pdfDownload(
    {
      title: 'Security exercise suite',
      revision: job.revision,
      generated: new Date().toISOString(),
      introduction:
        'Automated verification against the fictional SecDash backend. Each exercise used an isolated visitor workspace. Status codes, receipt IDs and redacted field values below were collected from actual HTTP responses.',
      sections: [
        {
          title: 'Run ' + job.id,
          lines: [
            new Date(job.created).toISOString() +
              ' to ' +
              new Date(job.updated).toISOString(),
            result.passed +
              ' passed / ' +
              result.failed +
              ' failed / ' +
              (catalog.length - result.completed) +
              ' incomplete. Each pass requires the scripted assertions for that scenario to finish.',
            'Exercises 8, 13 and 15 inspect previously published build evidence. Their entries identify the revision and the underlying checks. A refused request may be the expected outcome. A missing response is recorded separately.',
            'Test source: https://github.com/k-mc-martin/example-dashboard/blob/' +
              job.revision +
              '/tests/browser/dashboard.test.mjs',
          ],
        },
        {
          title: 'Results by exercise',
          lines: catalog.map((e) => {
            const c = cases.find((row) => row.n === e.n);
            return (
              e.n +
              '. ' +
              e.title +
              ' | ' +
              (c && c.verdict !== 'running'
                ? c.verdict.toUpperCase()
                : 'INCOMPLETE') +
              ' | ' +
              (c?.records.length || 0) +
              ' network observations'
            );
          }),
        },
        ...catalog.map((e) => {
          const c = cases.find((v) => v.n === e.n);
          return {
            title:
              'Exercise ' +
              e.n +
              ' - ' +
              e.title +
              ' | ' +
              (c?.verdict === 'running' || !c
                ? 'INCOMPLETE'
                : c.verdict.toUpperCase()),
            lines: [
              c?.criterion || e.question,
              ...(c?.note ? [c.note] : []),
              ...(c?.records || []).flatMap((r, i) => [
                i +
                  1 +
                  '. ' +
                  r.at +
                  ' | ' +
                  r.identity +
                  ' | ' +
                  r.method +
                  ' ' +
                  r.path +
                  ' ' +
                  r.operation +
                  ' | ' +
                  (r.status ? 'HTTP ' + r.status : 'No readable response'),
                ...(r.receipt ? ['Server receipt ' + r.receipt] : []),
                ...r.facts,
              ]),
            ],
          };
        }),
      ],
    },
    'SecDash-19-exercise-results.pdf',
  );
}
