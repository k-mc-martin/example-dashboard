// Only project fields returned by known SecDash routes. Submitted content, cookie values,
// authorization codes, session identifiers and bearer credentials never enter a report.
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === 'object' ? (value as Json) : {};
const responseKeys = [
  'payment',
  'state',
  'receipt',
  'providerRefunds',
  'receiptCheck',
  'replayed',
  'amountCents',
  'billingReference',
  'client',
  'assigned',
  'enabled',
  'member',
  'revoked',
  'scope',
  'expiresIn',
  'duplicates',
  'uniqueReceiptCheck',
  'cleared',
  'source',
  'configuration',
  'message',
  'record',
  'account',
  'matches',
  'events',
  'preview',
  'content',
  'tools',
];
export function responseFacts(
  path: string,
  value: unknown,
  exercise: number,
): string[] {
  const body = object(value);
  const facts: string[] = [];
  // Errors and messages in these routes are server-authored constants.
  const error =
    typeof body.error === 'string' ? body.error : object(body.error).message;
  if (typeof error === 'string') facts.push(error.slice(0, 200));
  if (path === '/api/demo/deployments') {
    if (typeof body.deploymentCount === 'number') facts.push('Preview deployments=' + body.deploymentCount);
    const release = object(body.deployment ?? body.current);
    if (typeof release.version === 'string')
      facts.push('ExampleApp ' + release.version + ' | launched by ' + release.launchedBy);
    if (body.replayed === true) facts.push('Already deployed; no additional deployment.');
    return facts;
  }
  if (path === '/api/backups' || path === '/api/backup-catalog') {
    const job = path === '/api/backups' ? body : object(body.update);
    if (typeof job.jobId === 'string' && /^sample-\d+$/.test(job.jobId))
      facts.push('Job ' + job.jobId + ' | ' + job.state);
    if (Array.isArray(body.libraries)) facts.push('Libraries returned: ' + body.libraries.length);
    return facts;
  }
  if (path === '/api/operations') {
    const deployment = object(object(body.surfaces).cloudflare);
    if (Array.isArray(deployment.history))
      facts.push('Deployment history returned: ' + deployment.history.length + ' observations');
    return facts;
  }
  if (path.endsWith('/evidence')) {
    const checks =
      exercise === 8
        ? /^(OSV|ZAP)/
        : exercise === 13
          ? /^(Gitleaks|Semgrep)/
          : /^(Browser checks|Server checks|Exercise \d+)/;
    const workflows =
      exercise === 8
        ? ['Security tools', 'Hosted boundary']
        : exercise === 13
          ? ['Security tools']
          : [
              'Exercise campaign',
              'Security tools',
              'Hosted boundary',
              'Hosted dashboard exercises',
            ];
    if (typeof body.commit === 'string')
      facts.push('Evidence revision ' + body.commit);
    if (Array.isArray(body.checks))
      for (const c of body.checks.filter((c) => checks.test(c.name)))
        facts.push(c.name + ' | ' + c.status + ' | ' + c.detail);
    if (Array.isArray(body.runs))
      for (const r of body.runs.filter((r) => workflows.includes(r.title)))
        facts.push(
          r.title +
            ' | ' +
            r.status +
            ' | https://github.com/k-mc-martin/example-dashboard/actions/runs/' +
            r.id,
        );
    if (Array.isArray(body.checks) && !body.checks.length)
      facts.push('No scanner or CI results published for this revision.');
    return facts;
  }
  for (const key of responseKeys) {
    const v = body[key];
    if (
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      typeof v === 'string'
    ) {
      if (key === 'preview')
        facts.push(
          'Preview returned as a JSON string (' +
            String(v).length +
            ' characters).',
        );
      else facts.push(key + '=' + String(v).slice(0, 180));
    } else if (Array.isArray(v)) facts.push(key + ' count=' + v.length);
  }
  for (const key of [
    'code',
    'activation',
    'access',
    'refresh',
    'providerToken',
  ]) {
    if (typeof body[key] === 'string')
      facts.push(key + ' issued (value omitted)');
  }
  if (typeof body.id === 'string' && body.client)
    facts.push('Record ID returned');
  if (body.client || body.payment)
    facts.push(
      'Response fields: ' +
        Object.keys(body)
          .filter((k) => k === 'id' || responseKeys.includes(k))
          .join(', '),
    );
  if (body.receiptCheck) {
    const c = object(body.receiptCheck);
    facts.push(
      'Receipt verification: expected ' +
        c.expected +
        ', actual ' +
        c.actual +
        ', duplicates ' +
        c.duplicates +
        ', pass=' +
        c.pass,
    );
  }
  if (body.account) {
    const a = object(body.account);
    facts.push('Signed in as ' + a.name + ' (' + a.role + ')');
  }
  if (body.account === null) facts.push('No signed-in account');
  if (Array.isArray(body.members))
    for (const m of body.members) {
      facts.push(
        m.name +
          ' (' +
          m.role +
          '): ' +
          Object.entries(object(m.permissions))
            .map(([k, v]) => k + '=' + v)
            .join(', '),
      );
    }
  if (body.url) facts.push('Outside-origin exercise URL returned');
  const result = object(body.result);
  if (Array.isArray(result.tools))
    facts.push(
      'Tools disclosed: ' + result.tools.map((t) => t.name).join(', '),
    );
  if (Array.isArray(result.content))
    for (const item of result.content) {
      if (item.text?.startsWith('Refund submitted.'))
        facts.push('Refund submitted; Owner approval required.');
      if (item.text?.startsWith('Fictional inbound email'))
        facts.push(
          'Returned fictional inbound mail containing an untrusted refund_request instruction.',
        );
    }
  return facts;
}
