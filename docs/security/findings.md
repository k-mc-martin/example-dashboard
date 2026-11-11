# Account exercise findings

These issues were identified while adapting the single-operator duplicate to multiple roles. The affected data in the demo is fictional.

| Finding | Correction | Regression evidence |
|---|---|---|
| The shared inbox response included the provider-account inventory. An Employee needs inbox data, while the provider inventory belongs to the Owner. | The server omits the inventory and overview-only fields for Employee and Administrator. | The field-access test checks both restricted roles and an Owner positive control. The deliberate-fault test adds the inventory to a copy of an actual Employee response and verifies that the same assertion rejects it. |
| The shared operations response combined deployment and backup data with sales, signing, domain, automation and model-usage details. | The Administrator can request individual deployment and storage views. The recovery projection selects backup fields. Full operations require Owner. | The tests try individual and mixed-scope requests directly and inspect the returned fields, including the Owner response. |

[Role policy](accounts.md) · [Generated account report](evidence/accounts/report.md)
