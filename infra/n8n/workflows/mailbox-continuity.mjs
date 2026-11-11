import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dashboardRecordId, deterministicRoute, messageContentDigest, sha256Hex } from "./mailbox-routing-preview.mjs";

export const SIX_BUCKETS = ["beta", "purchases", "errors", "infrastructure", "support", "unsorted"];
export const DEFAULT_CONFIG = Object.freeze({
  classificationMode: "disabled",
  approvedMaxCalls: 0,
  approvedMaxInputTokens: 0,
  approvedMaxOutputTokens: 0,
  approvedMaxCostUsd: 0,
  overlapMinutes: 10,
  pageSize: 25,
  maxPages: 100,
});

export function validateRunConfig(value = {}) {
  const config = { ...DEFAULT_CONFIG, ...value };
  if (!['disabled', 'deterministic-only', 'approved-model'].includes(config.classificationMode)) throw new Error('Unknown classification mode');
  for (const key of ['approvedMaxCalls', 'approvedMaxInputTokens', 'approvedMaxOutputTokens', 'approvedMaxCostUsd']) {
    if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`${key} must be a non-negative finite number`);
  }
  if (config.classificationMode !== 'approved-model' && [config.approvedMaxCalls, config.approvedMaxInputTokens, config.approvedMaxOutputTokens, config.approvedMaxCostUsd].some(Boolean)) {
    throw new Error('Spend ceilings require approved-model mode');
  }
  if (config.classificationMode === 'approved-model' && [config.approvedMaxCalls, config.approvedMaxInputTokens, config.approvedMaxOutputTokens, config.approvedMaxCostUsd].some(limit => limit <= 0)) {
    throw new Error('Approved model routing requires explicit positive call, token, and dollar ceilings');
  }
  if (!Number.isInteger(config.overlapMinutes) || config.overlapMinutes < 1 || config.overlapMinutes > 1440) throw new Error('overlapMinutes is outside the safe range');
  if (!Number.isInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 100) throw new Error('pageSize is outside the Graph range');
  if (!Number.isInteger(config.maxPages) || config.maxPages < 1 || config.maxPages > 1000) throw new Error('maxPages is outside the safe range');
  return config;
}

export function graphStartUrl(checkpoint, config = DEFAULT_CONFIG) {
  const checked = validateRunConfig(config);
  const base = 'https://mail.dupdash.invalid/v1.0/me/mailFolders/inbox/messages';
  const params = new URLSearchParams({
    '$top': String(checked.pageSize),
    '$orderby': 'receivedDateTime asc',
    '$select': 'id,internetMessageId,from,subject,body,receivedDateTime,webLink',
  });
  if (checkpoint?.watermark) {
    const time = Date.parse(checkpoint.watermark);
    if (!Number.isFinite(time)) throw new Error('Checkpoint watermark is invalid');
    params.set('$filter', `receivedDateTime ge ${new Date(time - checked.overlapMinutes * 60000).toISOString()}`);
  }
  return `${base}?${params}`;
}

export function validateNextLink(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new Error('Microsoft Graph pagination URL is not a string');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'mail.dupdash.invalid' || (url.port && url.port !== '443')) throw new Error('Microsoft Graph returned an unexpected pagination origin');
  const path = decodeURIComponent(url.pathname).replace(/\('inbox'\)/i, '/inbox');
  if (path.toLowerCase() !== '/v1.0/me/mailfolders/inbox/messages') throw new Error('Microsoft Graph returned an unexpected pagination path');
  return raw;
}

export function contentFingerprint(message) {
  return messageContentDigest({
    sender: message.sender,
    subject: message.subject,
    body: message.body,
    receivedAt: message.receivedAt,
    sourceUrl: message.sourceUrl ?? null,
  });
}

// A stored revision gets its own ledger identity so the original can finish routing.
function intakeRecordKey(recordId, contentDigest, existing) {
  if (!existing) return recordId;
  if (!existing.contentDigest || existing.contentDigest === contentDigest) return null;
  return `conflict:${recordId}:${contentDigest}`;
}

