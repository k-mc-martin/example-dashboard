export const demoAccounts = [
  { id: 'mira', name: 'Mira Chen', role: 'Employee' },
  { id: 'theo', name: 'Theo Reed', role: 'Administrator' },
  { id: 'inez', name: 'Inez Park', role: 'Owner' },
] as const;

export type DemoRole = typeof demoAccounts[number]['role'];
export type DemoIdentity = { id: typeof demoAccounts[number]['id']; name: string; role: DemoRole };
export const permissionLabels = {
  deployments: 'View deployment history and inventory',
  storage: 'View storage and backup history',
  startBackup: 'Start backups',
  syncBackups: 'Sync backup libraries',
} as const;
export type TeamPermissions = Record<keyof typeof permissionLabels, boolean>;
export type DemoAccount = DemoIdentity & { permissions: TeamPermissions };
export function defaultPermissions(role: DemoRole): TeamPermissions {
  const allowed = role !== 'Employee';
  return { deployments: allowed, storage: allowed, startBackup: allowed, syncBackups: allowed };
}
export function validPermissions(input: unknown): input is TeamPermissions {
  if (!input || typeof input !== 'object') return false;
  const flags = input as Record<string, unknown>;
  return Object.keys(flags).length === Object.keys(permissionLabels).length &&
    Object.keys(permissionLabels).every(key => typeof flags[key] === 'boolean') &&
    (flags.storage === true || (!flags.startBackup && !flags.syncBackups));
}
const employee = ['communications', 'feedback', 'website'] as const;
const administrator = [...employee, 'deployments', 'storage'] as const;
const owner = [...administrator, 'command', 'accounts', 'operations', 'teams'] as const;
export type DemoSection = typeof owner[number];
export function accountSections(account: DemoAccount): readonly DemoSection[] {
  if (account.role === 'Owner') return owner;
  return administrator.filter(section =>
    section === 'deployments' || section === 'storage' ? account.permissions[section] : true);
}

export function requestSection(request: Request): DemoSection | undefined {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  if (path === '/api/demo/teams' && ['GET', 'PUT'].includes(method)) return 'teams';
  if (path === '/api/demo/deployments' && ['GET', 'POST'].includes(method)) return 'deployments';
  if (method === 'POST') {
    if (path === '/api/demo/member-tab') return 'teams';
    if (path === '/api/demo/events') return 'communications';
    if (path === '/api/attention-dismissals') return 'command';
    if (path === '/api/backups' || path === '/api/backup-catalog') return 'storage';
    return;
  }
  if (method !== 'GET') return;
  if (path === '/api/dashboard' || /^\/api\/messages\/[a-f0-9]{64}$/.test(path)) return 'communications';
  if (path === '/api/feedback') return 'feedback';
  if (['/api/releases', '/api/demo/site', '/api/demo/artifact'].includes(path)) return 'website';
  if (['/api/drive-storage', '/api/backups', '/api/backup-catalog'].includes(path)) return 'storage';
  if (path === '/api/health' || path === '/api/attention-dismissals') return 'command';
  if (path === '/api/operations') {
    const surfaces = url.searchParams.getAll('surface');
    if (!surfaces.length) return 'operations';
    if (surfaces.length !== 1) return;
    if (surfaces[0] === 'cloudflare') return 'deployments';
    if (surfaces[0] === 'recovery') return 'storage';
    if (['azure', 'godaddy', 'lemonsqueezy'].includes(surfaces[0])) return 'operations';
  }
}
