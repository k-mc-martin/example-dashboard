import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildWorkflow, prepareApply, validatePreviewReceipt } from "../infra/n8n/workflows/mailbox-routing-apply.mjs";
import { dashboardRecordId, messageContentDigest } from "../infra/n8n/workflows/mailbox-routing-preview.mjs";

const message = (overrides={}) => ({source:"secdash-mail",messageId:"<1@example.test>",sender:"person@example.test",subject:"Hello",body:"Body",receivedAt:"2026-09-30T12:00:00.000Z",category:"unsorted",supportKind:null,sourceUrl:"https://inbox.secdash.invalid/mail/id/example",...overrides});
const decision = (input=message(), overrides={}) => ({recordId:dashboardRecordId(input),contentDigest:messageContentDigest(input),category:"beta",reasonCode:"beta_feedback",confidence:.92,method:"model",...overrides});
const receipt = (results=[decision()]) => ({completed:true,mode:"dry-run",messageCount:results.length,counts:{},methods:{},usage:{},conservativeUpperCostUsd:.01,results,dashboardWrites:0,sourceMessagesChanged:false});

test("applies only the preview category and leaves content unchanged", () => {
  const input=message();
  const [output]=prepareApply([input],receipt());
  assert.deepEqual(output,{...input,category:"beta",supportKind:null});
  for(const field of ["source","messageId","sender","subject","body","receivedAt","sourceUrl"]) assert.equal(output[field],input[field]);
});

test("rejects content changed since preview", () => {
  assert.throws(()=>prepareApply([message({body:"Changed"})],receipt()),/content changed/);
});

test("rejects missing and extra current IDs", () => {
  const second=message({messageId:"<2@example.test>"});
  assert.throws(()=>prepareApply([message(),second],receipt()),/counts do not match/);
  assert.throws(()=>prepareApply([second],receipt()),/absent from the preview/);
});

test("rejects invalid categories and category/reason mismatches", () => {
  assert.throws(()=>validatePreviewReceipt(receipt([decision(message(),{category:"sales"})])),/invalid category/);
  assert.throws(()=>validatePreviewReceipt(receipt([decision(message(),{category:"support",reasonCode:"newsletter"})])),/do not agree/);
});

test("accepts a previewed service failure only as infrastructure", () => {
  const input=message();
  const serviceFailure=decision(input,{category:"infrastructure",reasonCode:"service_failure",confidence:.93});
  assert.equal(validatePreviewReceipt(receipt([serviceFailure]))[0].reasonCode,"service_failure");
  assert.equal(prepareApply([input],receipt([serviceFailure]))[0].category,"infrastructure");
  assert.throws(()=>validatePreviewReceipt(receipt([decision(input,{category:"errors",reasonCode:"service_failure"})])),/do not agree/);
  assert.throws(()=>validatePreviewReceipt(receipt([decision(input,{category:"infrastructure",reasonCode:"error_report"})])),/do not agree/);
  assert.throws(()=>validatePreviewReceipt(receipt([decision(input,{category:"support",reasonCode:"service_failure"})])),/do not agree/);
});

test("accepts explicit operator category-split provenance without changing model evidence", () => {
  const input=message();
  const serviceFailure=decision(input,{category:"infrastructure",reasonCode:"service_failure",confidence:.93,method:"model"});
  const annotated={...receipt([serviceFailure]),provenance:{type:"operator_category_split",fromCategory:"errors",toCategory:"infrastructure"}};
  const [validated]=validatePreviewReceipt(annotated);
  assert.equal(validated.method,"model");
  assert.equal(validated.category,"infrastructure");
  assert.equal(validated.reasonCode,"service_failure");
});

test("rejects decisions the preview routing semantics cannot emit", () => {
  assert.throws(()=>validatePreviewReceipt(receipt([decision(message(),{confidence:.2})])),/model routing semantics/);
  assert.throws(()=>validatePreviewReceipt(receipt([decision(message(),{category:"unsorted",reasonCode:"low_confidence",confidence:.95})])),/low-confidence routing semantics/);
  assert.throws(()=>validatePreviewReceipt(receipt([decision(message(),{category:"purchases",reasonCode:"lemon_sale",method:"deterministic",confidence:.9})])),/deterministic routing semantics/);
});

test("rejects empty and duplicate decisions", () => {
  assert.throws(()=>validatePreviewReceipt(receipt([])),/no decisions/);
  const row=decision();
  assert.throws(()=>validatePreviewReceipt(receipt([row,row])),/duplicate decisions/);
});

test("generated workflow gates the whole Inbox before its first POST", () => {
  const workflow=buildWorkflow(receipt());
  assert.equal(workflow.active,false);
  assert.deepEqual([workflow.settings.saveDataSuccessExecution,workflow.settings.saveDataErrorExecution,workflow.settings.saveManualExecutions],["none","none",false]);
  const gate=workflow.nodes.find(node=>node.name==="Validate preview against current Inbox");
  const post=workflow.nodes.find(node=>node.name==="Deliver classified message");
  assert.ok(gate.parameters.jsCode.includes("contentDigest"));
  assert.equal(post.parameters.url,"http://dashboard:3000/api/n8n/messages");
  assert.equal(post.credentials.httpHeaderAuth.id,"SecDashDashboardIngest");
  assert.equal(JSON.stringify(workflow).includes("scheduleTrigger"),false);
  assert.equal(JSON.stringify(workflow).includes("require('crypto')"),false);
  assert.deepEqual(workflow.connections["Validate preview against current Inbox"].main[0][0].node,"Deliver in batches of 10");
});

test("receipt contains no mail content and asserts exact distinct IDs", () => {
  const workflow=buildWorkflow(receipt());
  const code=workflow.nodes.find(node=>node.name==="Sanitized apply receipt").parameters.jsCode;
  assert.match(code,/duplicate record IDs/);
  assert.match(code,/unexpected record ID/);
  assert.match(code,/categoryCounts/);
  assert.match(code,/infrastructure:0/);
  assert.equal(/sender|subject|body/.test(code),false);
});

test("CLI writes an importable workflow even when the checkout path contains spaces", () => {
  const directory=mkdtempSync(join(tmpdir(),"secdash routing apply "));
  const receiptPath=join(directory,"preview receipt.json");
  const outputPath=join(directory,"apply workflow.json");
  writeFileSync(receiptPath,JSON.stringify(receipt()));
  execFileSync(process.execPath,[fileURLToPath(new URL("../infra/n8n/workflows/mailbox-routing-apply.mjs",import.meta.url)),receiptPath,outputPath]);
  const generated=JSON.parse(readFileSync(outputPath,"utf8"));
  assert.equal(generated.id,"SecDashMailboxRoutingApply");
  assert.equal(generated.active,false);
});
