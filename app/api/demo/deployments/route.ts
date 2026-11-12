import { withDashboardDb } from '@/lib/demo-db';
import { state } from '@/lib/demo-events';
import { currentAccount } from '@/lib/demo-login';
import { demoEnabled } from '@/lib/demo-session';
import { observedOperations } from '@/lib/review/manual';
import { authorized, denied } from '@/lib/server-auth';

async function deployments(request: Request) {
  if (!demoEnabled() || !authorized(request, 'operator'))
    return denied(request);
  const launch = request.method === 'POST';
  let version: string | undefined;
  if (launch) {
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      !('version' in body) ||
      Object.keys(body).length !== 1 ||
      typeof body.version !== 'string' ||
      !/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(body.version)
    )
      return Response.json(
        { error: 'Select a published ExampleApp release.' },
        { status: 400 },
      );
    version = body.version;
  }
  // Recheck after reading the body. From here through the workspace write there is no await.
  const account = currentAccount(request);
  if (!account || !authorized(request, 'operator')) return denied(request);
  return withDashboardDb(request, (db) => {
    db.native.exec(`CREATE TABLE IF NOT EXISTS preview_deployments (
      id INTEGER PRIMARY KEY, version TEXT UNIQUE NOT NULL, launchedBy TEXT NOT NULL, deployedAt TEXT NOT NULL
    )`);
    const latest = () =>
      db.native
        .prepare(
          'SELECT id,version,launchedBy,deployedAt FROM preview_deployments ORDER BY id DESC LIMIT 1',
        )
        .get() ?? null;
    const count = () =>
      Number(
        db.native
          .prepare('SELECT count(*) AS total FROM preview_deployments')
          .get()!.total,
      );
    if (!launch)
      return Response.json({
        environment: 'Preview',
        current: latest(),
        deploymentCount: count(),
      });
    return db.transaction(() => {
      const previous = db.native
        .prepare('SELECT * FROM preview_deployments WHERE version=?')
        .get(version!);
      if (previous)
        return Response.json({
          environment: 'Preview',
          deployment: previous,
          deploymentCount: count(),
          replayed: true,
        });
      const feed = state(db);
      if (!feed)
        return Response.json(
          { error: 'Waiting for the first release.' },
          { status: 503 },
        );
      if (JSON.parse(feed.published).version !== version)
        return Response.json(
          {
            error:
              'The published version changed. Refresh the release and try again.',
          },
          { status: 409 },
        );
      db.native
        .prepare(
          'INSERT INTO preview_deployments(version,launchedBy,deployedAt) VALUES(?,?,?)',
        )
        .run(version!, account.name, new Date().toISOString());
      return Response.json(
        {
          environment: 'Preview',
          deployment: latest(),
          deploymentCount: count(),
          replayed: false,
        },
        { status: 201 },
      );
    });
  });
}

function handle(request: Request) {
  return observedOperations(request, deployments);
}
export { handle as GET, handle as POST };
