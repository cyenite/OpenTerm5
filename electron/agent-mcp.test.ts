import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { agentTools, type AgentToolCall } from '../shared/agent';
import { AgentMcpServer, claudeAddCommand, loadAgentMcpConfig } from './agent-mcp';

const token = 'a'.repeat(43);

async function started(call: (call: AgentToolCall) => Promise<unknown> = async () => ({ ok: true })) {
  const calls: AgentToolCall[] = [];
  const server = new AgentMcpServer({ token, version: '9.9.9', call: (made) => { calls.push(made); return call(made); } });
  const port = await server.listen(0);
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { server, port, post, calls };
}

test('initialize answers with the requested protocol version, tools and instructions', async (t) => {
  const { server, post } = await started();
  t.after(() => server.close());
  const response = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, 1);
  assert.equal(body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
  assert.equal(body.result.serverInfo.version, '9.9.9');
  assert.match(body.result.instructions, /chart_state/);
});

test('an unknown protocol version gets the newest one the server speaks', async () => {
  const server = new AgentMcpServer({ token, version: '1', call: async () => null });
  const reply = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.ok(reply && 'result' in reply);
  assert.equal((reply.result as { protocolVersion: string }).protocolVersion, '2025-11-25');
});

test('notifications are accepted with 202 and no body', async (t) => {
  const { server, post } = await started();
  t.after(() => server.close());
  const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), '');
});

test('tools/list offers every catalogue tool with its schema and read-only hint', async () => {
  const server = new AgentMcpServer({ token, version: '1', call: async () => null });
  const reply = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.ok(reply && 'result' in reply);
  const tools = (reply.result as { tools: { name: string; inputSchema: unknown; annotations: { readOnlyHint: boolean } }[] }).tools;
  assert.deepEqual(tools.map((tool) => tool.name), agentTools.map((tool) => tool.name));
  assert.equal(tools.find((tool) => tool.name === 'get_bars')?.annotations.readOnlyHint, true);
  assert.equal(tools.find((tool) => tool.name === 'draw')?.annotations.readOnlyHint, false);
});

test('tools/call passes the arguments through and returns the result as JSON text', async (t) => {
  const { server, post, calls } = await started(async () => ({ symbol: 'EURUSD' }));
  t.after(() => server.close());
  const response = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_bars', arguments: { count: 5 } } });
  const body = await response.json();
  assert.deepEqual(calls, [{ name: 'get_bars', args: { count: 5 } }]);
  assert.deepEqual(body.result, { content: [{ type: 'text', text: '{"symbol":"EURUSD"}' }] });
});

test('a failing tool is a tool error the model can read, not a protocol error', async () => {
  const server = new AgentMcpServer({ token, version: '1', call: async () => { throw new Error('No chart is open.'); } });
  const reply = await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'chart_state' } });
  assert.ok(reply && 'result' in reply);
  assert.deepEqual(reply.result, { content: [{ type: 'text', text: 'No chart is open.' }], isError: true });
});

test('an unknown tool, bad arguments or an unknown method are JSON-RPC errors', async () => {
  const server = new AgentMcpServer({ token, version: '1', call: async () => null });
  const unknownTool = await server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'send_order', arguments: {} } });
  const badArguments = await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'draw', arguments: [] } });
  const unknownMethod = await server.handle({ jsonrpc: '2.0', id: 7, method: 'resources/list' });
  assert.ok(unknownTool && 'error' in unknownTool && unknownTool.error.code === -32602);
  assert.ok(badArguments && 'error' in badArguments && badArguments.error.code === -32602);
  assert.ok(unknownMethod && 'error' in unknownMethod && unknownMethod.error.code === -32601);
});

test('requests without the token, from a web origin, or not POST are refused', async (t) => {
  const { server, port, post } = await started();
  t.after(() => server.close());
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  assert.equal((await post(ping, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await post(ping, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(ping, { Origin: `http://localhost:${port}` })).status, 200);
  const get = await fetch(`http://127.0.0.1:${port}/mcp`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(get.status, 405);
  assert.equal((await fetch(`http://127.0.0.1:${port}/other`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status, 404);
});

test('a body that is not JSON is a parse error', async (t) => {
  const { server, post } = await started();
  t.after(() => server.close());
  const response = await post('{nope');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, -32700);
});

test('the token is created once, kept private and reused', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mcp-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'agent-mcp.json');
  const first = await loadAgentMcpConfig(file, 5000);
  const second = await loadAgentMcpConfig(file, 5000);
  assert.equal(first.token, second.token);
  assert.ok(first.token.length >= 32);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal(claudeAddCommand(first), `claude mcp add --transport http openterm5 http://127.0.0.1:5000/mcp --header "Authorization: Bearer ${first.token}"`);
});

test('a damaged token file is replaced', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mcp-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'agent-mcp.json');
  await fs.writeFile(file, '{broken');
  assert.ok((await loadAgentMcpConfig(file)).token.length >= 32);
});
