import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dashboardRecordId, messageContentDigest, sha256Hex } from "./mailbox-routing-preview.mjs";

export const APPLY_CATEGORIES = ["beta", "purchases", "errors", "infrastructure", "support", "unsorted"];
export const APPLY_METHODS = ["deterministic", "model"];
export const APPLY_REASON_CODES = {
  beta: ["beta_feedback"],
  purchases: ["lemon_sale"],
  errors: ["error_report"],
  infrastructure: ["service_failure"],
  support: ["customer_support", "provider_support"],
  unsorted: ["newsletter", "operator_purchase_receipt", "account_notice", "ambiguous", "other", "low_confidence", "lemon_test_sale"],
};

const hex64 = /^[a-f0-9]{64}$/;

export function validatePreviewReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("Preview receipt must be an object");
  if (receipt.completed !== true || receipt.mode !== "dry-run" || receipt.dashboardWrites !== 0 || receipt.sourceMessagesChanged !== false) {
    throw new Error("Preview receipt does not prove a completed non-writing dry run");
  }
  if (!Array.isArray(receipt.results) || receipt.results.length === 0) throw new Error("Preview receipt contains no decisions");
  if (!Number.isSafeInteger(receipt.messageCount) || receipt.messageCount !== receipt.results.length) throw new Error("Preview receipt message count is inconsistent");
  const seen = new Set();
  return receipt.results.map((decision) => {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) throw new Error("Preview decision has an invalid shape");
    const keys = Object.keys(decision).sort().join(",");
    if (keys !== "category,confidence,contentDigest,method,reasonCode,recordId") throw new Error("Preview decision contains unexpected fields");
    if (typeof decision.recordId !== "string" || !hex64.test(decision.recordId)) throw new Error("Preview decision has an invalid record ID");
    if (seen.has(decision.recordId)) throw new Error("Preview receipt contains duplicate decisions");
    seen.add(decision.recordId);
    if (typeof decision.contentDigest !== "string" || !hex64.test(decision.contentDigest)) throw new Error("Preview decision has an invalid content digest");
    if (!APPLY_CATEGORIES.includes(decision.category)) throw new Error("Preview decision has an invalid category");
    if (!APPLY_METHODS.includes(decision.method)) throw new Error("Preview decision has an invalid method");
    if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) throw new Error("Preview decision has an invalid confidence");
    if (!APPLY_REASON_CODES[decision.category].includes(decision.reasonCode)) throw new Error("Preview decision category and reason code do not agree");
    if (decision.method === "deterministic" && (decision.confidence !== 1 || !["lemon_sale", "lemon_test_sale"].includes(decision.reasonCode))) throw new Error("Preview decision violates deterministic routing semantics");
    if (decision.method === "model") {
      if (decision.reasonCode === "low_confidence") {
        if (decision.category !== "unsorted" || decision.confidence >= 0.8) throw new Error("Preview decision violates low-confidence routing semantics");
      } else if (decision.confidence < 0.8 || ["lemon_sale", "lemon_test_sale"].includes(decision.reasonCode)) {
        throw new Error("Preview decision violates model routing semantics");
      }
    }
    return { ...decision };
  });
}

export function prepareApply(messages, receipt) {
  const decisions = validatePreviewReceipt(receipt);
  if (!Array.isArray(messages) || messages.length === 0) throw new Error("Current Inbox contains no messages to match against the preview");
  const current = new Map();
  for (const message of messages) {
    if (!message || message.emptyInbox === true) throw new Error("Current Inbox contains no messages to match against the preview");
    const recordId = dashboardRecordId(message);
    if (current.has(recordId)) throw new Error("Current Inbox maps to duplicate dashboard record IDs");
    current.set(recordId, { message, contentDigest: messageContentDigest(message) });
  }
  if (current.size !== decisions.length) throw new Error("Current Inbox and preview decision counts do not match");
  const decisionIds = new Set(decisions.map(decision => decision.recordId));
  for (const recordId of current.keys()) if (!decisionIds.has(recordId)) throw new Error("Current Inbox contains a message absent from the preview");
  const output = [];
  for (const decision of decisions) {
    const match = current.get(decision.recordId);
    if (!match) throw new Error("Preview contains a message absent from the current Inbox");
    if (match.contentDigest !== decision.contentDigest) throw new Error("Current Inbox message content changed after preview");
    output.push({ ...match.message, category: decision.category, supportKind: null });
  }
  return output;
}

