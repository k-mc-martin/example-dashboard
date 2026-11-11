import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../infra/n8n/workflows/mailbox-history-backfill-manual.json", import.meta.url);
const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
const mapper = workflow.nodes.find(node => node.name === "Validate and map all messages");

async function mapPages(pages) {
  const execute = new Function(
    "$input",
    "Buffer",
    "URL",
    `return (async () => { ${mapper.parameters.jsCode} })();`,
  );
  return execute({ all: () => pages.map(json => ({ json })) }, Buffer, undefined);
}

async function runCodeNode(name, input, nodeOutputs) {
  const node = workflow.nodes.find(candidate => candidate.name === name);
  const execute = new Function(
    "$input",
    "$",
    "Buffer",
    `return (async () => { ${node.parameters.jsCode} })();`,
  );
  const selectNode = nodeName => ({ all: () => nodeOutputs[nodeName] ?? [] });
  return execute({ all: () => input }, selectNode, Buffer);
}

function evaluateExpression(expression, response) {
  assert.ok(expression.startsWith("={{") && expression.endsWith("}}"));
  const source = expression.slice(3, -2).trim();
  return new Function("$response", `return (${source});`)(response);
}

function message(overrides = {}) {
  return {
    id: "graph-1",
    internetMessageId: "<message-1@example.test>",
    from: { emailAddress: { address: "sender@example.test" } },
    subject: "Subject",
    body: { contentType: "text", content: "Full body" },
    receivedDateTime: "2026-09-01T12:00:00Z",
    webLink: "https://inbox.dupdash.invalid/mail/deeplink/read/id",
    ...overrides,
  };
}

test("maps two Graph pages and preserves unsorted delivery fields", async () => {
  const pages = [
    { value: [message()], "@odata.nextLink": "https://mail.dupdash.invalid/v1.0/me/mailFolders/inbox/messages?$skip=25" },
    { value: [message({ id: "graph-2", internetMessageId: "", subject: null, webLink: null })] },
  ];
  const result = await mapPages(pages);
  assert.equal(result.length, 2);
  assert.equal(result[0].json.messageId, "<message-1@example.test>");
  assert.equal(result[1].json.messageId, "graph-2");
  assert.equal(result[1].json.subject, "");
  assert.equal(result[1].json.category, "unsorted");
  assert.equal(result[1].json.supportKind, null);
});

test("deduplicates repeated provider identifiers across pages", async () => {
  const duplicate = message();
  const result = await mapPages([{ value: [duplicate] }, { value: [duplicate] }]);
  assert.equal(result.length, 1);
});

test("fails visibly when required message fields are missing", async () => {
  await assert.rejects(
    mapPages([{ value: [message({ from: null })] }]),
    /missing its sender/,
  );
  await assert.rejects(
    mapPages([{ value: [message({ internetMessageId: "", id: "" })] }]),
    /missing both internetMessageId and Graph id/,
  );
});

test("accepts the final page without a nextLink", async () => {
  assert.deepEqual(await mapPages([{ value: [] }]), [{ json: { emptyInbox: true } }]);
});

test("rejects a pagination URL outside the exact Graph Inbox collection", async () => {
  await assert.rejects(
    mapPages([{ value: [], "@odata.nextLink": "https://example.com/v1.0/me/mailFolders/inbox/messages?$skip=25" }]),
    /unexpected pagination URL/,
  );
});

test("rejects oversized bodies instead of truncating them", async () => {
  await assert.rejects(
    mapPages([{ value: [message({ body: { contentType: "text", content: "x".repeat(64001) } })] }]),
    /not truncated or delivered/,
  );
});

test("rejects a UTF-8 payload over 100 KB even when its body is under 64,000 characters", async () => {
  await assert.rejects(
    mapPages([{ value: [message({ body: { contentType: "text", content: "😀".repeat(30000) } })] }]),
    /payload exceeds 100 KB/,
  );
});

test("workflow remains inactive, manual-only, and does not persist payloads", () => {
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.some(node => node.type === "n8n-nodes-base.manualTrigger"));
  assert.equal(workflow.nodes.some(node => node.type === "n8n-nodes-base.scheduleTrigger"), false);
  assert.equal(workflow.settings.saveDataSuccessExecution, "none");
  assert.equal(workflow.settings.saveDataErrorExecution, "none");
  assert.equal(workflow.settings.saveManualExecutions, false);
  assert.ok(workflow.nodes.some(node => node.name === "Empty Inbox result"));
  assert.equal(workflow.nodes.some(node => node.parameters?.jsCode?.includes("new URL")), false);
  const graphNode = workflow.nodes.find(node => node.name === "Read all Inbox pages");
  assert.equal(graphNode.parameters.options.pagination.pagination.nextURL.includes("new URL"), false);
});