export function planContinuity(messages, ledgerRows, historicalSeed, config = DEFAULT_CONFIG) {
  const checked = validateRunConfig(config);
  const ledger = new Map(ledgerRows.map(row => [row.recordId, row]));
  const seed = new Map(historicalSeed.map(row => [row.recordId, row]));
  const seen = new Set();
  const plans = [];
  for (const message of messages) {
    const recordId = dashboardRecordId(message);
    if (seen.has(recordId)) continue;
    seen.add(recordId);
    const contentDigest = contentFingerprint(message);
    const existing = ledger.get(recordId) ?? seed.get(recordId);
    const key = intakeRecordKey(recordId, contentDigest, existing);
    if (key === null || ledger.has(key)) {
      plans.push({ recordId: key ?? recordId, contentDigest, state: 'already-terminal', existing: ledger.get(key) ?? existing });
      continue;
    }
    if (key !== recordId) {
      plans.push({ recordId: key, contentDigest, message, state: 'quarantined', decision: null, provenance: { method: 'continuity', reasonCode: 'stable_content_changed' } });
      continue;
    }
    const deterministic = deterministicRoute(message);
    if (deterministic) {
      plans.push({ recordId, contentDigest, state: 'ready', message, decision: deterministic, provenance: { method: deterministic.method, reasonCode: deterministic.reasonCode, model: null } });
    } else if (checked.classificationMode === 'disabled' || checked.classificationMode === 'deterministic-only') {
      plans.push({ recordId, contentDigest, state: 'staged-awaiting-approval', message, decision: null, provenance: { method: 'disabled', reasonCode: 'model_spend_not_authorized', model: null } });
    } else {
      plans.push({ recordId, contentDigest, state: 'requires-approved-model', message, decision: null, provenance: { method: 'pending-model', reasonCode: 'approved_run_required', model: 'gpt-5.6-luna' } });
    }
  }
  return plans;
}

export function verifyHistoricalSeed(messages, historicalSeed) {
  if (!Array.isArray(historicalSeed)) throw new Error('Expected a historical seed array');
  const expected = new Map(historicalSeed.map(row => [row.recordId, row.contentDigest]));
  if (expected.size !== historicalSeed.length) throw new Error('Historical seed contains duplicate record IDs');
  const matched = new Set();
  for (const message of messages) {
    const recordId = dashboardRecordId(message);
    if (!expected.has(recordId)) continue;
    if (expected.get(recordId) !== contentFingerprint(message)) throw new Error(`Historical message ${recordId} changed content or immutable-ID mapping`);
    matched.add(recordId);
  }
  if (matched.size !== expected.size) throw new Error(`Historical immutable-ID compatibility check matched ${matched.size} of ${expected.size} rows`);
  return { verified: true, expected: expected.size, matched: matched.size, sourceMessagesChanged: false, contentEmitted: false };
}

export function assertModelBudget(config, estimate, usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }) {
  const checked = validateRunConfig(config);
  if (checked.classificationMode !== 'approved-model') throw new Error('Model routing is disabled; historical authorization is not reusable');
  const projected = {
    calls: usage.calls + estimate.calls,
    inputTokens: usage.inputTokens + estimate.inputTokens,
    outputTokens: usage.outputTokens + estimate.outputTokens,
    costUsd: usage.costUsd + estimate.costUsd,
  };
  if (projected.calls > checked.approvedMaxCalls || projected.inputTokens > checked.approvedMaxInputTokens || projected.outputTokens > checked.approvedMaxOutputTokens || projected.costUsd > checked.approvedMaxCostUsd) {
    throw new Error('Approved per-run model ceiling would be exceeded before the provider call');
  }
  return projected;
}

export function checkpointAfter(previous, plans) {
  const incomplete = plans.filter(plan => !['already-terminal', 'delivered', 'staged-awaiting-approval', 'quarantined'].includes(plan.state));
  if (incomplete.length) throw new Error('Checkpoint cannot advance while messages lack a durable terminal intake state');
  const timestamps = plans.map(plan => plan.message?.receivedAt).filter(Boolean).sort();
  return { watermark: [...timestamps, previous?.watermark].filter(Boolean).sort().at(-1) ?? null, terminalRecordIds: plans.map(plan => plan.recordId).sort() };
}

