# Demo account permissions

Each visitor starts with an isolated fictional workspace. The sign-in screen offers three sample identities. Anyone visiting can try all three roles within their own workspace. This exercise tests authorization and session handling. Identity proofing, password authentication, and MFA belong to a separate exercise.

| Dashboard capability | Employee | Administrator | Owner |
|---|---|---|---|
| Communications and message details, feedback, websites and sample releases | Allow | Allow | Allow |
| Deployment history and object storage | Deny | Allow | Allow |
| Launch the published release to the fictional preview environment | Deny | Allow with Deployments access | Allow |
| Drive usage, backup catalog, simulated backup and sync | Deny | Allow | Allow |
| Overview, attention dismissals and provider accounts | Deny | Deny | Allow |
| Revenue, signing, domains and workflow telemetry | Deny | Deny | Allow |
| Another visitor’s data or provider-ingest endpoints | Deny | Deny | Deny |

The table gives the defaults. Only the Owner can open Teams, change a member between Employee and Administrator, edit their deployment and storage access, or open that member’s dashboard in another tab. Both member roles retain Communications, Feedback, and Website & releases. Viewing storage, starting a backup, and syncing libraries have separate controls. The latter two require storage access. Teams cannot grant ownership.

## Field access

Each row applies within the signed-in visitor’s fictional workspace. A storage or deployment viewer is an Owner or a member whose current permissions grant that view. Every role can generate fictional activity.

| Feed or operation | Fields | Who can read or write them |
|---|---|---|
| Inbox · `GET /api/dashboard` | `messages`, `counts`, `hasMore`, `lastSync`. Each message contains `id`, `sender`, `subject`, a 180-character `body` preview, `receivedAt`, `category`, `supportKind` and nullable `sourceUrl`. | All three roles can read these fields. Communications includes the original message reference for employees handling mail. The demo accepts HTTPS source links on its allowlisted fictional mail hosts. |
| Inbox overview · same response | `providerConnections` (provider identities and connection status), `feedback` (summary), `attentionFeedbackObstructions` (alerts) | Owner only. The server omits all three keys for Employee and Administrator. |
| Message detail and Feedback · `GET /api/messages/{id}`, `GET /api/feedback` | An individual message includes its full body and `sourceUrl`. The Feedback page returns its own `summary`, filtered `items` with message previews and source links, counts and pagination. | All three roles can read these within their workspace. The Feedback page has its own summary even when the inbox overview omits `feedback`. |
| Deployments · `GET /api/operations?surface=cloudflare` | `serverTime` and `surfaces.cloudflare` with deployment history and inventory | Deployment viewers can read this surface. |
| Storage · `GET /api/operations?surface=recovery` | `serverTime` and `surfaces.recovery` with `latest`, `latestSuccess` and `history`. Observations include `surface`, `observedAt`, `receivedAt`, `status` and, for errors, `errorCode`. For successful samples, `data` contains `schemaVersion`, `generatedAt`, `backupFolder`, `restoreChecks` and optionally `backupCatalog`. History entries omit `data`. | Storage viewers can read the scoped response. The same projection applies to Owner when requesting this endpoint. |
| Full operations · `GET /api/operations` | All surfaces, including workflow details in recovery `data.automation` and recovery’s `latestAiUsage` | Owner only. |
| Team settings · `PUT /api/demo/teams` | `id` selects the member. Editable fields are `role` (Employee or Administrator) and the boolean permissions `deployments`, `storage`, `startBackup`, `syncBackups`. | Owner only. Both backup permissions require storage access. The server rejects an attempt to assign Owner. |
| Backup actions · `POST /api/backups`, `POST /api/backup-catalog` | Start a simulated backup or request a library sync | Starting a backup requires `startBackup` and storage. Syncing requires `syncBackups` and storage. Storage viewing alone allows reads. |

[Inbox projection](../../app/api/dashboard/route.ts) · [Message URL validation](../../lib/inbound.ts) · [Feedback feed](../../app/api/feedback/route.ts) · [Recovery projection](../../lib/inbound-operations.ts) · [Server permissions](../../lib/server-auth.ts)

## Server enforcement

The server owns session identity, workspace membership, and effective permissions. Each protected API request checks them before returning data or starting provider work. A permission change applies to the member’s next request with their existing login. The dashboard uses the resulting policy to present controls. A visible button, an edited client role, or an API request sent outside the dashboard grants no authority. Starting a single backup and syncing the library affect independent simulated jobs.

