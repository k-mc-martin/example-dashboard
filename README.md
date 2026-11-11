# Example Dashboard

[![Launch Dupdash](docs/launch-dupdash.svg)](https://vps-ca027b84.vps.ovh.us/launch)

[Manual review results](docs/security/accounts.md#hosted-account-review-november-10-2026) · [Repeat the review](docs/security/manual-review.md) · [Browse the source in VS Code](https://github.dev/k-mc-martin/example-dashboard) · [Deployed commit](https://vps-ca027b84.vps.ovh.us/version)

Dupdash is an interactive connector-security demo with fictional business activity. Each browser session gets its own eight-hour workspace. Sign in with a fictional account and choose **Generate new activity** to trigger a provider update. An open, visible dashboard also requests activity once a minute.

## Run locally

With Docker Compose running, use `npm run demo:up` from this directory, then open [the local dashboard](http://127.0.0.1:5286). The stack builds from this checkout and uses a dedicated n8n instance. Only the dashboard publishes a loopback port. No provider accounts or keys are needed. Run `npm run demo:down` to stop the stack. The workspaces and demo credentials are temporary and reset when their containers restart.

If the default port is occupied, run `DUPDASH_DEMO_PORT=5287 npm run demo:up` and open [the demo on port 5287](http://127.0.0.1:5287). Use the same environment variable when running HTTP verification. Member tabs use separate `*.localhost` hosts on the same loopback port.

## Data flow

Each update sends a server-selected scenario to the [n8n workflow](infra/n8n/workflows/demo-events.json). n8n makes nine HTTP requests to the internal [fictional providers](infra/simulation/providers.mjs) and delivers their results together. The dashboard validates the results and saves the complete update in the visitor's own SQLite database. A repeated request for the same revision advances the workspace once. Failed updates preserve the previous revision.

The feeds cover mail and feedback, accounts, sales and refunds, public and beta releases, deployment and object storage, signing, domains, drive usage, and recovery. Recovery includes backup libraries, restore checks, simulated automation executions and estimated model usage. Backup actions record simulated jobs. Download links serve sample manifests.

The other workflow exports are inactive templates with reserved fictional addresses. The demo stack imports only the simulation workflow.

## Demo accounts

Sign in on the dashboard as Employee, Administrator or Owner. Employee opens Communications, Feedback, and Website & releases. Administrator adds Deployments and Storage & recovery. Owner opens every section. On the Owner’s **Teams** page, choose a member and open their dashboard in another tab. Grant or revoke access while they are signed in, then use the ordinary controls in that tab. You can also sign out to switch the primary account. [Account policy and OWASP test mapping](docs/security/accounts.md)

## Verification

Run `npm ci` and `npm run test:providers` for contract, replay and isolation checks. With the demo running, `npm run test:providers:http` exercises the public UI's backend using two new test sessions, including simulated backup completion and denied cross-workspace reads.

With the demo running, `npm run verify:accounts` reruns the account exercise and generates its report. The report links each result to its ASVS requirement and test method. [Verification report](docs/security/evidence/accounts/report.md) · [Findings](docs/security/findings.md)

Run `npm run verify:tools` with Docker Compose and Python 3 for the security campaign baseline. It starts a disposable copy with fictional providers and writes the results to `artifacts/security-tools/`. [Tool setup, standards and evidence](docs/security/toolchain.md)

[![Security tools workflow status](https://github.com/k-mc-martin/example-dashboard/actions/workflows/security-tools.yml/badge.svg?branch=main)](https://github.com/k-mc-martin/example-dashboard/actions/workflows/security-tools.yml)
