# Account exercise findings

These issues were identified while adapting the single-operator duplicate to multiple roles. The affected data in the demo is fictional.

| Finding | Correction | Regression evidence |
|---|---|---|
| The shared inbox response included the provider-account inventory. An Employee needs inbox data, while the provider inventory belongs to the Owner. | The server omits the inventory and overview-only fields for Employee and Administrator. | The field-access test checks both restricted roles and an Owner positive control. The deliberate-fault test adds the inventory to a copy of an actual Employee response and verifies that the same assertion rejects it. |
| The shared operations response combined deployment and backup data with sales, signing, domain, automation and model-usage details. | The Administrator can request individual deployment and storage views. The recovery projection selects backup fields. Full operations require Owner. | The tests try individual and mixed-scope requests directly and inspect the returned fields, including the Owner response. |

## Sample release pages and sign-out

On the hosted `80eebbd` build, the authenticated public and beta sample release pages linked to download manifests and offered no visible path to sign out. The main dashboard toolbar provided sign-out. This qualifies the project owner’s reported pass for ASVS 7.4.4 on that revision. [Reviewed page handler](https://github.com/k-mc-martin/example-dashboard/blob/80eebbd9f628c1f5760d2506d42b3e4c3f7c5845/app/api/demo/site/route.ts)

The current dashboard links directly to the Scalæon homepage and beta site. The old authenticated URLs redirect to those same destinations. The account suite checks both redirects for all three roles.

[Role policy](accounts.md) · [Generated account report](evidence/accounts/report.md)
