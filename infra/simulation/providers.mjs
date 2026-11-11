import { aggregateCloudflare } from '../n8n/workflows/providers/operational-cloudflare.mjs';
import { aggregateAzure } from '../n8n/workflows/providers/operational-azure.mjs';
import { projectGoDaddy } from '../n8n/workflows/providers/operational-godaddy.mjs';
import { aggregateLemonSqueezy } from '../n8n/workflows/providers/operational-lemonsqueezy.mjs';

const projectNames = ['secdash-public', 'secdash-beta'];
const subscriptionId = '00000000-0000-4000-8000-000000000001';
const signingId =
  '/subscriptions/' +
  subscriptionId +
  '/resourceGroups/demo-signing-rg/providers/Microsoft.CodeSigning/codeSigningAccounts/demo-signing';
const identities = {
  cloudflare: {
    accountId: '00000000000000000000000000000001',
    pagesProjects: projectNames,
    r2Bucket: 'secdash-downloads',
  },
  azure: {
    subscriptionId,
    resourceGroup: 'demo-signing-rg',
    resourceType: 'Microsoft.CodeSigning/codeSigningAccounts',
    accountName: 'demo-signing',
  },
  godaddy: { domain: 'example.invalid' },
  lemonsqueezy: { storeId: '100001', domain: 'store.example.invalid' },
};
const iso = (ms) => new Date(ms).toISOString();
const day = 86400000;

export function parseScenario(input) {
  if (
    !input ||
    !Number.isSafeInteger(input.seed) ||
    input.seed < 0 ||
    input.seed > 0xffffffff ||
    !Number.isSafeInteger(input.step) ||
    input.step < 1 ||
    input.step > 30000 ||
    !Number.isSafeInteger(input.start) ||
    !Number.isSafeInteger(input.time) ||
    input.start < Date.UTC(2020, 0) ||
    input.time < input.start ||
    input.time > Date.now() + 60000 ||
    input.time - input.start > day
  )
    throw Error('Invalid simulation coordinates');
  const { seed, step, start, time } = input;
  return { seed, step, start, time, at: iso(time) };
}

function order(s, index) {
  const product = (s.seed + index) % 3;
  const price = [1200, 2900, 4900][product];
  const refunded = index % 8 === 0;
  const date =
    index < 14 ? s.start - (14 - index) * day : Math.min(s.time, s.start + (index - 14) * 1000);
  return {
    type: 'orders',
    id: 'sample-' + index,
    attributes: {
      store_id: 100001,
      test_mode: index < 14 && index % 6 === 0,
      status: refunded ? 'refunded' : 'paid',
      total_usd: price,
      refunded_amount_usd: refunded ? price : 0,
      created_at: iso(date),
      first_order_item: {
        product_id: product + 1,
        variant_id: 10 + product,
        product_name: ['Field Notes', 'Studio Kit', 'Atlas Edition'][product],
        variant_name: 'Desktop',
      },
    },
  };
}

function commerce(s) {
  const last = 13 + s.step;
  // A rolling 90-order source keeps each visitor's simulation bounded.
  const rows = Array.from({ length: Math.min(last + 1, 90) }, (_, i) =>
    order(s, Math.max(0, last - 89) + i),
  );
  return aggregateLemonSqueezy([{ data: rows, meta: { page: { currentPage: 1, lastPage: 1 } } }], s.at);
}

const letters = [
  [
    'beta',
    'Mira',
    'Reviewing the beta export',
    'In the beta, the export button stays disabled after I select a folder.',
  ],
  [
    'support',
    'Theo',
    'Moving my saved layouts',
    'How can I move my saved layouts to a second computer?',
  ],
  [
    'errors',
    'Build monitor',
    'Preview failed to render',
    'The sample preview returned an error while rendering a layer.',
  ],
  [
    'infrastructure',
    'Service monitor',
    'Delivery retry completed',
    'The simulated delivery queue retried one delayed event.',
  ],
  ['unsorted', 'Rowan', 'Workshop schedule', 'I have a new agenda for the illustration workshop.'],
  [
    'support',
    'Inez',
    'The project opened successfully',
    'As a customer I reopened the saved project and all layers were present.',
  ],
];
function mail(s) {
  function letter(index, sequence, ago) {
    const [category, sender, title, text] = letters[index];
    const caseNumber = (s.seed % 7000) + 1000 + sequence;
    const subject = title + ' · ' + caseNumber;
    const build = release(s).version;
    const body = text + ' Reference ' + caseNumber + ', build ' + build + '.';

    const message = {
      source: 'secdash-mail',
      messageId: [s.seed, sequence, index].join('-'),
      sender: sender + ' <desk' + index + '@example.invalid>',
      category,
      subject,
      body,
      receivedAt: iso(s.time - ago),
    };
    if (index === 0 || index === 5)
      message.feedback = {
        environment: index === 0 ? 'beta' : 'customer',
        interpretation: index === 0 ? 'experience_obstructed' : 'unclassified',
        evidenceQuotes: [body],
        rationale: 'The sender describes a specific outcome.',
        context: subject,
        intendedExperienceReference: null,
      };
    return message;
  }
  const recent = order(s, 13 + s.step);
  const sale = recent.attributes;
  const receipt = {
    source: 'demo-store',
    messageId: s.seed + '-' + recent.id,
    sender: 'Demo store <orders@example.invalid>',
    category: 'purchases',
    subject:
      (sale.status === 'refunded' ? 'Refund' : 'Sale') + ' · ' + sale.first_order_item.product_name,
    body: 'Order ' + recent.id + ' · USD ' + (sale.total_usd / 100).toFixed(2) + ' · ' + sale.status,
    receivedAt: s.at,
  };
  const messages =
    s.step === 1
      ? letters.map((_, i) => letter(i, 1, (i + 1) * 60000))
      : [letter((s.seed + s.step) % letters.length, s.step, 0)];
  return [...messages, receipt];
}