## Sessions

The server issues a sign-in pass for each fictional identity in a signed-out workspace. It checks the workspace, identity and pass, then issues a new random 256-bit login token. SQLite records the token hash and its account. Both cookie names carry the `__Host-` prefix and are host-only with Secure, HttpOnly and SameSite=Strict. Mutating browser requests require the allowed origin. Every dashboard data request checks the active login against its workspace and the server's permission policy.

Tabs opened at the main dashboard address share its primary sign-in. In the local demo, Teams opens each member tab on a random loopback hostname. The public demo gives Mira and Theo separate, stable HTTPS hostnames. Mira’s tab at the reviewed deployment used `mira.15-204-123-246.sslip.io`. Each visitor gets distinct tickets and login tokens. Reopening the same member in the same browser shares that member’s current cookies. An Owner-authorized form hands off a host-bound, one-use ticket in its POST body. Redemption expires after one minute and establishes fresh host-only cookies. The member’s workspace signature and login are bound to that member host. Each request resolves the current permissions from the visitor’s own team settings. An open dashboard rechecks access on focus and every four seconds while visible. Signing out revokes just that session. Other tabs with independent logins can continue to use the shared fictional records. The login ends no later than the workspace's eight-hour expiry, even when the visitor signs in late. The demo uses a fixed absolute lifetime. The account workflow tests the loopback build. The manual worksheet identifies the running public revision and includes the HTTPS walkthrough.

## Try two tabs

1. Sign in as Owner, open **Teams**, choose a member, and select **Open member’s session**. The new tab identifies the member by name and role.
2. In Teams, grant deployment access and save. Open Deployments as the member. Revoke that access and refresh the feed in the member tab. The server returns a denial. Restoring the permission reopens the view.
3. Grant storage viewing with **Start backups** unchecked. Use **Back Up Now** in the member tab, inspect the denial, and compare the backup history. Grant the action and try again in the same tab.
4. Continue exploring either tab or sign out independently.

[Worksheet for the four manual ASVS reviews](manual-review.md)

## Manual verification log

### Hosted account review, November 10, 2026