export function buildWorkflow(receipt) {
  validatePreviewReceipt(receipt);
  const history = JSON.parse(readFileSync(new URL("./mailbox-history-backfill-manual.json", import.meta.url), "utf8"));
  const read = structuredClone(history.nodes.find(node => node.name === "Read all Inbox pages"));
  const map = structuredClone(history.nodes.find(node => node.name === "Validate and map all messages"));
  read.id = randomUUID(); read.position = [-560, 0];
  map.id = randomUUID(); map.position = [-320, 0];

  const gateCode = `const APPLY_CATEGORIES=${JSON.stringify(APPLY_CATEGORIES)};\nconst APPLY_METHODS=${JSON.stringify(APPLY_METHODS)};\nconst APPLY_REASON_CODES=${JSON.stringify(APPLY_REASON_CODES)};\nconst hex64=/^[a-f0-9]{64}$/;\n${sha256Hex.toString()}\n${dashboardRecordId.toString()}\n${messageContentDigest.toString()}\n${validatePreviewReceipt.toString()}\n${prepareApply.toString()}\nconst receipt=${JSON.stringify(receipt)};\nconst messages=$input.all().filter(item=>item.json?.emptyInbox!==true).map(item=>item.json);\nreturn prepareApply(messages,receipt).map(json=>({json}));`;
  const resultCode = `const results=$input.all();const expected=$('Validate preview against current Inbox').all().map(item=>item.json);if(results.length!==expected.length)throw new Error('Dashboard delivery count does not match the validated preview');const expectedIds=new Set(expected.map(message=>sha256Hex(JSON.stringify([message.source,message.messageId]))));const recordIds=[];for(const item of results){if(item.json?.stored!==true||typeof item.json?.id!=='string'||!${hex64}.test(item.json.id))throw new Error('Dashboard did not confirm a stored message with a valid record ID');recordIds.push(item.json.id);}if(new Set(recordIds).size!==recordIds.length)throw new Error('Dashboard returned duplicate record IDs');if(recordIds.some(id=>!expectedIds.has(id))||recordIds.length!==expectedIds.size)throw new Error('Dashboard returned an unexpected record ID');const categoryCounts={beta:0,purchases:0,errors:0,infrastructure:0,support:0,unsorted:0};for(const message of expected)categoryCounts[message.category]++;return [{json:{completed:true,mode:'apply',messageCount:expected.length,delivered:recordIds.length,recordIds,categoryCounts,sourceMessagesChanged:false}}];`;
  const n = (name, type, parameters, position, typeVersion=2) => ({ parameters, id:randomUUID(), name, type, typeVersion, position });
  const nodes = [
    n("Run apply manually", "n8n-nodes-base.manualTrigger", {}, [-800, 0], 1), read, map,
    n("Validate preview against current Inbox", "n8n-nodes-base.code", { jsCode:gateCode }, [-80, 0]),
    n("Deliver in batches of 10", "n8n-nodes-base.splitInBatches", { batchSize:10, options:{} }, [160, 0], 3),
    n("Deliver classified message", "n8n-nodes-base.httpRequest", { method:"POST", url:"http://dashboard:3000/api/n8n/messages", authentication:"genericCredentialType", genericAuthType:"httpHeaderAuth", sendBody:true, contentType:"json", specifyBody:"json", jsonBody:"={{ $json }}", options:{ timeout:30000, response:{response:{responseFormat:"json"}} } }, [400, 80], 4.2),
    n("Sanitized apply receipt", "n8n-nodes-base.code", { jsCode:`${sha256Hex.toString()}\n${resultCode}` }, [640, -80]),
  ];
  nodes.find(node=>node.name==="Deliver classified message").credentials={httpHeaderAuth:{id:"SecDashDashboardIngest",name:"SecDash dashboard intake"}};
  const c = (node,index=0) => ({node,type:"main",index});
  return {id:"SecDashMailboxRoutingApply",name:"SecDash — mailbox routing apply (manual)",active:false,nodes,connections:{"Run apply manually":{main:[[c("Read all Inbox pages")]]},"Read all Inbox pages":{main:[[c("Validate and map all messages")]]},"Validate and map all messages":{main:[[c("Validate preview against current Inbox")]]},"Validate preview against current Inbox":{main:[[c("Deliver in batches of 10")]]},"Deliver in batches of 10":{main:[[c("Sanitized apply receipt")],[c("Deliver classified message")]]},"Deliver classified message":{main:[[c("Deliver in batches of 10")]]}},settings:{executionOrder:"v1",saveDataSuccessExecution:"none",saveDataErrorExecution:"none",saveManualExecutions:false},pinData:{},versionId:randomUUID(),tags:[]};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const receiptPath = process.argv[2];
  if (!receiptPath) throw new Error("Usage: node mailbox-routing-apply.mjs <sanitized-preview-receipt.json> [output.json]");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const outputPath = process.argv[3] ?? new URL("./mailbox-routing-apply-manual.json", import.meta.url);
  writeFileSync(outputPath, `${JSON.stringify(buildWorkflow(receipt), null, 2)}\n`);
}
