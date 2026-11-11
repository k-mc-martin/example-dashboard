import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildBudgetBootstrapWorkflow, buildRoutingDrainWorkflow, estimateModelBatch, reserveBudget, ROUTING_LIMITS } from '../infra/n8n/workflows/mailbox-routing-drain.mjs';

const message = {sender:'person@example.test',subject:'Help',body:'Body'};

test('demo model spending is disabled by default',()=>{
  const {modelRoutingAuthorized, ...ceilings}=ROUTING_LIMITS;
  assert.equal(modelRoutingAuthorized,false);
  assert.ok(Object.values(ceilings).every(value=>value===0));
  assert.throws(()=>reserveBudget({},{}),/not been authorized/);
});

test('reservation resets UTC periods and enforces run day and month simultaneously',()=>{
  const limits={modelRoutingAuthorized:true,maxCallsPerRun:2,maxInputTokensPerRun:5000,maxOutputTokensPerRun:1024,maxCostUsdPerRun:1,maxCallsPerDay:4,maxInputTokensPerDay:20000,maxOutputTokensPerDay:4096,maxCostUsdPerDay:2,maxCostUsdPerMonth:3};
  const estimate={calls:1,inputTokens:1000,outputTokens:256,costUsd:.01};
  const next=reserveBudget({version:4,dayKey:'2026-09-29',monthKey:'2026-08',dayCalls:4,monthCostUsd:2},estimate,new Date('2026-09-30T12:00:00Z'),limits);
  assert.deepEqual([next.version,next.previousVersion,next.dayCalls,next.monthCostUsd],[5,4,1,.01]);
  assert.throws(()=>reserveBudget({dayKey:'2026-09-30',dayCalls:4,monthKey:'2026-09'},estimate,new Date('2026-09-30T12:00:00Z'),limits),/daily calls/);
  assert.throws(()=>reserveBudget({dayKey:'2026-09-30',monthKey:'2026-09',monthCostUsd:2.995},estimate,new Date('2026-09-30T12:00:00Z'),limits),/monthly cost/);
});

