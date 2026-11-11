# SecDash security verification

From the demo checkout, run `npm run verify:tools`. You need Docker with Compose v2.24.4 or newer, Git, curl, Python 3.9+ and npm. The Python entry point also works directly. On GitHub, open **Actions → Security tools** to inspect a run or run the suite in your fork. Each run records the commit when available, a digest of the checkout it scanned, tool image digests and the outcome of each check.

The runner builds a disposable dashboard, n8n and nine fictional provider feeds. Both Compose networks are internal. It publishes zero host ports. The HTTP clients share only the test dashboard’s network namespace. OSV gets the npm lockfile, and the reference checker retrieves pinned public OWASP documents. The application receives no production keys. The runner removes the test stack and its temporary workspaces at the end.

## Tools and coverage

| Item | What the campaign can verify today |
|---|---|
| Codex / coding agent | Develops application-specific tests in the checkout. The checked-in tests run in CI without a model account or key. |
| OWASP ASVS 5.0.0 | Each account scenario carries versioned requirement IDs. The suite checks both automated and manual mappings against the official release. The [account report](evidence/accounts/report.md) gives an outcome and method for each requirement in scope. |
| OWASP WSTG 4.2 | Four published procedures are tied to specific account tests for authorization bypass, privilege escalation, cross-visitor object access and logout. See `owasp-mappings.json` in the run evidence. |
| MCP Authorization Specification | The dashboard currently exposes a browser navigation helper. The original tool baseline did not exercise resource discovery, audience binding, scopes and token expiry against the protected resource. [Versioned authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index.md) |
| MCP Security Best Practices | The original tool baseline did not test confused-deputy consent, token passthrough prevention and session isolation. See the current visitor campaign below. [Versioned security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices.md) |
| MCP Inspector | Negotiates the July 2026 protocol over stdio, lists a synthetic tool and calls it. Validates the response with networking disabled. The result covers Inspector setup. |
| OWASP ZAP Automation Framework | Sends five bounded requests as a signed-out visitor and a signed-in Employee, checks the expected 200/401/403 responses, waits for passive scanning and records alert IDs and risk. Medium or high alerts flag the run. Coverage comprises the landing page and two protected API routes. |
| OSV-Scanner | Checks resolved versions in `package-lock.json` against current advisory data, including development dependencies. The report lists affected versions and advisory IDs. Runtime reachability needs separate triage. |
| Gitleaks | Scans the Git-eligible worktree, including untracked source, and all reachable Git refs. A separate fixture commits and deletes a synthetic token to verify history detection. An empty history is reported as pending. |
| Semgrep | Three checked-in JavaScript/TypeScript rules check for dynamic execution, disabled TLS validation and SQL interpolation. Seeded examples verify each rule. Review the flagged lines against their inputs. [Rules](../../scripts/security/toolchain/semgrep.yml) |
| Grafana k6 | Three concurrent virtual users exercise Employee, Administrator and Owner access. Each gets an independent workspace. Thresholds require all checks and all three sessions to complete. This establishes a functional concurrency baseline. |
| Custom application harness | Runs the account, independent-tab, revocation, isolation and provider suites, including a seeded response fault. The [manual verification log](accounts.md#manual-verification-log) records the owner’s browser observations. |
| Provider stubs | A separate HTTP test drives fictional data through n8n and checks delivery, safe retries, isolation and simulated backup completion. |
| GitHub Actions | Runs on pushes, pull requests, manual dispatch and published releases. The README badge follows `main`. The workflow publishes sanitized evidence even if a scanner flags a finding. [Workflow](../../.github/workflows/security-tools.yml) |

## Current visitor campaign
The [19-exercise guide](campaign/README.md) covers the deployed connector, consent, token rotation, replay and tool calls. The original Inspector baseline below used a stdio fixture; it is not evidence for the remote HTTP resource. See the [campaign workflow](../../.github/workflows/campaign.yml) for direct transport and authorization tests and the [hosted boundary workflow](../../.github/workflows/hosted-boundary.yml) for post-deployment observations.

## First local baseline

On November 10, 2026, the account and provider harness passed 29 tests, the simulated n8n delivery passed, and k6 passed all 15 assertions across three role sessions. Gitleaks found zero matches in the source and caught the deleted fixture token. The demo checkout had no commits yet. Its public remote was empty, so the README badge was awaiting its first hosted run.

OSV reported 80 distinct advisories across 22 of the 849 resolved package versions it scanned, including Next.js. Semgrep reported five SQL interpolation sites. The feedback queries build clauses from fixed fragments and bind the search values. The drive queries interpolate a fixed column list and a numeric constant. The five matches remain visible for review. ZAP reported a missing Content Security Policy on the landing page and disclosure of the framework through the X-Powered-By header. [Generated baseline and advisory IDs](evidence/tools/baseline.json)

The Inspector entry in the published baseline was reproduced on November 11, 2026 with the `secdash-stdio-fixture` server.

## Remediation of the first published findings

The first hosted run reproduced the local findings and scanned the initial Git history without a secret match. Its account verification passed all eight scenarios. [Initial security run](https://github.com/k-mc-martin/example-dashboard/actions/runs/42939085408) · [Initial account report](https://github.com/k-mc-martin/example-dashboard/actions/runs/42939085147)

| Finding | Resolution and repeatable check |
|---|---|
| OSV reported 80 advisory IDs across 22 dependency versions. | Updated the runtime and development dependency graph. The revised lockfile contains 803 scanned package versions. OSV reported zero matching advisories in the remediation run. New runs query the advisory database again. |
| ZAP reported a missing Content Security Policy and the framework disclosure header. | Next applies a fresh nonce to the main document and its bootstrap scripts. The server omits X-Powered-By. The HTTP test checks the rendered scripts and nonce rotation. A browser walkthrough also verified Owner sign-in, Teams and the separate Employee tab under the production policy. |
| Semgrep flagged five interpolated SQL expressions. | Source review traced the feedback inputs to bound parameters and the storage inputs to constants. The scanner still reports every match. The runner recognizes only the reviewed rule, file, line and exact file digest. A changed file reopens its matches. [Review records](../../scripts/security/toolchain/semgrep-reviews.json) |

The **Security tools** workflow publishes each commit’s scan results, including informational ZAP observations and reviewed Semgrep matches. The **Account permissions evidence** workflow checks the same commit’s account behavior. [Security runs](https://github.com/k-mc-martin/example-dashboard/actions/workflows/security-tools.yml) · [Account runs](https://github.com/k-mc-martin/example-dashboard/actions/workflows/account-permissions.yml)

## Reading the evidence

Open `artifacts/security-tools/summary.json` after a local run. Its neighboring JSON files contain rule IDs and locations, package versions and advisory IDs, ZAP alerts, k6 counts, Inspector replies and OWASP mappings. A run with findings, a failed tool, or a pending check returns a nonzero exit. Published GitHub releases attach the evidence ZIP to the tag. The full local failure log stays outside the upload directory.

To record a new reviewable baseline, run `npm run verify:tools -- --save-baseline`. The evidence file is excluded from its own source fingerprint.

The account report and its manual checks cover the account exercise. Overall ASVS level, broader authenticated API coverage, remote MCP authorization and deployment security each need their own evidence. A new exercise can add cases, map them to its requirements and include its outputs with the same workflow.


## Evidence in the visitor dashboard

Exercises 8, 13 and 15 read a public summary of GitHub Actions runs for the deployed Git commit. The server mounts `/opt/secdash-evidence` read-only. Each result links to its source run. After the campaign, scanner and hosted-boundary runs finish, run the following from an authenticated maintainer checkout, using the full deployed commit for `REVISION`. Publish the completed file with a rename so visitors always read a complete snapshot.

```sh
python3 scripts/security/dashboard-evidence.py "$REVISION" > "$REVISION.json"
scp "$REVISION.json" "$DEMO_SSH:/opt/secdash-evidence/$REVISION.json.tmp"
ssh "$DEMO_SSH" "mv /opt/secdash-evidence/$REVISION.json.tmp /opt/secdash-evidence/$REVISION.json"
```

A fresh deployment displays its revision and the pending-evidence message until its summary is available. Local builds can inspect live headers and open the public workflow sources.


The campaign run summary lists one browser scenario per exercise. Its TAP artifact records the actions and expected server responses. After publishing this revision’s evidence, run **Hosted dashboard exercises** from GitHub Actions to repeat those 19 scenarios on the public demo. That workflow checks the deployed revision before and after the walkthrough and uses fresh fictional visitors.
