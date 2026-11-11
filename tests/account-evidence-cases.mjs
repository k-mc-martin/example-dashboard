// The same case names and ASVS IDs appear in Node test output and in the generated report.
function check(title, ids, method = 'HTTP integration') {
  const requirements = ids.map(id => 'v5.0.0-' + id);
  return { title, requirements, method, test: [title, ...requirements].join(' · ') };
}
export const cases = {
  roles: check('Allowed reads and backup writes for three roles', ['8.2.1','8.3.1']),
  fields: check('Fields returned by the inbox, deployment and storage feeds', ['8.2.3']),
  isolation: check('Objects and sessions stay within the visitor workspace', ['8.2.2','8.4.1']),
  login: check('Reject forged identity, stale login and cross-origin logout', ['7.2.1','7.2.2','7.2.4','7.4.1']),
  memberTabs: check('Independent member session enforces live grants and revocations', ['8.2.1','8.3.1','8.3.2','8.4.1']),
  cookies: check('Host-only Secure, HttpOnly and SameSite cookies', ['3.3.1','3.3.2','3.3.3']),
  expiry: check('A login created just before workspace expiry also expires', ['7.3.2','7.4.1'], 'Clock-controlled integration'),
  fault: check('Detect an injected owner-only field in an employee response', [], 'Deliberate response fault'),
};
export const manualChecks = [
  ['8.1.1', 'Review the documented role and object permissions against the dashboard.'],
  ['8.1.2', 'Review the documented field restrictions against all shared feeds.'],
  ['7.2.3', 'Review random-token generation and entropy at the assessed commit.'],
  ['7.4.4', 'Review visible sign-out controls across authenticated screens.'],
].map(([id, reason]) => ({ id: 'v5.0.0-' + id, method: 'Manual review', status: 'Not yet tested', reason }));
