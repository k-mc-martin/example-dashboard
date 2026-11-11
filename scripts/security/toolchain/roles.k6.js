import http from 'k6/http';
import { check, fail } from 'k6';
import { Counter } from 'k6/metrics';

const completed = new Counter('completed_role_sessions');

const base = 'http://127.0.0.1:5286';
const roles = ['Employee', 'Administrator', 'Owner'];
export const options = {
  scenarios: { roles: { executor: 'per-vu-iterations', vus: roles.length, iterations: 1, maxDuration: '45s' } },
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate==0'], completed_role_sessions: ['count==3'] },
};

function cookie(response, name) {
  const value = response.cookies[name]?.[0]?.value;
  if (!check(value, { ['issued ' + name]: Boolean })) fail('Missing demo cookie');
  return name + '=' + value;
}

export default function () {
  const role = roles[__VU - 1];
  const workspace = cookie(http.get(base), '__Host-secdash_workspace');
  const choices = http.get(base + '/api/demo/session', { headers: { Cookie: workspace } }).json('choices');
  const { id, pass } = choices.find(choice => choice.role === role);
  const login = http.post(base + '/api/demo/session', JSON.stringify({ id, pass }), {
    headers: { Cookie: workspace, Origin: base, 'Content-Type': 'application/json' },
  });
  const session = workspace + '; ' + cookie(login, '__Host-secdash_login');
  for (const [path, expected] of [
    ['/api/dashboard', 200],
    ['/api/drive-storage', role === 'Employee' ? 403 : 200],
    ['/api/health', role === 'Owner' ? 200 : 403],
  ]) {
    const response = http.get(base + path, {
      headers: { Cookie: session }, responseCallback: http.expectedStatuses(expected),
    });
    check(response, { [role + ' ' + path + ' returns ' + expected]: res => res.status === expected });
  }
  completed.add(1);
}