function release(s) {
  const version = '1.' + (s.seed % 7) + '.' + Math.floor((s.step - 1) / 3);
  const installers = [
    ['Windows', 'x64 / EXE', 'exe'],
    ['Mac', 'Apple Silicon / DMG', 'dmg'],
  ].map(([platform, arch, ext], i) => ({
    platform,
    arch,
    filename: 'ExampleApp_' + version + '.' + ext,
    available: true,
    bytes: 24_000_000 + (s.seed % 1024) + 1000 * Math.floor((s.step - 1) / 3) + i * 800000,
    url: '/api/demo/artifact?platform=' + platform,
  }));
  return {
    version,
    publishedAt: iso(Math.min(s.time, s.start + Math.floor((s.step - 1) / 3) * 1000)),
    installers,
  };
}

function edge(s, published) {
  const pages = {};
  for (const project of projectNames)
    for (const env of ['production', 'preview']) {
      const pending = env === 'preview' && s.step % 4 === 2;
      pages[project + ':' + env] = {
        success: true,
        result: [
          {
            id: project + '-' + env + '-' + s.step,
            project_name: project,
            environment: env,
            url: 'https://' + project + '.sites.example.invalid',
            created_on: s.at,
            latest_stage: { name: pending ? 'build' : 'deploy', status: pending ? 'active' : 'success' },
            deployment_trigger: {
              type: 'github:push',
              metadata: { branch: env === 'production' ? 'main' : 'preview' },
            },
          },
        ],
      };
    }
  pages.r2 = [
    {
      success: true,
      result: published.installers.map((file) => ({
        key: 'releases/' + published.version + '/' + file.filename,
        size: file.bytes,
        last_modified: published.publishedAt,
        storage_class: 'Standard',
      })),
    },
  ];
  return aggregateCloudflare(pages, s.at);
}

function signing(s) {
  const profile = {
    id: signingId + '/certificateProfiles/release',
    name: 'release',
    properties: { profileType: 'PublicTrust', status: 'Active' },
  };
  return aggregateAzure(
    {
      id: signingId,
      name: 'demo-signing',
      location: 'westus',
      properties: { provisioningState: 'Succeeded' },
    },
    { value: [profile] },
    [
      {
        value: [
          {
            id: 'sample-signer',
            properties: {
              scope: profile.id,
              principalType: 'ServicePrincipal',
              principalId: '00000000-0000-4000-8000-000000000002',
              roleDefinitionId:
                signingId +
                '/providers/Microsoft.Authorization/roleDefinitions/00000000-0000-4000-8000-000000000003',
            },
          },
        ],
      },
      { value: [] },
    ],
    s.at,
  );
}

function simulatedUsage(s) {
  const calls = 5 + (s.seed % 9) + s.step;
  const total = {
    calls,
    inputTokens: calls * 480,
    outputTokens: calls * 40,
    estimatedCostUsd: calls * 0.00012,
  };
  const date = s.at.slice(0, 10);
  return {
    status: 'ok',
    measuredAt: s.at,
    trackingStartedAt: iso(s.start - day),
    windowStartedAt: iso(s.start - day),
    model: 'gpt-5.6-luna',
    currency: 'USD',
    monthKey: date.slice(0, 7),
    today: total,
    month: total,
    window: total,
    reservedMonthUsd: total.estimatedCostUsd,
    limits: { perRunUsd: 0.01, perDayUsd: 0.25, perMonthUsd: 5 },
    daily: [{ date, ...total }],
    unresolvedCalls: 0,
  };
}