export function buildWorkflow() {
  const configCode = `return [{json:${JSON.stringify(DEFAULT_CONFIG)}}];`;
  const backfill = JSON.parse(readFileSync(new URL('./mailbox-history-backfill-manual.json', import.meta.url), 'utf8'));
  const mapCode = backfill.nodes.find(node => node.name === 'Validate and map all messages').parameters.jsCode;
  const schema = fields => fields.map(([id, type]) => ({ id, displayName: id, required: false, defaultMatch: id === 'recordId' || id === 'mailbox', display: true, type, canBeUsedToMatch: true }));
  const ledgerFields = [['recordId','string'],['messageId','string'],['sender','string'],['subject','string'],['body','string'],['receivedAt','string'],['sourceUrl','string'],['contentDigest','string'],['state','string'],['category','string'],['routingMethod','string'],['reasonCode','string'],['confidence','number'],['model','string'],['routedAt','string'],['dashboardRecordId','string'],['attemptCount','number'],['lastErrorClass','string'],['lastErrorAt','string'],['routingRunId','string'],['reservedAt','string'],['modelInputTokens','number'],['modelOutputTokens','number'],['modelCostUsd','number'],['feedbackEnvironment','string'],['feedbackInterpretation','string'],['feedbackEvidenceQuotes','string'],['feedbackRationale','string'],['feedbackContext','string'],['intendedExperienceReference','string']];
  const stateFields = [['mailbox','string'],['watermark','string'],['checkpointUpdatedAt','string']];
  const tableNode = (id, name, tableName, fields, position) => ({ parameters: { resource: 'table', operation: 'create', tableName, columns: { column: fields.map(([name,type]) => ({ name, type })) }, options: { createIfNotExists: true } }, id, name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position });
  const rowNode = (id, name, operation, tableName, fields, position, extra = {}) => {
    const { alwaysOutputData = false, ...parameters } = extra;
    return { parameters: { resource: 'row', operation, dataTableId: { __rl: true, mode: 'name', value: tableName }, ...parameters, ...(operation === 'upsert' ? { columns: { mappingMode: 'autoMapInputData', value: null, schema: schema(fields) }, options: {} } : {}) }, id, name, type: 'n8n-nodes-base.dataTable', typeVersion: 1.1, position, ...(alwaysOutputData ? { alwaysOutputData: true } : {}) };
  };
  const shaRuntime = `${sha256Hex.toString()}\n${dashboardRecordId.toString()}\n${messageContentDigest.toString()}`;
  const prepareStageCode = `${shaRuntime}
${intakeRecordKey.toString()}
const mapped=$('Validate complete catch-up').all().filter(item=>item.json?.emptyInbox!==true).map(item=>item.json);
const ledger=new Map($input.all().filter(item=>item.json?.recordId).map(item=>[item.json.recordId,item.json]));
const out=[];const seen=new Set();
for(const message of mapped){
 const recordId=dashboardRecordId(message);if(seen.has(recordId))continue;seen.add(recordId);
 const contentDigest=messageContentDigest(message);const existing=ledger.get(recordId);
 const key=intakeRecordKey(recordId,contentDigest,existing);
 if(key===null || ledger.has(key))continue;
 const conflict=key!==recordId;
 out.push({json:{recordId:key,messageId:message.messageId,sender:message.sender,subject:message.subject,body:message.body,receivedAt:message.receivedAt,sourceUrl:message.sourceUrl??'',contentDigest,state:conflict?'quarantined':'staged-awaiting-approval',category:'',routingMethod:conflict?'continuity':'disabled',reasonCode:conflict?'stable_content_changed':'model_spend_not_authorized',confidence:0,model:'',routedAt:'',dashboardRecordId:'',attemptCount:0,lastErrorClass:'',lastErrorAt:'',routingRunId:'',reservedAt:'',modelInputTokens:0,modelOutputTokens:0,modelCostUsd:0,feedbackEnvironment:'',feedbackInterpretation:'',feedbackEvidenceQuotes:'',feedbackRationale:'',feedbackContext:'',intendedExperienceReference:''}});
}
return out.length?out:[{json:{_noNew:true}}];`;
  const checkpointCode = `const mapped=$('Validate complete catch-up').all().filter(item=>item.json?.emptyInbox!==true).map(item=>item.json);const previous=$('Normalize checkpoint').first().json;const prepared=$('Prepare durable staging rows').all().filter(x=>!x.json?._noNew);const written=new Map($input.all().map(x=>[x.json.recordId,x.json]));if(prepared.some(({json})=>written.get(json.recordId)?.contentDigest!==json.contentDigest || written.get(json.recordId)?.state!==json.state))throw Error('Durable staging acknowledgement mismatch; checkpoint retained');const timestamps=[previous.watermark,...mapped.map(x=>x.receivedAt)].filter(Boolean).sort();return [{json:{mailbox:'inbox',watermark:timestamps.at(-1)??previous.watermark??null,checkpointUpdatedAt:new Date().toISOString()}}];`;
  return {
    id: 'DupdashMailboxContinuityPrepared',
    name: 'Dupdash — mailbox continuity (authorized, 15 minutes)',
    active: false,
    nodes: [
      { parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } }, id: 'schedule', name: 'Every 15 minutes', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [-1500, -120] },
      { parameters: {}, id: 'manual', name: 'Run manually', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-1500, 0] },
      { parameters: { jsCode: configCode }, id: 'config', name: 'Fail-closed run configuration', type: 'n8n-nodes-base.code', typeVersion: 2, position: [-1300, 0], notes: 'Model routing is disabled. All approved model ceilings are zero.' },
      tableNode('create-ledger','Create or reuse continuity ledger','dupdash_mail_continuity_ledger',ledgerFields,[-1100,0]),
      tableNode('create-state','Create or reuse continuity state','dupdash_mail_continuity_state',stateFields,[-300,0]),
      rowNode('get-state','Read Inbox checkpoint','get','dupdash_mail_continuity_state',stateFields,[-100,0],{matchType:'allConditions',filters:{conditions:[{keyName:'mailbox',condition:'eq',keyValue:'inbox'}]},returnAll:false,limit:1,orderBy:false,alwaysOutputData:true}),
      {parameters:{jsCode:"const row=$input.first()?.json??{};return [{json:{mailbox:'inbox',watermark:row.watermark??null}}];"},id:'normalize-state',name:'Normalize checkpoint',type:'n8n-nodes-base.code',typeVersion:2,position:[100,0]},
      {parameters:{jsCode:`const base='https://mail.dupdash.invalid/v1.0/me/mailFolders/inbox/messages';const parts=['%24top=25','%24orderby='+encodeURIComponent('receivedDateTime asc'),'%24select='+encodeURIComponent('id,internetMessageId,from,subject,body,receivedDateTime,webLink')];if($json.watermark){const t=Date.parse($json.watermark);if(!Number.isFinite(t))throw Error('Invalid checkpoint watermark');parts.push('%24filter='+encodeURIComponent('receivedDateTime ge '+new Date(t-600000).toISOString()));}return [{json:{...$json,startUrl:base+'?'+parts.join('&')}}];`},id:'start-url',name:'Build overlapped Inbox URL',type:'n8n-nodes-base.code',typeVersion:2,position:[300,0]},
      {parameters:{url:'={{ $json.startUrl }}',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendHeaders:true,headerParameters:{parameters:[{name:'Prefer',value:'outlook.body-content-type="text", IdType="ImmutableId"'},{name:'Accept',value:'application/json'}]},options:{pagination:{pagination:{paginationMode:'responseContainsNextURL',nextURL:"={{ (() => { const raw = $response.body?.['@odata.nextLink']; const initial = $('Build overlapped Inbox URL').first().json.startUrl; const inbox = RegExp(\"^https://mail[.]dupdash[.]invalid(?::443)?/v1[.]0/me/mailFolders(?:/inbox|[(]'inbox'[)]|%28%27inbox%27%29)/messages(?:[?]|$)\", \"i\"); if (!raw) return initial; if (typeof raw !== 'string' || !inbox.test(raw)) throw Error('Microsoft Graph returned an unexpected pagination URL'); return raw; })() }}",paginationCompleteWhen:'other',completeExpression:"={{ !$response.body?.['@odata.nextLink'] }}",limitPagesFetched:true,maxRequests:100,requestInterval:200}},timeout:30000,response:{response:{responseFormat:'json'}}}},id:'read-pages',name:'Read complete overlapped Inbox pages',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[500,0],credentials:{httpHeaderAuth:{id:'DupdashMailRead',name:'Demo mailbox'}}},
      {parameters:{jsCode:mapCode},id:'validate-catchup',name:'Validate complete catch-up',type:'n8n-nodes-base.code',typeVersion:2,position:[700,0]},
      {parameters:{jsCode:"return [{json:{validatedMessages:$input.all().filter(x=>x.json?.emptyInbox!==true).length}}];"},id:'catchup-ready',name:'Close catch-up read barrier',type:'n8n-nodes-base.code',typeVersion:2,position:[850,0]},
      rowNode('get-ledger','Read durable continuity ledger','get','dupdash_mail_continuity_ledger',ledgerFields,[1000,0],{matchType:'anyCondition',filters:{conditions:[]},returnAll:true,orderBy:false,alwaysOutputData:true}),
      {parameters:{jsCode:prepareStageCode},id:'prepare-stage',name:'Prepare durable staging rows',type:'n8n-nodes-base.code',typeVersion:2,position:[1150,0]},
      {parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'no-new',leftValue:'={{ $json._noNew === true }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},id:'has-new',name:'No new messages',type:'n8n-nodes-base.if',typeVersion:2.2,position:[1300,0]},
      rowNode('upsert-stage','Upsert durable staged messages','upsert','dupdash_mail_continuity_ledger',ledgerFields,[1500,120],{matchType:'allConditions',filters:{conditions:[{keyName:'recordId',condition:'eq',keyValue:'={{ $json.recordId }}'}]}}),
      {parameters:{jsCode:checkpointCode},id:'checkpoint',name:'Prepare checkpoint commit',type:'n8n-nodes-base.code',typeVersion:2,position:[1700,0]},
      rowNode('upsert-state','Commit Inbox checkpoint','upsert','dupdash_mail_continuity_state',stateFields,[1900,0],{matchType:'allConditions',filters:{conditions:[{keyName:'mailbox',condition:'eq',keyValue:'inbox'}]}}),
      {parameters:{jsCode:"const state=$('Prepare checkpoint commit').first().json;const rows=$('Prepare durable staging rows').all();const quarantined=rows.filter(x=>x.json.state==='quarantined').length;const staged=rows.filter(x=>x.json.state==='staged-awaiting-approval').length;return [{json:{completed:true,mode:'continuity-stage-only',staged,quarantined,watermark:state.watermark,modelCalls:0,modelInputTokens:0,modelOutputTokens:0,modelCostUsd:0,dashboardWrites:0,sourceMessagesChanged:false}}];"},id:'receipt',name:'Sanitized continuity receipt',type:'n8n-nodes-base.code',typeVersion:2,position:[2100,0]},
    ],
    connections: {
      'Every 15 minutes':{main:[[{node:'Fail-closed run configuration',type:'main',index:0}]]},
      'Run manually':{main:[[{node:'Fail-closed run configuration',type:'main',index:0}]]},
      'Fail-closed run configuration':{main:[[{node:'Create or reuse continuity ledger',type:'main',index:0}]]},
      'Create or reuse continuity ledger':{main:[[{node:'Create or reuse continuity state',type:'main',index:0}]]},
      'Create or reuse continuity state':{main:[[{node:'Read Inbox checkpoint',type:'main',index:0}]]},
      'Read Inbox checkpoint':{main:[[{node:'Normalize checkpoint',type:'main',index:0}]]},
      'Normalize checkpoint':{main:[[{node:'Build overlapped Inbox URL',type:'main',index:0}]]},
      'Build overlapped Inbox URL':{main:[[{node:'Read complete overlapped Inbox pages',type:'main',index:0}]]},
      'Read complete overlapped Inbox pages':{main:[[{node:'Validate complete catch-up',type:'main',index:0}]]},
      'Validate complete catch-up':{main:[[{node:'Close catch-up read barrier',type:'main',index:0}]]},
      'Close catch-up read barrier':{main:[[{node:'Read durable continuity ledger',type:'main',index:0}]]},
      'Read durable continuity ledger':{main:[[{node:'Prepare durable staging rows',type:'main',index:0}]]},
      'Prepare durable staging rows':{main:[[{node:'No new messages',type:'main',index:0}]]},
      'No new messages':{main:[[{node:'Prepare checkpoint commit',type:'main',index:0}],[{node:'Upsert durable staged messages',type:'main',index:0}]]},
      'Upsert durable staged messages':{main:[[{node:'Prepare checkpoint commit',type:'main',index:0}]]},
      'Prepare checkpoint commit':{main:[[{node:'Commit Inbox checkpoint',type:'main',index:0}]]},
      'Commit Inbox checkpoint':{main:[[{node:'Sanitized continuity receipt',type:'main',index:0}]]},
    },
    settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, timezone: 'UTC' },
    pinData: {}, tags: [],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2];
  if (!outputPath) throw new Error('Usage: node mailbox-continuity.mjs OUTPUT');
  writeFileSync(outputPath, JSON.stringify(buildWorkflow(), null, 2) + '\n');
}
