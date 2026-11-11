import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeNode, connectBoth, deliveryNode, httpNode, manualNode, safeUpstreamError, scheduleNode, unwrapResponse, workflow } from "./operational-common.mjs";

const accountId = "00000000000000000000000000000001";
export function aggregateCloudflare(input, observedAt = new Date().toISOString()) {
  const deployments = [];
  const pages = [];
  for (const projectName of ["secdash-public", "secdash-beta"]) {
    const bodies = [["production", input[`${projectName}:production`]], ["preview", input[`${projectName}:preview`]]];
    let complete = true;
    for (const [requestedEnvironment, body] of bodies) {
      if (body?.success !== true || !Array.isArray(body.result)) throw new Error("invalid_response");
      complete &&= Number(body.result_info?.total_pages ?? 1) <= 1;
      for (const item of body.result) {
        if (item?.project_name != null && item.project_name !== projectName) throw new Error("invalid_response");
        if (item?.environment != null && item.environment !== requestedEnvironment) throw new Error("invalid_response");
        const stage = item.latest_stage;
        const row = {
          id: String(item.id), environment: requestedEnvironment, url: String(item.url), createdAt: new Date(item.created_on).toISOString(),
          stage: stage?.name, status: stage?.status, skipped: item.is_skipped === true,
        };
        if (item.modified_on) row.modifiedAt = new Date(item.modified_on).toISOString();
        if (stage?.started_on) row.stageStartedAt = new Date(stage.started_on).toISOString();
        if (stage?.ended_on) row.stageEndedAt = new Date(stage.ended_on).toISOString();
        const metadata = item.deployment_trigger?.metadata;
        if (metadata?.branch) row.branch = String(metadata.branch).slice(0, 280);
        if (/^[a-fA-F0-9]+$/.test(String(metadata?.commit_hash ?? ""))) row.commitHash = String(metadata.commit_hash);
        if (["github:push", "ad_hoc", "deploy_hook"].includes(item.deployment_trigger?.type)) row.triggerType = item.deployment_trigger.type;
        if (item.skip_reason) row.skipReason = item.skip_reason;
        if (typeof item.uses_functions === "boolean") row.usesFunctions = item.uses_functions;
        deployments.push({ projectName, row });
      }
    }
    const projectDeployments = deployments.filter(value => value.projectName === projectName).map(value => value.row).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    pages.push({ projectName, complete, deploymentsTruncated: projectDeployments.length > 30, deployments: projectDeployments.slice(0, 30) });
  }
  const r2Pages = input.r2;
  if (!Array.isArray(r2Pages) || !r2Pages.length || r2Pages.some(page => page?.success !== true || !Array.isArray(page.result))) throw new Error("invalid_response");
  const allObjects = r2Pages.flatMap(page => page.result);
  const last = r2Pages.at(-1);
  const r2Complete = last?.result_info?.is_truncated !== true;
  const prefix = new Map(), extension = new Map(); let totalBytes = 0, oldestModifiedAt, newestModifiedAt;
  const objects = [];
  for (const item of allObjects) {
    const key = String(item?.key ?? ""), sizeBytes = Number(item?.size), lastModifiedAt = new Date(item?.last_modified).toISOString();
    if (!key || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0 || (item.storage_class != null && !["Standard", "InfrequentAccess"].includes(item.storage_class))) throw new Error("invalid_response");
    totalBytes += sizeBytes; if (!Number.isSafeInteger(totalBytes)) throw new Error("invalid_response");
    oldestModifiedAt = !oldestModifiedAt || lastModifiedAt < oldestModifiedAt ? lastModifiedAt : oldestModifiedAt;
    newestModifiedAt = !newestModifiedAt || lastModifiedAt > newestModifiedAt ? lastModifiedAt : newestModifiedAt;
    const prefixKey = key.includes("/") ? key.split("/", 1)[0] : "(root)";
    const leaf = key.split("/").at(-1); const match = leaf.match(/\.([A-Za-z0-9]{1,16})$/); const extensionKey = match ? `.${match[1].toLowerCase()}` : "(none)";
    for (const [map, group] of [[prefix, prefixKey], [extension, extensionKey]]) { const value = map.get(group) ?? { key: group, count: 0, bytes: 0 }; value.count += 1; value.bytes += sizeBytes; map.set(group, value); }
    objects.push({ key, sizeBytes, lastModifiedAt, ...(item.storage_class ? { storageClass: item.storage_class } : {}) });
  }
  const toGroups = map => [...map.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 100);
  const complete = pages.every(page => page.complete) && r2Complete;
  return {
    surface: "cloudflare", observedAt: new Date(observedAt).toISOString(), status: complete ? "ok" : "partial", ...(complete ? {} : { errorCode: "incomplete_collection" }),
    data: { accountId, pages, r2: { bucketName: "secdash-downloads", complete: r2Complete, objectsTruncated: objects.length > 75, pageCount: r2Pages.length, objectCount: allObjects.length, totalBytes, ...(oldestModifiedAt ? { oldestModifiedAt, newestModifiedAt } : {}), byPrefix: toGroups(prefix), byExtension: toGroups(extension), objects: objects.sort((a, b) => b.lastModifiedAt.localeCompare(a.lastModifiedAt)).slice(0, 75) } },
  };
}

