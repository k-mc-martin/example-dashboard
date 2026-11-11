# Account permissions verification

**Pass** across the automated checks for the account exercise.

The [manual verification log](https://github.com/k-mc-martin/example-dashboard/blob/HEAD/docs/security/accounts.md#manual-verification-log) records reviewer verdicts, exceptions and the exact build reviewed. This report covers the listed scenarios.

| Run detail | Value |
|---|---|
| Standard | OWASP ASVS 5.0.0 |
| Generated (UTC) | 2026-11-11T04:32:23.583Z |
| Commit | `80eebbd9f628c1f5760d2506d42b3e4c3f7c5845` |
| Source fingerprint (SHA-256) | `4e5aeac2e8657c9c53ebd08c6be38061caecdf4940c05a4bc32bda012b6b6cfa` |
| Target | Demo stack built in GitHub Actions from this checkout |
| Node | v24.22.2 |
| GitHub evidence | [Workflow run](https://github.com/k-mc-martin/example-dashboard/actions/runs/42959686075/attempts/1) |

## Automated requirements in scope

| ASVS ID | Status | Method | Evidence or pending check |
|---|---|---|---|
| v5.0.0-3.3.1 | Pass | HTTP integration | Host-only Secure, HttpOnly and SameSite cookies |
| v5.0.0-3.3.2 | Pass | HTTP integration | Host-only Secure, HttpOnly and SameSite cookies |
| v5.0.0-3.3.3 | Pass | HTTP integration | Host-only Secure, HttpOnly and SameSite cookies |
| v5.0.0-7.2.1 | Pass | HTTP integration | Reject forged identity, stale login and cross-origin logout |
| v5.0.0-7.2.2 | Pass | HTTP integration | Reject forged identity, stale login and cross-origin logout |
| v5.0.0-7.2.4 | Pass | HTTP integration | Reject forged identity, stale login and cross-origin logout |
| v5.0.0-7.3.2 | Pass | Clock-controlled integration | A login created just before workspace expiry also expires |
| v5.0.0-7.4.1 | Pass | HTTP integration, Clock-controlled integration | Reject forged identity, stale login and cross-origin logout · A login created just before workspace expiry also expires |
| v5.0.0-8.2.1 | Pass | HTTP integration | Allowed reads and backup writes for three roles · Independent member session enforces live grants and revocations |
| v5.0.0-8.2.2 | Pass | HTTP integration | Objects and sessions stay within the visitor workspace |
| v5.0.0-8.2.3 | Pass | HTTP integration | Fields returned by the inbox, deployment and storage feeds |
| v5.0.0-8.3.1 | Pass | HTTP integration | Allowed reads and backup writes for three roles · Independent member session enforces live grants and revocations |
| v5.0.0-8.3.2 | Pass | HTTP integration | Independent member session enforces live grants and revocations |
| v5.0.0-8.4.1 | Pass | HTTP integration | Objects and sessions stay within the visitor workspace · Independent member session enforces live grants and revocations |

## Executed checks

| Scenario | Method | Result |
|---|---|---|
| Allowed reads and backup writes for three roles | HTTP integration | Pass |
| Fields returned by the inbox, deployment and storage feeds | HTTP integration | Pass |
| Objects and sessions stay within the visitor workspace | HTTP integration | Pass |
| Reject forged identity, stale login and cross-origin logout | HTTP integration | Pass |
| Independent member session enforces live grants and revocations | HTTP integration | Pass |
| Host-only Secure, HttpOnly and SameSite cookies | HTTP integration | Pass |
| A login created just before workspace expiry also expires | Clock-controlled integration | Pass |
| Detect an injected owner-only field in an employee response | Deliberate response fault | Pass |

The deliberate fault adds a forbidden field to a copy of a real Employee response. A pass means the usual field-access assertion caught that specific defect.


## Manual requirements

CI leaves these items to the reviewer. Match the commit in the [dated manual log](https://github.com/k-mc-martin/example-dashboard/blob/HEAD/docs/security/accounts.md#manual-verification-log) to the build under assessment.

| ASVS ID | Review procedure |
|---|---|
| v5.0.0-7.2.3 | Review random-token generation and entropy at the assessed commit. |
| v5.0.0-7.4.4 | Review visible sign-out controls across authenticated screens. |
| v5.0.0-8.1.1 | Review the documented role and object permissions against the dashboard. |
| v5.0.0-8.1.2 | Review the documented field restrictions against all shared feeds. |

[Access policy and reproduction](https://github.com/k-mc-martin/example-dashboard/blob/80eebbd9f628c1f5760d2506d42b3e4c3f7c5845/docs/security/accounts.md) · [Dated manual verification log](https://github.com/k-mc-martin/example-dashboard/blob/HEAD/docs/security/accounts.md#manual-verification-log) · [Findings](https://github.com/k-mc-martin/example-dashboard/blob/80eebbd9f628c1f5760d2506d42b3e4c3f7c5845/docs/security/findings.md)

[Machine-readable results](results.json) · [Runner output](checks.tap)
