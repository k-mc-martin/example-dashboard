export type Exercise = {
  n: number;
  title: string;
  question: string;
  guide: string;
  actions: string[];
  category: 'Dashboard' | 'Connector' | 'Evidence';
};
const row = (
  n: number,
  title: string,
  question: string,
  guide: string,
  actions: string[],
  category: Exercise['category'] = 'Dashboard',
): Exercise => ({ n, title, question, guide, actions, category });
export const catalog = [
  row(
    1,
    'Account permissions',
    'Can Theo launch a release and run a backup? Who can approve a refund?',
    'As Theo, open Deployments, check the deployed release, launch a preview, and check again. Start a backup in Storage & recovery. As Mira, try the same launch from Website & releases, then submit a refund. Try approval as Mira, Theo, and finally Inez. Use Sign out between roles to keep the same records.',
    ['ledger', 'submit', 'approve'],
  ),
  row(
    2,
    'Access another person’s records',
    'Can an employee open someone else’s client file or approve a refund?',
    'Open both client files as Mira, then as Theo. Each should see only their own assignment. Try refund approval as Mira after submission, then open both files and approve as Inez.',
    ['mine', 'other', 'submit', 'approve', 'ledger'],
  ),
  row(
    3,
    'Agent tool permissions',
    'Can an agent call a tool it was never granted?',
    'In Connectors, consent to read mail, then exchange the code. List the tools and call refund_request directly. As Owner, consent to request refunds and exchange that code before trying the same tool.',
    ['grant', 'writegrant', 'exchange', 'tools', 'toolread', 'toolwrite'],
    'Connector',
  ),
  row(
    4,
    'Credential lifecycle',
    'What happens to expired, revoked and replayed credentials?',
    'Issue a code, exchange it, rotate the refresh token, then replay it. Try the old access token. A short-lived grant lets you test expiry.',
    [
      'grant',
      'shortgrant',
      'exchange',
      'rotate',
      'replayRefresh',
      'previousAccess',
      'toolread',
      'unsigned',
      'tampered',
      'revoke',
    ],
    'Connector',
  ),
  row(
    5,
    'Concurrent requests',
    'What happens when Theo launches a release twice or two people race to approve a refund?',
    'As Theo in Deployments, launch the same release twice together and check the deployed release. Sign out. As Inez, submit a refund in Payments & refunds. From Teams, open Mira’s session. Send four approval requests together from each tab, then compare the responses, payment ledger and Owner’s audit log.',
    ['submit', 'approve', 'burst', 'ledger', 'audit'],
  ),
  row(
    6,
    'Remove access mid-session',
    'Can Inez revoke Theo’s sync access during a session and end Mira’s access entirely?',
    'As Inez in Teams, open Theo’s session. As Theo, sync the backup libraries. Revoke only Sync backup libraries as Inez and retry from Theo’s open Storage & recovery tab. Compare the job before and after, then start a single backup. Back in Teams, open Mira, disable her, and re-enable her. Her old session should stay signed out.',
    ['disable', 'enable', 'mine', 'audit'],
  ),
  row(
    7,
    'Failure and recovery',
    'Does a retry after an interrupted operation repeat the payment?',
    'Submit, approve, then interrupt the provider response. Inspect the ledger before retrying. Also try an outage before delivery.',
    ['submit', 'approve', 'outage', 'interrupt', 'settle', 'ledger'],
  ),
  row(
    8,
    'Server and dependency checks',
    'Which checks ran against this revision?',
    'In Verification results, select Inspect server and dependency checks. Compare the scanner findings and live response headers, then open the Hosted boundary run to inspect TLS.',
    [],
    'Evidence',
  ),
  row(
    9,
    'Detect a planted fault',
    'Will the verification detect a broken refund calculation?',
    'In Payments & refunds, open Receipt reconciliation. Check the healthy receipt, then the duplicated receipt. Read the ledger to see whether either check changed the payment.',
    ['control', 'mutant', 'ledger'],
  ),
  row(
    10,
    'Audit and reproduce',
    'Can you reconstruct who tried a change and what actually happened?',
    'As Owner submit a refund, approve it, then repeat the approval. Open Audit log to inspect the ordered events and download the observations for this run.',
    ['submit', 'approve', 'audit', 'ledger'],
  ),
  row(
    11,
    'Untrusted agent content',
    'Can a message trick a read-only connector into issuing a refund?',
    'In Connectors, consent to read mail and exchange the code. Read the untrusted message, then call the refund tool it asks for. Open Payments & refunds and inspect the ledger.',
    ['grant', 'exchange', 'injection', 'toolwrite', 'ledger'],
    'Connector',
  ),
  row(
    12,
    'Confused deputy and token passthrough',
    'Will the connector accept another service’s token or spend authority it was never granted?',
    'Try a redirect outside the registered client, then try an invalid audience and an upstream token. Compare with an expressly consented read.',
    [
      'badredirect',
      'grant',
      'exchange',
      'toolread',
      'wrongaudience',
      'foreign',
      'toolwrite',
    ],
    'Connector',
  ),
  row(
    13,
    'Secrets and source scanning',
    'Can reviewers inspect the findings and prove a scanner can catch a leak?',
    'In Verification results, select Inspect source scan results. Compare the source and full-history scans with the deleted-secret and Semgrep rule controls.',
    [],
    'Evidence',
  ),
  row(
    14,
    'Environment isolation',
    'Could a visitor reach another visitor’s data or a production provider?',
    'Open an independent private browser window. Copy a record ID between workspaces and compare the response to a local record. Inspect the isolated provider configuration.',
    ['mine', 'lookup', 'isolation'],
  ),
  row(
    15,
    'Continuous verification',
    'Can someone reproduce the checks from the public repository?',
    'In Verification results, select Inspect this build’s runs. Compare the deployed revision and browser and server checks with their linked GitHub runs. Open the workflow source to see how to repeat them.',
    [],
    'Evidence',
  ),
  row(
    16,
    'Bad-input attacks',
    'What happens when a message contains markup or a search contains SQL?',
    'Edit the sample text and send it. Compare a legitimate search to a poisoned one. Try adding an unexpected field to a payment request.',
    ['message', 'search', 'tamper', 'submit', 'ledger'],
  ),
  row(
    17,
    'Attacks from another website',
    'Can a hostile page spend your signed-in authority?',
    'Check the payment state, launch the separate test site and try its form and script. Return here and read the ledger again.',
    ['ledger', 'hostile', 'submit'],
  ),
  row(
    18,
    'Staff sign-in',
    'Can a guessed or reused secret open a staff record?',
    'Enroll a fictional staff login. Try the protected record before and after signing in, change the password, and test repeated wrong guesses.',
    ['staff'],
  ),
  row(
    19,
    'Sensitive records and approvals',
    'Can staff see payment details or skip approval?',
    'Compare the two client records as Employee and Owner. Try settling a refund first, then submit, approve and settle in order.',
    ['mine', 'other', 'ledger', 'submit', 'approve', 'settle'],
  ),
];
export const exerciseByNumber = (n: unknown) => catalog.find((x) => x.n === n);