export function aggregateCloudflareResponses(input, observedAt = new Date().toISOString()) {
  const groups = [input["secdash-public:production"], input["secdash-public:preview"], input["secdash-beta:production"], input["secdash-beta:preview"]].map(value => Array.isArray(value) ? value : [value]);
  const named = groups.flat();
  const r2Responses = Array.isArray(input.r2) ? input.r2 : [];
  const pagesError = safeUpstreamError(named);
  const r2Error = safeUpstreamError(r2Responses);
  const empty = { accountId, pages: [{ projectName: "secdash-public", complete: false, deploymentsTruncated: false, deployments: [] }, { projectName: "secdash-beta", complete: false, deploymentsTruncated: false, deployments: [] }], r2: { bucketName: "secdash-downloads", complete: false, objectsTruncated: false, pageCount: 0, objectCount: 0, totalBytes: 0, byPrefix: [], byExtension: [], objects: [] } };
  const bodies = groups.map(group => {
    const pages = group.map(response => unwrapResponse(response).body);
    if (!pages.length || pages.some(page => page?.success !== true || !Array.isArray(page.result))) return null;
    return { success: true, result: pages.flatMap(page => page.result), result_info: { total_pages: 1 } };
  });
  const blankPage = { success: true, result: [], result_info: { total_pages: 1 } };
  const blankR2 = { success: true, result: [], result_info: { is_truncated: false } };
  let pages = empty.pages, r2 = empty.r2, pagesParsed = false, r2Parsed = false;
  try { if (pagesError) throw new Error("pages_unavailable");
    pages = aggregateCloudflare({
      "secdash-public:production": bodies[0], "secdash-public:preview": bodies[1],
      "secdash-beta:production": bodies[2], "secdash-beta:preview": bodies[3], r2: [blankR2],
    }, observedAt).data.pages; pagesParsed = true;
  } catch { /* preserve explicit incomplete pages */ }
  try { if (r2Error) throw new Error("r2_unavailable");
    r2 = aggregateCloudflare({
      "secdash-public:production": blankPage, "secdash-public:preview": blankPage,
      "secdash-beta:production": blankPage, "secdash-beta:preview": blankPage,
      r2: r2Responses.map(response => unwrapResponse(response).body),
    }, observedAt).data.r2; r2Parsed = true;
  } catch { /* preserve explicit incomplete inventory */ }
  if (pagesError || r2Error || !pagesParsed || !r2Parsed) return { surface: "cloudflare", observedAt: new Date(observedAt).toISOString(), status: "error", errorCode: pagesError ?? r2Error ?? "invalid_response", data: empty };
  const complete = pages.every(page => page.complete) && r2.complete;
  return { surface: "cloudflare", observedAt: new Date(observedAt).toISOString(), status: complete ? "ok" : "partial", ...(complete ? {} : { errorCode: "incomplete_collection" }), data: { accountId, pages, r2 } };
}