test("pagination uses a valid initial URL and completes after a final page", () => {
  const graphNode = workflow.nodes.find(node => node.name === "Read all Inbox pages");
  const pagination = graphNode.parameters.options.pagination.pagination;
  const initialUrl = "https://mail.dupdash.invalid/v1.0/me/mailFolders/inbox/messages";
  assert.equal(evaluateExpression(pagination.nextURL, {}), initialUrl);
  assert.equal(evaluateExpression(pagination.nextURL, { body: { value: [] } }), initialUrl);
  assert.equal(evaluateExpression(pagination.completeExpression, { body: { value: [] } }), true);

  const next = `${initialUrl}?$skip=25`;
  assert.equal(evaluateExpression(pagination.nextURL, { body: { "@odata.nextLink": next } }), next);
  assert.equal(evaluateExpression(pagination.completeExpression, { body: { "@odata.nextLink": next } }), false);
});

test("workflow reads only Inbox metadata and bodies and contains no mail mutation", () => {
  const graphNode = workflow.nodes.find(node => node.name === "Read all Inbox pages");
  assert.equal(graphNode.parameters.url, "https://mail.dupdash.invalid/v1.0/me/mailFolders/inbox/messages");
  assert.equal(graphNode.parameters.method, undefined);
  const selected = graphNode.parameters.queryParameters.parameters.find(parameter => parameter.name === "$select").value;
  assert.equal(selected.includes("attachments"), false);
  assert.equal(workflow.nodes.some(node => /send|move|delete|update/i.test(node.name) && node !== graphNode), false);
});

test("completion proof contains hashes and aggregates but no mailbox content", async () => {
  const mapped = await mapPages([
    { value: [message({ body: { contentType: "text", content: "First 😀" }, receivedDateTime: "2026-09-01T12:00:00Z" })], "@odata.nextLink": "https://mail.dupdash.invalid/v1.0/me/mailFolders/inbox/messages?$skip=25" },
    { value: [message({ id: "graph-2", internetMessageId: "<message-2@example.test>", body: { contentType: "text", content: "Second" }, receivedDateTime: "2026-09-02T12:00:00Z" })] },
  ]);
  const ids = ["a".repeat(64), "b".repeat(64)];
  const result = await runCodeNode(
    "Backfill result",
    ids.map(id => ({ json: { id, stored: true } })),
    {
      "Read all Inbox pages": [{ json: {} }, { json: {} }],
      "Validate and map all messages": mapped,
    },
  );
  assert.deepEqual(result[0].json, {
    completed: true,
    sourcePages: 2,
    messageCount: 2,
    delivered: 2,
    recordIds: ids,
    totalBodyCharacters: "First 😀".length + "Second".length,
    totalBodyUtf8Bytes: Buffer.byteLength("First 😀Second", "utf8"),
    oldestReceivedAt: "2026-09-01T12:00:00.000Z",
    newestReceivedAt: "2026-09-02T12:00:00.000Z",
    category: "unsorted",
    mailboxScope: "Inbox",
    sourceMessagesChanged: false,
  });
  const proof = JSON.stringify(result);
  assert.equal(proof.includes("sender@example.test"), false);
  assert.equal(proof.includes("Subject"), false);
  assert.equal(proof.includes("First"), false);
});

test("completion proof rejects count mismatches and duplicate record IDs", async () => {
  const mapped = await mapPages([{ value: [message(), message({ id: "graph-2", internetMessageId: "<message-2@example.test>" })] }]);
  const duplicate = "c".repeat(64);
  const outputs = {
    "Read all Inbox pages": [{ json: {} }],
    "Validate and map all messages": mapped,
  };
  await assert.rejects(
    runCodeNode("Backfill result", [{ json: { id: duplicate, stored: true } }], outputs),
    /delivery count does not match/,
  );
  await assert.rejects(
    runCodeNode("Backfill result", [{ json: { id: duplicate, stored: true } }, { json: { id: duplicate, stored: true } }], outputs),
    /duplicate record IDs/,
  );
});

test("empty Inbox proof returns zeroed sanitized aggregates", async () => {
  const result = await runCodeNode("Empty Inbox result", [{ json: { emptyInbox: true } }], {
    "Read all Inbox pages": [{ json: { value: [] } }],
  });
  assert.equal(result[0].json.sourcePages, 1);
  assert.equal(result[0].json.messageCount, 0);
  assert.equal(result[0].json.delivered, 0);
  assert.deepEqual(result[0].json.recordIds, []);
  assert.equal(result[0].json.oldestReceivedAt, null);
  assert.equal(result[0].json.newestReceivedAt, null);
});
