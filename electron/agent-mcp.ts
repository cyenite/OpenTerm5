import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { agentTools, agentToolTier, isAgentToolName, type AgentToolCall } from '../shared/agent';

export const agentMcpDefaultPort = 47615;
export const agentMcpPath = '/mcp';

const MAX_BODY_BYTES = 1_000_000;
const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26'] as const;
const instructions = [
  'You are connected to OpenTerm5, a desktop trading terminal, and can read and mark up its charts.',
  'Start with chart_state. Read bars with get_bars before stating levels, and base every number you give on a tool result.',
  'Times are the chart\'s own clock, written "YYYY-MM-DD HH:MM". Show conclusions on the chart with draw; label levels with text where the tool allows.',
  'Drawings you make are marked as yours; remove_agent_drawings clears them. Never ask to remove or change the user\'s own drawings.',
  'These tools cannot place, change or close trades.',
].join(' ');

interface JsonRpcRequest {
  readonly id?: string | number | null;
  readonly method?: unknown;
  readonly params?: unknown;
}

type JsonRpcResponse =
  | { readonly jsonrpc: '2.0'; readonly id: string | number | null; readonly result: unknown }
  | { readonly jsonrpc: '2.0'; readonly id: string | number | null; readonly error: { readonly code: number; readonly message: string } };

const rpcErrors = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602 } as const;

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export interface AgentMcpConfig {
  readonly port: number;
  readonly token: string;
}

// The bearer token lives beside the other settings, readable by this user only, so an MCP client
// can be pointed at the terminal once and keep working across restarts.
export async function loadAgentMcpConfig(file: string, port = agentMcpDefaultPort): Promise<AgentMcpConfig> {
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    if (isObject(saved) && typeof saved.token === 'string' && saved.token.length >= 32) return { port, token: saved.token };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  const token = randomBytes(32).toString('base64url');
  await fs.writeFile(file, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  return { port, token };
}

export function claudeAddCommand(config: AgentMcpConfig): string {
  return `claude mcp add --transport http openterm5 http://127.0.0.1:${config.port}${agentMcpPath} --header "Authorization: Bearer ${config.token}"`;
}

export interface AgentMcpDeps {
  readonly token: string;
  readonly version: string;
  readonly call: (call: AgentToolCall) => Promise<unknown>;
}

// A Model Context Protocol server over Streamable HTTP, answering each POST with plain JSON (no
// SSE stream: every tool returns one result). It listens on loopback only and wants the token.
export class AgentMcpServer {
  private server: Server | null = null;
  private readonly token: Buffer;

  constructor(private readonly deps: AgentMcpDeps) {
    this.token = Buffer.from(`Bearer ${deps.token}`);
  }

  listen(port: number): Promise<number> {
    const server = createServer((request, response) => void this.serve(request, response));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  async handle(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isObject(message)) return this.failure(null, new RpcError(rpcErrors.invalidRequest, 'Expected one JSON-RPC message.'));
    const request = message as JsonRpcRequest;
    const id = request.id ?? null;
    const isNotification = !('id' in request);
    try {
      if (typeof request.method !== 'string') throw new RpcError(rpcErrors.invalidRequest, 'The message has no method.');
      const result = await this.dispatch(request.method, request.params);
      return isNotification ? null : { jsonrpc: '2.0', id, result };
    } catch (error) {
      return isNotification ? null : this.failure(id, error);
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    if (method.startsWith('notifications/')) return null;
    if (method === 'ping') return {};
    if (method === 'initialize') return this.initialize(params);
    if (method === 'tools/list') return { tools: agentTools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: { title: tool.title, readOnlyHint: agentToolTier(tool.name).isReadOnly, openWorldHint: false } })) };
    if (method === 'tools/call') return this.callTool(params);
    throw new RpcError(rpcErrors.methodNotFound, `Method ${method} is not supported.`);
  }

  private initialize(params: unknown) {
    const requested = isObject(params) ? params.protocolVersion : undefined;
    const protocolVersion = protocolVersions.find((version) => version === requested) ?? protocolVersions[0];
    return { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'openterm5', title: 'OpenTerm5', version: this.deps.version }, instructions };
  }

  private async callTool(params: unknown) {
    if (!isObject(params) || !isAgentToolName(params.name)) throw new RpcError(rpcErrors.invalidParams, `Unknown tool ${isObject(params) ? String(params.name) : ''}.`.trim());
    const args = params.arguments ?? {};
    if (!isObject(args)) throw new RpcError(rpcErrors.invalidParams, 'Tool arguments must be an object.');
    try {
      const result = await this.deps.call({ name: params.name, args });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  }

  private failure(id: string | number | null, error: unknown): JsonRpcResponse {
    const code = error instanceof RpcError ? error.code : -32603;
    return { jsonrpc: '2.0', id, error: { code, message: error instanceof Error ? error.message : String(error) } };
  }

  private isAuthorized(request: IncomingMessage): boolean {
    const given = Buffer.from(request.headers.authorization ?? '');
    return given.length === this.token.length && timingSafeEqual(given, this.token);
  }

  // Loopback names only, in Host and in any Origin, so a web page cannot reach the server through
  // DNS rebinding even before the token is checked.
  private isLocal(request: IncomingMessage, port: number): boolean {
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const origin = request.headers.origin;
    return hosts.has(request.headers.host ?? '') && (origin === undefined || hosts.has(origin.replace(/^https?:\/\//, '')));
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const address = this.server?.address();
    if (!address || typeof address !== 'object' || !this.isLocal(request, address.port)) return send(response, 403, { error: 'Only local clients may connect.' });
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== agentMcpPath) return send(response, 404, { error: 'Not found.' });
    if (!this.isAuthorized(request)) return send(response, 401, { error: 'A valid bearer token is required.' });
    if (request.method !== 'POST') return send(response, 405, { error: 'Only POST is supported.' }, { Allow: 'POST' });
    let message: unknown;
    try {
      message = JSON.parse(await readBody(request));
    } catch (error) {
      return send(response, 400, this.failure(null, new RpcError(rpcErrors.parse, error instanceof Error ? error.message : 'The body is not JSON.')));
    }
    const reply = await this.handle(message);
    return reply ? send(response, 200, reply) : send(response, 202);
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('The request is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send(response: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    response.writeHead(status, headers).end();
    return;
  }
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
}