function recovery(s) {
  const libraries = [
    ['dashboard-n8n', 'Workflow data'],
    ['example-app-source', 'Example app source'],
  ].map(([id, name], i) => {
    const snapshotId = 'sample-' + s.seed + '-' + s.step + '-' + i;
    const sizeBytes = 4000000 + s.step * 1400 + i * 19000;
    return {
      id,
      name,
      mode: 'active-sync',
      setup: 'initialized',
      eligibleForSync: true,
      phase: 'complete',
      summary: 'Sample snapshot verified.',
      sourceLogicalBytes: sizeBytes,
      destinations: [
        {
          id: 'drive',
          label: 'Demo backup drive',
          kind: 'google-drive',
          status: 'current',
          lastSnapshot: { snapshotId, createdAt: s.at, sizeBytes },
          lastVerification: { status: 'passed', verifiedAt: s.at, snapshotId },
          repositoryBytes: sizeBytes,
          repositoryBytesStatus: 'measured',
          repositoryBytesMeasuredAt: s.at,
          history: [
            {
              id: snapshotId,
              kind: 'snapshot',
              status: 'succeeded',
              occurredAt: s.at,
              snapshotId,
              summary: 'Sample snapshot complete.',
            },
          ],
        },
      ],
    };
  });
  const names = [
    'AzureOperational',
    'CloudflareOperational',
    'GoDaddyOperational',
    'GoogleDriveStorage',
    'LemonSqueezyOperational',
    'MailboxContinuityPrepared',
    'MailboxRoutingDrain',
    'RecoveryOperational',
  ];
  const data = {
    schemaVersion: 1,
    generatedAt: s.at,
    backupFolder: {
      name: 'SecDash Backups',
      bytes: libraries.reduce((a, l) => a + l.sourceLogicalBytes, 0),
      objects: 4 + s.step,
      measuredAt: s.at,
    },
    restoreChecks: [
      {
        checkedAt: s.at,
        requestedSnapshot: 'latest',
        ok: true,
        checksumsVerified: 8,
        sourceCreatedAt: s.at,
        credentialDecryptionVerified: true,
        counts: { credentials: 0, users: 3, workflows: 8 },
        serverDashboard: { messages: 7 + s.step, tables: 6 },
      },
    ],
    automation: {
      measuredAt: s.at,
      workflows: names.map((name, i) => ({
        id: 'SecDash' + name,
        name: [
          'Signing inventory',
          'Edge deployments',
          'Domain inventory',
          'Drive storage',
          'Store sales',
          'Mailbox intake',
          'Mail routing',
          'Recovery',
        ][i],
        active: true,
      })),
      executionHistoryAvailable: true,
      lastExecution: {
        workflowId: 'SecDashRecoveryOperational',
        status: 'success',
        startedAt: iso(s.time - 180),
        finishedAt: s.at,
        durationMs: 180,
      },
      failureCount24h: 0,
      aiUsage: simulatedUsage(s),
    },
    backupCatalog: { schemaVersion: 1, generatedAt: s.at, libraries },
  };
  return { surface: 'recovery', status: 'ok', observedAt: s.at, data };
}

const feeds = {
  mail,
  releases: release,
  sales: commerce,
  signing,
  recovery,
  edge: (s) => edge(s, release(s)),
  domains: (s) =>
    projectGoDaddy(
      {
        domain: 'example.invalid',
        status: 'ACTIVE',
        expiresAt: iso(s.start + 180 * day),
        renewBy: iso(s.start + 165 * day),
        autoRenew: true,
        privacy: true,
        transferLock: true,
        nameServers: ['ns1.example.invalid', 'ns2.example.invalid'],
      },
      s.at,
    ),
  accounts: (s) =>
    Object.entries(identities).map(([provider, identity]) => ({
      provider,
      identity,
      status: 'verified',
      checkedAt: s.at,
    })),
  drive: (s) => {
    const bytes = 8_000_000 + (s.seed % 500000) + 5000 * s.step;
    return {
      provider: 'google-drive',
      observedAt: s.at,
      status: 'ok',
      quota: {
        limitBytes: '15000000000',
        driveBytes: String(bytes),
        usedBytes: String(bytes + 4096),
        trashBytes: '4096',
      },
    };
  },
};
export const feedNames = Object.keys(feeds);
export function providerEvent(name, input) {
  if (!Object.hasOwn(feeds, name)) throw Error('Unknown provider');
  const s = parseScenario(input);
  return { name, step: s.step, observedAt: s.at, value: feeds[name](s) };
}