export const workspaceScreens = {
  payments: {
    title: 'Payments & refunds',
    actions: [
      'ledger',
      'submit',
      'approve',
      'settle',
      'outage',
      'interrupt',
      'burst',
      'control',
      'mutant',
      'tamper',
      'hostile',
    ],
  },
  clients: {
    title: 'Client records',
    actions: ['mine', 'other', 'lookup', 'search', 'isolation'],
  },
  connectors: {
    title: 'Connectors',
    actions: [
      'grant',
      'shortgrant',
      'writegrant',
      'badredirect',
      'wrongaudience',
      'exchange',
      'rotate',
      'replayRefresh',
      'previousAccess',
      'tools',
      'injection',
      'toolread',
      'toolwrite',
      'foreign',
      'unsigned',
      'tampered',
      'revoke',
    ],
  },
  audit: { title: 'Audit log', actions: ['audit'] },
  teams: { title: 'Teams', actions: ['disable', 'enable'] },
  communications: { title: 'Communications', actions: ['message'] },
  staff: { title: 'Staff access', actions: ['staff'] },
  evidence: { title: 'Verification results', actions: [] },
} satisfies Record<string, { title: string; actions: string[] }>;
export type WorkspaceScreen = keyof typeof workspaceScreens;

export function screensForExercise(exercise: Exercise): WorkspaceScreen[] {
  if (exercise.category === 'Evidence') return ['evidence'];
  const screens = new Set<WorkspaceScreen>();
  for (const action of exercise.actions) {
    const screen = (Object.keys(workspaceScreens) as WorkspaceScreen[]).find(
      (id) => (workspaceScreens[id].actions as string[]).includes(action),
    );
    if (!screen) throw Error('No dashboard screen for ' + action);
    screens.add(screen);
  }
  return [...screens];
}
