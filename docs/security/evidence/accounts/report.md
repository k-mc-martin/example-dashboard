# Account permissions verification

**Pass** across the automated checks for this exercise. Independent review is pending. The scope is the account exercise. It carries no overall ASVS level claim.

| Run detail | Value |
|---|---|
| Standard | OWASP ASVS 5.0.0 |
| Generated (UTC) | 2026-11-11T00:41:34.306Z |
| Commit | Local checkout before its first commit |
| Source fingerprint (SHA-256) | `828e55851a9435542f42a82a7a7531413a4960bca381cd7e37006ade378d8465` |
| Target | Running loopback demo |
| Node | v25.6.1 |

## Requirements in scope

| ASVS ID | Status | Method | Evidence or pending check |
|---|---|---|---|
| v5.0.0-3.3.1 | Pass | HTTP integration | Host-only Secure, HttpOnly and SameSite cookies |
| v5.0.0-3.3.2 | Pass | HTTP integration | Host-only Secure, HttpOnly and SameSite cookies |
| v5.0.0-3.3.3 | Pass | HTTP integration | Host-only Secure, HttpOnly and SameSite cookies |
| v5.0.0-7.2.1 | Pass | HTTP integration | Reject forged identity, stale login and cross-origin logout |
| v5.0.0-7.2.2 | Pass | HTTP integration | Reject forged identity, stale login and cross-origin logout |
| v5.0.0-7.2.3 | Not yet tested | Manual review | Review random-token generation and entropy at the assessed commit. |
| v5.0.0-7.2.4 | Pass | HTTP integration | Reject forged identity, stale login and cross-origin logout |
| v5.0.0-7.3.2 | Pass | Clock-controlled integration | A login created just before workspace expiry also expires |
| v5.0.0-7.4.1 | Pass | HTTP integration, Clock-controlled integration | Reject forged identity, stale login and cross-origin logout · A login created just before workspace expiry also expires |
| v5.0.0-7.4.4 | Not yet tested | Manual review | Review visible sign-out controls across authenticated screens. |
| v5.0.0-8.1.1 | Not yet tested | Manual review | Review the documented role and object permissions against the dashboard. |
| v5.0.0-8.1.2 | Not yet tested | Manual review | Review the documented field restrictions against all shared feeds. |
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

[Access policy and reproduction](../../accounts.md) · [Dated manual verification log](../../accounts.md#manual-verification-log) · [Findings](../../findings.md)

[Machine-readable results](results.json) · [Runner output](checks.tap)
