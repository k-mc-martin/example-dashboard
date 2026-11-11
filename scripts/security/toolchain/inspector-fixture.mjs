import { createInterface } from 'node:readline';

// Offline fixture for exercising the Inspector CLI's stdio transport.
const tool = {
  name: 'fixture_status',
  description: 'Read the status of a fictional provider.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) continue;
  let result;
  if (method === 'server/discover') {
    result = {
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      ttlMs: 0, cacheScope: 'private',
      capabilities: { tools: {} },
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'dupdash-stdio-fixture', version: '1' } },
    };
  } else if (method === 'tools/list') {
    result = { resultType: 'complete', ttlMs: 0, cacheScope: 'private', tools: [tool] };
  } else if (method === 'tools/call' && params?.name === tool.name) {
    result = { resultType: 'complete', content: [{ type: 'text', text: 'fictional provider ready' }] };
  }
  const reply = result ? { result } : { error: { code: -32601, message: 'Unknown fixture method' } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...reply }) + '\n');
}