The project owner reported **Pass** for all four items on the [deployed revision `80eebbd`](https://github.com/k-mc-martin/example-dashboard/tree/80eebbd9f628c1f5760d2506d42b3e4c3f7c5845). They exercised dashboard actions, changed Mira’s permissions in several combinations and inspected requests and responses in Chrome DevTools. They supplied session notes and screenshots. They did not keep a step-by-step test log.

| ASVS 5.0.0 | Owner’s verdict | Evidence and follow-up |
|---|---|---|
| 7.2.3 · Session tokens | Pass | The owner confirmed the worksheet item. The token issuers are `issueLogin` and `enterMemberTab` in the [reviewed source](https://github.com/k-mc-martin/example-dashboard/blob/80eebbd9f628c1f5760d2506d42b3e4c3f7c5845/lib/demo-login.ts). |
| 7.4.4 · Sign-out visibility | Pass | The owner confirmed sign-out during the walkthrough. A subsequent source check found one exception on the authenticated standalone sample release pages. [Release-page finding](findings.md#sample-release-pages-and-sign-out) |
| 8.1.1 · Role and record permissions | Pass | Teams showed Mira as Employee with deployment, storage and backup creation enabled and library sync disabled. DevTools showed a direct Teams `PUT` attempting `role: "Owner"` return HTTP 400. |
| 8.1.2 · Field permissions | Pass | DevTools showed the recovery response in Mira’s tab. The owner identified omissions in the written field rules. The [field-access table](#field-access) records the inbox restrictions, message source links, and recovery response fields. |

All eight automated scenarios also passed in GitHub Actions on the reviewed commit. [GitHub Actions evidence](https://github.com/k-mc-martin/example-dashboard/actions/runs/42959686075)

### November 10, 2026 · Dashboard sign-in

**Passed.** The project owner separately confirmed signing in through the local demo’s account chooser and reaching the signed-in dashboard. The Owner sign-in also provided access to Teams for the walkthrough below.

### November 10, 2026 · Live deployment access

**Passed.** The project owner tested the local SecDash demo in a browser, using the Owner’s Teams page and Mira Chen’s Employee dashboard in separate tabs.

| Owner action in Teams | Observation in Mira’s open tab |
|---|---|
| Granted **View deployment history and inventory** and saved. | Mira could open Deployments. |
| Revoked the same permission and saved while Mira was viewing Deployments. | Refreshing the feed showed access denied. Mira stayed signed in throughout. |

The tester confirmed the walkthrough in the project conversation. This records the visible grant and revocation for the local build. The companion API test checks the server response directly and maps live permission changes to `v5.0.0-8.3.2`. [Automated account checks](../../tests/demo-accounts-http.mjs)

The local checkout had no commit at the time. The companion automated run recorded the SHA-256 source fingerprint `828e55851a9435542f42a82a7a7531413a4960bca381cd7e37006ade378d8465`.

## OWASP verification

| ASVS 5.0.0 controls | Checks for this exercise |
|---|---|
| 8.1.1, 8.1.2 | The matrix and field restrictions above describe the access policy. |
| 8.2.1, 8.3.1 | Call endpoints directly for all three roles. Check reads, backup writes, unlisted surfaces, and a forged role header. Compare backup state before and after a denied request. |
| 8.2.2, 8.4.1 | Try a real message ID from a second visitor, mix workspace and session cookies, and check a second visitor's data after activity in the first. |
| 8.2.1, 8.3.1, 8.3.2, 8.4.1 | Open a separate member login, change its rights during use, verify allowed and denied operations and unchanged state after denial, and check another visitor’s team. |
| 8.2.3 | Inspect inbox, deployment, and recovery responses for owner-only data. Use a successful Owner request as a comparison. |
| 7.2.1–7.2.4, 7.4.1 | Check server-side token validation, fresh tokens, workspace-bound sign-in, rejection of a changed role, and replay after logout and a switch to a lower role. Source review covers random-token generation. |
| 7.3.2 | Advance the clock across workspace expiry and retry an otherwise valid Owner session. |

The procedures draw on WSTG v4.2 ATHZ-02 (authorization bypass), ATHZ-03 (privilege escalation), ATHZ-04 (object references), and SESS-06 (logout). The generated report records automated results and links separately to the project owner’s revision-specific manual results. The mappings cover the listed scenarios. A full ASVS level assessment would require additional exercises. [ASVS 5.0.0 authorization](https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x17-V8-Authorization.md) · [ASVS 5.0.0 sessions](https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x16-V7-Session-Management.md) · [WSTG authorization tests](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/05-Authorization_Testing/) · [WSTG logout test](https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/06-Session_Management_Testing/06-Testing_for_Logout_Functionality)

## Reproduce

1. With Node 24+ installed, run `node --test tests/demo-login.test.mjs` for the expiry check.
2. Start the local demo with `npm run demo:up` and run `npm run test:accounts:http`. The tests create disposable visitors and exercise the running dashboard.
3. Run `npm run test:providers:http` against the same stack to exercise provider updates, backup completion, and workspace isolation.
4. Open the [local dashboard](http://127.0.0.1:5286), sign in as Employee and open Website & releases. Sign out, choose Administrator and open Deployments or Storage & recovery. Sign in as Owner to see provider accounts and revenue under Operations.


## Evidence for visitors

With the demo running, use `npm run verify:accounts` to run the exercise and regenerate the report. The runner records the test output, date, commit when available, dirty-checkout status, and a SHA-256 fingerprint of the source files. The Markdown report is rendered from the JSON results. The workspace directory and generated evidence are outside the fingerprint. [Report](evidence/accounts/report.md) · [Results JSON](evidence/accounts/results.json) · [Test output](evidence/accounts/checks.tap) · [Findings](findings.md)

Visitors can browse the **Account permissions evidence** workflow under **Actions**. To run their own copy, they can fork the repository, enable Actions and choose **Run workflow**. A fresh runner builds the demo with its fictional providers. The run summary and downloadable evidence identify the commit. For a published GitHub release, the workflow also attaches the evidence ZIP to the tag. The checked-in account evidence contains the hosted CI run for the revision reviewed on November 10. The dated manual log records the subsequent human review.

The test manifest lists each scenario with its exact ASVS IDs. The deliberate response fault checks the same assertion used on the real Employee feed. A separate reviewer can examine the implementation, tests and raw output at the referenced commit and record their own assessment. [Case manifest](../../tests/account-evidence-cases.mjs) · [Workflow](../../.github/workflows/account-permissions.yml)