test('workflow is inactive and model call is behind authorization and optimistic reservation',async()=>{
  const workflow=buildRoutingDrainWorkflow();
  assert.equal(workflow.active,false);
  assert.equal(workflow.nodes.some(n=>n.type==='n8n-nodes-base.scheduleTrigger'),true);
  assert.equal(workflow.nodes.find(n=>n.name==='Every 15 minutes, offset 5m').parameters.rule.interval[0].expression,'5,20,35,50 * * * *');
  assert.equal(workflow.nodes.find(n=>n.name==='Demo routing limits').parameters.jsCode.includes('modelRoutingAuthorized":false'),true);
  const model=workflow.nodes.find(n=>n.name==='Classify one message');
  assert.equal(model.credentials.httpHeaderAuth.id,'DupdashOpenAIRouting');
  assert.equal(model.parameters.options.retry,undefined);
  const planCode=workflow.nodes.find(n=>n.name==='Plan deterministic and model routes').parameters.jsCode;
  assert.match(planCode,/max_completion_tokens: 512/);
  assert.equal(workflow.settings.executionTimeout,600);
  assert.equal(workflow.nodes.some(n=>n.name==='Initialize routing budget row'),false);
  const reservation=workflow.nodes.find(n=>n.name==='Reserve daily and monthly budget');
  assert.equal(reservation.parameters.operation,'update');
  assert.equal(reservation.parameters.filters.conditions.some(c=>c.keyName==='version'),true);
  assert.deepEqual(workflow.connections['Confirm exclusive budget reservation'].main[0].map(x=>x.node),['Prepare model row claims']);
  assert.deepEqual(workflow.connections['Confirm exclusive model claims'].main[0].map(x=>x.node).sort(),['Classify one message','Keep model source'].sort());
  const delivery=workflow.nodes.find(n=>n.name==='Deliver routed message');
  assert.equal(delivery.parameters.url,'http://dashboard:3000/api/n8n/messages');
  assert.equal(delivery.credentials.httpHeaderAuth.id,'DupdashDashboardIngest');
  assert.equal(workflow.nodes.find(n=>n.name==='Mark ledger delivery terminal').parameters.filters.conditions.some(c=>c.keyName==='state'&&c.keyValue==='routed-awaiting-delivery'),true);
  assert.deepEqual(workflow.connections['Already routed'].main[0].map(x=>x.node),['Prepare idempotent dashboard delivery']);
  assert.equal(workflow.connections['Already routed'].main[0].some(x=>x.node==='Classify one message'),false);
  assert.equal(workflow.connections['Validate dashboard acknowledgement'].main[0][0].node,'Mark ledger delivery terminal');
  const prepareDelivery=workflow.nodes.find(n=>n.name==='Prepare idempotent dashboard delivery').parameters.jsCode;
  assert.match(prepareDelivery,/payload.feedback=\{environment:/);
  assert.match(prepareDelivery,/sender:row.sender,subject:row.subject,body:row.body/);
  const ledger=workflow.nodes.find(n=>n.name==='Persist model provenance').parameters.columns.value;
  assert.equal(ledger.feedbackEnvironment,'={{ $json.feedbackEnvironment }}');
  assert.equal(ledger.feedbackEvidenceQuotes,'={{ $json.feedbackEvidenceQuotes }}');
  const saved=JSON.parse(await readFile(new URL('../infra/n8n/workflows/mailbox-routing-drain-prepared.json',import.meta.url),'utf8'));
  assert.equal(saved.id,workflow.id);
  assert.match(saved.nodes.find(n=>n.name==='Plan deterministic and model routes').parameters.jsCode,/Quoted replies and forwarded text are removed before classification/);
  assert.match(saved.nodes.find(n=>n.name==='Plan deterministic and model routes').parameters.jsCode,/function senderAuthoredBody/);
  assert.match(saved.nodes.find(n=>n.name==='Validate model response').parameters.jsCode,/calibrateModelDecision/);
  assert.match(saved.nodes.find(n=>n.name==='Validate model response').parameters.jsCode,/classificationEvidence/);
});

test('budget bootstrap is a separate one-time insert and recurring drain refuses a missing singleton',()=>{
  const bootstrap=buildBudgetBootstrapWorkflow();
  assert.equal(bootstrap.active,false);
  assert.equal(bootstrap.nodes.find(n=>n.name==='Insert budget singleton once').parameters.operation,'insert');
  assert.match(bootstrap.nodes.find(n=>n.name==='Refuse duplicate bootstrap').parameters.jsCode,/one-time only/);
  const drain=buildRoutingDrainWorkflow();
  assert.match(drain.nodes.find(n=>n.name==='Require provisioned routing budget').parameters.jsCode,/missing/);
});

test('demo planner retries delivery and applies deterministic rules with model calls disabled',()=>{
  const workflow=buildRoutingDrainWorkflow();
  const code=workflow.nodes.find(n=>n.name==='Plan deterministic and model routes').parameters.jsCode;
  const run=new Function('$input','$execution',code);
  const base={recordId:'a'.repeat(64),messageId:'id',sender:'person@example.test',subject:'Help',body:'Body',state:'staged-awaiting-approval'};
  const result=run({all:()=>[
    {json:{...base,state:'routed-awaiting-delivery',category:'support'}},
    {json:{...base,recordId:'b'.repeat(64),sender:'sales@billing.example.invalid',subject:'You made a sale!'}},
    {json:{...base,recordId:'c'.repeat(64)}},
  ]},{id:'test'});
  assert.deepEqual(result.map(x=>x.json._lane),['delivery','deterministic']);
  assert.equal(result.some(x=>x.json._openaiRequest),false);
  assert.equal('feedbackEnvironment' in result.find(x=>x.json.recordId==='b'.repeat(64)).json,false);
});

test('disabled model routing skips a batch of unclassified messages',()=>{
  const workflow=buildRoutingDrainWorkflow();
  const code=workflow.nodes.find(n=>n.name==='Plan deterministic and model routes').parameters.jsCode;
  const run=new Function('$input','$execution',code);
  const rows=Array.from({length:10},(_,index)=>({json:{recordId:String(index).padStart(64,'0'),messageId:String(index),sender:'person@example.test',subject:'Feedback',body:'Body',state:'staged-awaiting-approval'}}));
  const result=run({all:()=>rows},{id:'test'});
  assert.equal(result.filter(item=>item.json._lane==='model').length,0);
  assert.equal(estimateModelBatch(rows.slice(0,5).map(item=>item.json)).outputTokens,2560);
});

test('empty ledger placeholder terminates with a zero-work receipt and never becomes a model candidate',()=>{
  const workflow=buildRoutingDrainWorkflow();
  const read=workflow.nodes.find(n=>n.name==='Read staged and delivery-pending messages');
  assert.equal(read.alwaysOutputData,true);
  assert.deepEqual(workflow.connections['Read staged and delivery-pending messages'].main[0].map(x=>x.node),['No pending messages']);
  assert.deepEqual(workflow.connections['No pending messages'].main.map(branch=>branch.map(x=>x.node)),[['Empty queue terminal receipt'],['Plan deterministic and model routes']]);
  const receiptCode=workflow.nodes.find(n=>n.name==='Empty queue terminal receipt').parameters.jsCode;
  assert.deepEqual(new Function(receiptCode)(),[{json:{completed:true,messages:0,modelCalls:0}}]);
  const planCode=workflow.nodes.find(n=>n.name==='Plan deterministic and model routes').parameters.jsCode;
  assert.deepEqual(new Function('$input','$execution',planCode)({all:()=>[{json:{}}]},{id:'test'}),[]);
});

test('model rows are claimed before the provider and stale claims recover without a call',()=>{
  const workflow=buildRoutingDrainWorkflow();
  const claim=workflow.nodes.find(n=>n.name==='Claim staged rows before model');
  assert.equal(claim.parameters.operation,'update');
  assert.equal(claim.parameters.filters.conditions.some(c=>c.keyName==='state'&&c.keyValue==='staged-awaiting-approval'),true);
  const recovery=workflow.nodes.find(n=>n.name==='Release stale model claim');
  assert.equal(recovery.parameters.filters.conditions.some(c=>c.keyName==='routingRunId'),true);
  assert.equal(recovery.parameters.filters.conditions.some(c=>c.keyName==='reservedAt'),true);
  const code=workflow.nodes.find(n=>n.name==='Plan deterministic and model routes').parameters.jsCode;
  const run=new Function('$input','$execution',code);
  const stale={recordId:'f'.repeat(64),state:'model-call-reserved',reservedAt:'2020-01-01T00:00:00Z'};
  const result=run({all:()=>[{json:stale}]},{id:'test'});
  assert.equal(result[0].json._lane,'recover');
  assert.equal(result[0].json.state,'staged-awaiting-approval');
});

test('persistent model cost is derived from required provider usage, never a false zero',()=>{
  const workflow=buildRoutingDrainWorkflow();
  const code=workflow.nodes.find(n=>n.name==='Attach persistent model provenance').parameters.jsCode;
  assert.match(code,/prompt_tokens/);
  assert.match(code,/completion_tokens/);
  assert.match(code,/nominalCostUsd/);
  assert.match(code,/Provider usage is required/);
});

test('dashboard acknowledgement must match the expected stable record hash before terminal state',()=>{
  const workflow=buildRoutingDrainWorkflow();
  const code=workflow.nodes.find(n=>n.name==='Validate dashboard acknowledgement').parameters.jsCode;
  const run=new Function('$input',code);
  const recordId='d'.repeat(64);
  const source={recordId,state:'routed-awaiting-delivery'};
  assert.equal(run({all:()=>[{json:{_deliverySource:source,_deliveryAck:{stored:true,id:recordId}}}]})[0].json.state,'delivered');
  assert.throws(()=>run({all:()=>[{json:{_deliverySource:source,_deliveryAck:{stored:true,id:'e'.repeat(64)}}}]}),/does not match/);
  assert.throws(()=>run({all:()=>[{json:{_deliverySource:source,_deliveryAck:{stored:false,id:recordId}}}]}),/did not acknowledge/);
});
