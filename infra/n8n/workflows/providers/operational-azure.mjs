import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeNode, connectBoth, deliveryNode, httpNode, manualNode, safeUpstreamError, scheduleNode, unwrapResponse, workflow } from "./operational-common.mjs";

const subscriptionId = "00000000-0000-4000-8000-000000000001";
const resourceGroup = "demo-signing-rg";
const accountName = "demo-signing";
const accountId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CodeSigning/codeSigningAccounts/${accountName}`;

export function buildAzureScopes(accountBody, profilesBody) {
  if (String(accountBody?.id ?? "").toLowerCase() !== accountId.toLowerCase() || accountBody?.name !== accountName || !Array.isArray(profilesBody?.value)) throw new Error("invalid_response");
  return [{ scope: accountId }, ...profilesBody.value.slice(0, 50).map(profile => ({ scope: String(profile.id) }))];
}

export function buildAzureScopesResponses(accountResponse, profilesResponse) {
  const errorCode = safeUpstreamError([accountResponse, profilesResponse]);
  if (errorCode) return [{ scope: accountId, collectorError: errorCode }];
  try { return buildAzureScopes(unwrapResponse(accountResponse).body, unwrapResponse(profilesResponse).body); }
  catch { return [{ scope: accountId, collectorError: "invalid_response" }]; }
}

export function aggregateAzure(accountBody, profilesBody, roleBodies, observedAt = new Date().toISOString()) {
  if (String(accountBody?.id ?? "").toLowerCase() !== accountId.toLowerCase() || accountBody?.name !== accountName || !Array.isArray(profilesBody?.value)) throw new Error("invalid_response");
  const profilesComplete = !profilesBody.nextLink && profilesBody.value.length <= 50;
  const profiles = profilesBody.value.map(profile => {
    if (!profile?.id || !profile?.name) throw new Error("invalid_response");
    const row = { name: String(profile.name), resourceId: String(profile.id) };
    if (profile.properties?.profileType) row.profileType = String(profile.properties.profileType);
    if (profile.properties?.status) row.status = String(profile.properties.status);
    if (profile.properties?.provisioningState && !row.status) row.status = String(profile.properties.provisioningState);
    return row;
  }).slice(0, 50);
  const rolePages = roleBodies.map(body => body?.json ?? body);
  let roleAssignmentsComplete = rolePages.length === profiles.length + 1 && rolePages.every(body => Array.isArray(body?.value) && !body.nextLink);
  const seen = new Set(); const roleAssignments = [];
  for (const body of rolePages) for (const assignment of Array.isArray(body?.value) ? body.value : []) {
    const p = assignment?.properties; const key = String(assignment?.id ?? `${p?.scope}:${p?.roleDefinitionId}:${p?.principalId}`);
    if (seen.has(key)) continue; seen.add(key);
    if (!p?.scope || !p?.roleDefinitionId || !p?.principalId) throw new Error("invalid_response");
    const principalType = ["User", "Group", "ServicePrincipal", "ForeignGroup", "Device", "AgentUser", "AgentServicePrincipal"].includes(p.principalType) ? p.principalType : "Unknown";
    roleAssignments.push({ scope: String(p.scope), roleDefinitionId: String(p.roleDefinitionId), principalId: String(p.principalId), principalType });
  }
  if (roleAssignments.length > 100) roleAssignmentsComplete = false;
  const data = { subscriptionId, resourceGroup, accountName, resourceId: String(accountBody.id), profilesComplete, profiles, roleAssignmentsComplete, roleAssignments: roleAssignments.slice(0, 100) };
  if (accountBody.location) data.location = String(accountBody.location);
  if (accountBody.properties?.provisioningState) data.provisioningState = String(accountBody.properties.provisioningState);
  const complete = profilesComplete && roleAssignmentsComplete;
  return { surface: "azure", observedAt: new Date(observedAt).toISOString(), status: complete ? "ok" : "partial", ...(complete ? {} : { errorCode: "incomplete_collection" }), data };
}

export function aggregateAzureResponses(accountResponse, profilesResponse, scopeItems, roleItems, observedAt = new Date().toISOString()) {
  const responses = [accountResponse, profilesResponse, ...roleItems.map(item => item?.json ?? item)];
  const stagedError = scopeItems.map(item => item?.json ?? item).find(item => item?.collectorError)?.collectorError;
  const errorCode = stagedError ?? safeUpstreamError(responses);
  const empty = { subscriptionId, resourceGroup, accountName, resourceId: accountId, profilesComplete: false, profiles: [], roleAssignmentsComplete: false, roleAssignments: [] };
  if (errorCode) return { surface: "azure", observedAt: new Date(observedAt).toISOString(), status: "error", errorCode, data: empty };
  try { return aggregateAzure(unwrapResponse(accountResponse).body, unwrapResponse(profilesResponse).body, roleItems.map(item => unwrapResponse(item?.json ?? item).body), observedAt); }
  catch { return { surface: "azure", observedAt: new Date(observedAt).toISOString(), status: "error", errorCode: "invalid_response", data: empty }; }
}

const api = "2025-10-13";
const base = `https://signing.secdash.invalid${accountId}`;
const helpers = `${unwrapResponse.toString()}\n${safeUpstreamError.toString()}`;
const scopesCode = `const subscriptionId=${JSON.stringify(subscriptionId)},resourceGroup=${JSON.stringify(resourceGroup)},accountName=${JSON.stringify(accountName)},accountId=${JSON.stringify(accountId)};\n${helpers}\n${buildAzureScopes.toString()}\n${buildAzureScopesResponses.toString()}\nreturn buildAzureScopesResponses($('Read signing account').first().json, $json).map(json => ({json}));`;
const aggregateCode = `const subscriptionId=${JSON.stringify(subscriptionId)},resourceGroup=${JSON.stringify(resourceGroup)},accountName=${JSON.stringify(accountName)},accountId=${JSON.stringify(accountId)};\n${helpers}\n${aggregateAzure.toString()}\n${aggregateAzureResponses.toString()}\nreturn [{json: aggregateAzureResponses($('Read signing account').first().json, $('Read certificate profiles').first().json, $('Build exact RBAC scopes').all(), $input.all())}];`;
export const definition = workflow("SecDashAzureOperational", "SecDash — Azure signing operations (15 min)", [
  scheduleNode, manualNode,
  httpNode({ id: "account", name: "Read signing account", url: base, credentialId: "SecDashAzureInventory", credentialName: "SecDash Azure inventory", position: [-680, 40], query: [{ name: "api-version", value: api }] }),
  httpNode({ id: "profiles", name: "Read certificate profiles", url: `${base}/certificateProfiles`, credentialId: "SecDashAzureInventory", credentialName: "SecDash Azure inventory", position: [-420, 40], query: [{ name: "api-version", value: api }] }),
  codeNode("scopes", "Build exact RBAC scopes", scopesCode, [-160, 40]),
  httpNode({ id: "roles", name: "Read applicable role assignments", url: "={{ 'https://signing.secdash.invalid' + $json.scope + '/providers/Microsoft.Authorization/roleAssignments' }}", credentialId: "SecDashAzureInventory", credentialName: "SecDash Azure inventory", position: [100, 40], query: [{ name: "api-version", value: "2022-04-01" }, { name: "$filter", value: "atScope()" }] }),
  codeNode("project", "Whitelist Azure telemetry", aggregateCode, [360, 40]), deliveryNode([620, 40]),
], {
  ...connectBoth("Read signing account"),
  "Read signing account": { main: [[{ node: "Read certificate profiles", type: "main", index: 0 }]] },
  "Read certificate profiles": { main: [[{ node: "Build exact RBAC scopes", type: "main", index: 0 }]] },
  "Build exact RBAC scopes": { main: [[{ node: "Read applicable role assignments", type: "main", index: 0 }]] },
  "Read applicable role assignments": { main: [[{ node: "Whitelist Azure telemetry", type: "main", index: 0 }]] },
  "Whitelist Azure telemetry": { main: [[{ node: "Deliver operation observation", type: "main", index: 0 }]] },
});

if (process.argv.includes("--write")) writeFileSync(fileURLToPath(new URL("./operational-azure.json", import.meta.url)), `${JSON.stringify(definition, null, 2)}\n`);
