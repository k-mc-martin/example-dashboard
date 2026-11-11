import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeNode, connectBoth, deliveryNode, httpNode, manualNode, safeUpstreamError, scheduleNode, unwrapResponse, workflow } from "./operational-common.mjs";

export function projectGoDaddy(body, observedAt = new Date().toISOString()) {
  const domain = String(body?.domainName ?? body?.domain ?? "").toLowerCase();
  if (domain !== "example.invalid") throw new Error("invalid_response");
  const data = { domain, status: String(body.status ?? "") };
  if (!/^[A-Z][A-Z0-9_]*$/.test(data.status)) throw new Error("invalid_response");
  for (const [source, target] of [["expiresAt", "expiresAt"], ["renewBy", "renewBy"], ["createdAt", "createdAt"], ["updatedAt", "updatedAt"]]) {
    if (body[source] != null) data[target] = new Date(body[source]).toISOString();
  }
  for (const key of ["autoRenew", "privacy", "transferLock"]) if (typeof body[key] === "boolean") data[key] = body[key];
  data.nameServers = Array.isArray(body.nameServers) ? body.nameServers.map(value => String(value).toLowerCase()).slice(0, 13) : [];
  return { surface: "godaddy", observedAt: new Date(observedAt).toISOString(), status: "ok", data };
}

export function projectGoDaddyResponse(response, observedAt = new Date().toISOString()) {
  const errorCode = safeUpstreamError([response]);
  if (errorCode) return { surface: "godaddy", observedAt: new Date(observedAt).toISOString(), status: "error", errorCode, data: { domain: "example.invalid", status: "UNAVAILABLE", nameServers: [] } };
  try { return projectGoDaddy(unwrapResponse(response).body, observedAt); }
  catch { return { surface: "godaddy", observedAt: new Date(observedAt).toISOString(), status: "error", errorCode: "invalid_response", data: { domain: "example.invalid", status: "UNAVAILABLE", nameServers: [] } }; }
}

const projectSource = `${unwrapResponse.toString()}\n${safeUpstreamError.toString()}\n${projectGoDaddy.toString()}\n${projectGoDaddyResponse.toString()}\nreturn [{json: projectGoDaddyResponse($json)}];`;
export const definition = workflow("SecDashGoDaddyOperational", "SecDash — GoDaddy operations (15 min)", [
  scheduleNode, manualNode,
  httpNode({ id: "read-domain", name: "Read example.invalid domain", url: "https://domains.secdash.invalid/v3/domains/domain-names/example.invalid", credentialId: "SecDashGoDaddyRead", credentialName: "SecDash GoDaddy read", position: [-620, 40] }),
  codeNode("project", "Whitelist domain telemetry", projectSource, [-320, 40]), deliveryNode([-40, 40]),
], {
  ...connectBoth("Read example.invalid domain"),
  "Read example.invalid domain": { main: [[{ node: "Whitelist domain telemetry", type: "main", index: 0 }]] },
  "Whitelist domain telemetry": { main: [[{ node: "Deliver operation observation", type: "main", index: 0 }]] },
});

if (process.argv.includes("--write")) writeFileSync(fileURLToPath(new URL("./operational-godaddy.json", import.meta.url)), `${JSON.stringify(definition, null, 2)}\n`);