const r2Pagination = { pagination: { paginationMode: "updateAParameterInEachRequest", parameters: { parameters: [{ type: "qs", name: "cursor", value: "={{ $response.body.result_info.cursor }}" }] }, paginationCompleteWhen: "other", completeExpression: "={{ $response.body.result_info.is_truncated !== true }}", limitPagesFetched: true, maxRequests: 100 } };
const pagesPagination = { pagination: { paginationMode: "updateAParameterInEachRequest", parameters: { parameters: [{ type: "qs", name: "page", value: "={{ $pageCount + 2 }}" }] }, paginationCompleteWhen: "other", completeExpression: "={{ Number($response.body.result_info.page) >= Number($response.body.result_info.total_pages) }}", limitPagesFetched: true, maxRequests: 100 } };
const base = `https://edge.secdash.invalid/client/v4/accounts/${accountId}`;
const pageNode = (project, env, x) => httpNode({ id: `${project}-${env}`, name: `Read ${project} ${env}`, url: `${base}/pages/projects/${project}/deployments`, credentialId: "SecDashCloudflareRead", credentialName: "SecDash Cloudflare read", position: [x, 40], query: [{ name: "env", value: env }], pagination: pagesPagination });
const projection = `const accountId = ${JSON.stringify(accountId)};\n${unwrapResponse.toString()}\n${safeUpstreamError.toString()}\n${aggregateCloudflare.toString()}\n${aggregateCloudflareResponses.toString()}\nconst many = name => $(name).all().map(item => item.json);\nreturn [{json: aggregateCloudflareResponses({\n  'secdash-public:production': many('Read secdash-public production'),\n  'secdash-public:preview': many('Read secdash-public preview'),\n  'secdash-beta:production': many('Read secdash-beta production'),\n  'secdash-beta:preview': many('Read secdash-beta preview'),\n  r2: $input.all().map(item => item.json),\n})}];`;
export const definition = workflow("SecDashCloudflareOperational", "SecDash — Cloudflare operations (15 min)", [
  scheduleNode, manualNode,
  pageNode("secdash-public", "production", -680), pageNode("secdash-public", "preview", -440), pageNode("secdash-beta", "production", -200), pageNode("secdash-beta", "preview", 40),
  httpNode({ id: "r2", name: "Read complete R2 inventory", url: `${base}/r2/buckets/secdash-downloads/objects`, credentialId: "SecDashCloudflareRead", credentialName: "SecDash Cloudflare read", position: [280, 40], query: [{ name: "per_page", value: "1000" }], pagination: r2Pagination }),
  codeNode("project", "Whitelist Cloudflare telemetry", projection, [540, 40]), deliveryNode([800, 40]),
], {
  ...connectBoth("Read secdash-public production"),
  "Read secdash-public production": { main: [[{ node: "Read secdash-public preview", type: "main", index: 0 }]] },
  "Read secdash-public preview": { main: [[{ node: "Read secdash-beta production", type: "main", index: 0 }]] },
  "Read secdash-beta production": { main: [[{ node: "Read secdash-beta preview", type: "main", index: 0 }]] },
  "Read secdash-beta preview": { main: [[{ node: "Read complete R2 inventory", type: "main", index: 0 }]] },
  "Read complete R2 inventory": { main: [[{ node: "Whitelist Cloudflare telemetry", type: "main", index: 0 }]] },
  "Whitelist Cloudflare telemetry": { main: [[{ node: "Deliver operation observation", type: "main", index: 0 }]] },
});

if (process.argv.includes("--write")) writeFileSync(fileURLToPath(new URL("./operational-cloudflare.json", import.meta.url)), `${JSON.stringify(definition, null, 2)}\n`);
