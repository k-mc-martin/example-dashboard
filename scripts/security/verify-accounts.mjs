import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, readlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { cases, manualChecks } from '../../tests/account-evidence-cases.mjs';
import { findExercise } from '../../lib/demo-exercises.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const exercise = findExercise('account-permissions');
const output = 'docs/security/evidence/accounts';
mkdirSync(output, { recursive: true });
const file = name => output + '/' + name;
const checks = Object.values(cases);
const git = (...args) => execFileSync('git', args, {encoding:'utf8', stdio:['ignore','pipe','pipe']});
const sourcePaths = ['.', ':(exclude)' + output + '/**'];
const paths = git('ls-files','--cached','--others','--exclude-standard','-z','--',...sourcePaths).split('\0').filter(Boolean).sort();
const hash = createHash('sha256');
for (const path of paths) {
  let data;
  try { data = lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  hash.update(path + '\0' + createHash('sha256').update(data).digest('hex') + '\n');
}
let commit = null;
try { commit = git('rev-parse','--verify','HEAD').trim(); } catch { /* Initial checkout without a commit. */ }
const dirty = !!git('status','--porcelain','--',...sourcePaths).trim();
const ci = process.env.GITHUB_ACTIONS === 'true';
const runUrl = ci ? process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY +
  '/actions/runs/' + process.env.GITHUB_RUN_ID + '/attempts/' + process.env.GITHUB_RUN_ATTEMPT : null;
const setupFailed = ci && process.env.DEMO_STACK_OUTCOME !== 'success';
const testFiles = exercise.testFiles.filter(path => !setupFailed || !path.endsWith('-http.mjs'));
const child = spawnSync(process.execPath, ['--test','--test-reporter=tap', ...testFiles], {
  encoding:'utf8', timeout:120_000, maxBuffer:4 * 1024 * 1024,
});
// A failed assertion can include an opaque demo credential. Scrub those and local paths before publishing TAP.
const tap = (child.stdout || '').replaceAll(root, './').replace(/\/Users\/[^/\s]+\//g, '~/')
  .replace(/\b(?:\d{13}-[0-9a-f]{32}\.)?[0-9a-f]{64}\b/gi, '[redacted]');
writeFileSync(file('checks.tap'), tap);
const outcomes = checks.map(({test, title, requirements, method}) => {
  const matches = [...tap.matchAll(/^(ok|not ok) \d+ - (.+?)(?:\s+# (SKIP|TODO).*?)?$/gm)].filter(match => match[2] === test);
  let status = 'Not yet tested';
  if (matches.length === 1 && !matches[0][3]) status = matches[0][1] === 'ok' ? 'Pass' : 'Fail';
  return { title, method, requirements, status };
});
const controls = [];
for (const id of new Set(outcomes.flatMap(check => check.requirements))) {
  const relevant = outcomes.filter(check => check.requirements.includes(id));
  const status = relevant.some(c => c.status === 'Fail') ? 'Fail' :
    relevant.every(c => c.status === 'Pass') ? 'Pass' : 'Not yet tested';
  controls.push({id,status,method:[...new Set(relevant.map(c=>c.method))].join(', '),evidence:relevant.map(c=>c.title)});
}
controls.push(...manualChecks);
controls.sort((a,b)=>a.id.localeCompare(b.id, 'en', {numeric:true}));
const passed = !setupFailed && child.status === 0 && outcomes.every(check => check.status === 'Pass') &&
  (!ci || (commit === process.env.GITHUB_SHA && !dirty));
const results = {
  standard: 'OWASP ASVS 5.0.0', scope: exercise.title, generatedAt: new Date().toISOString(),
  sourceUrl: runUrl && commit ? process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/blob/' + commit : null,
  commit, dirty, sourceSha256: hash.digest('hex'), runUrl, node:process.version,
  target: ci ? 'Demo stack built in GitHub Actions from this checkout' : 'Running loopback demo',
  automatedOutcome: passed ? 'Pass' : 'Incomplete or failed', stackSetupFailed: setupFailed,
  runnerExit:child.status, checks:outcomes, controls, rawOutput:'checks.tap',
  followUp:'This run covers automated account checks. The dated manual verification log identifies each human-reviewed revision and its exceptions.',
};
writeFileSync(file('results.json'), JSON.stringify(results, null, 2) + '\n');
execFileSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), 'render-report.mjs'),file('results.json')]);
console.log(outcomes.map(c => c.status + ' · ' + c.title).join('\n'));
console.log('Report saved to ' + file('report.md'));
process.exitCode = passed ? 0 : 1;
