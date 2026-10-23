import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { canUseScope, hubMethodScope, type HubApiKey, type HubDeviceInfo, type HubEventMessage, type HubReady, type HubReply, type HubSettings } from '../shared/hub';
import { acceptDevice, HubChannel, HubHandshakeError, parseHello, refusal, type HubCrypto, type HubRefusalKey } from '../shared/hub-session';
import type { HubDevice, HubDevices } from './hub-devices';

export interface HubCaller {
  readonly device: HubDevice;
  readonly connectionId: string;
}

export interface HubServerDeps {
  readonly devices: HubDevices;
  readonly crypto: HubCrypto;
  readonly version: string;
  readonly webRoot: string | null;
  hubName(): string;
  call(caller: HubCaller, api: HubApiKey, method: string, params: unknown): Promise<unknown>;
  wants(connectionId: string, api: HubApiKey, event: string, data: unknown): boolean;
  closed(connectionId: string): void;
  journal(message: string): void;
  now?: () => number;
}

interface Connection {
  readonly id: string;
  readonly socket: WebSocket;
  readonly channel: HubChannel;
  readonly address: string;
  readonly pending: Map<string, HubEventMessage>;
  device: HubDevice;
  inFlight: number;
  isAlive: boolean;
}

const MAX_HELLO = 2_048;
const MAX_FRAME = 1024 * 1024;
const MAX_IN_FLIGHT = 64;
const FLUSH_MS = 250;
const HEARTBEAT_MS = 30_000;
const HANDSHAKE_MS = 10_000;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60_000;
const BACKLOG_BYTES = 1024 * 1024;

const contentTypes: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.wasm': 'application/wasm',
};

// Ticks, positions, bars and guard state change many times a second; a phone only needs the
// latest of each, so they wait in a map for the next flush. Other events go out in order.
function coalesceKey(api: HubApiKey, event: string, data: unknown): string | null {
  const value = data as { symbol?: string; timeframe?: string; bar?: { time?: number } } | null;
  if (api === 'terminal' && event === 'tick') return `tick:${value?.symbol}`;
  if (api === 'terminal' && event === 'trade') return 'trade';
  if (api === 'terminal' && event === 'bar') return `bar:${value?.symbol}:${value?.timeframe}:${value?.bar?.time}`;
  if (api === 'automation' && event === 'manager') return 'manager';
  return null;
}

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
// Tailscale and other overlay networks hand out carrier-grade NAT addresses.
const isOverlay = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

// Container and virtual machine bridges are reachable only from this computer.
const isVirtual = (name: string) => /^(docker|br-|veth|virbr|vmnet|vboxnet|podman|cni|flannel|lxc|lxd)/.test(name);

export function lanAddresses(port: number, interfaces = os.networkInterfaces()): string[] {
  const ips = Object.entries(interfaces).filter(([name]) => !isVirtual(name)).flatMap(([, items]) => items ?? []).filter((item) => item.family === 'IPv4' && !item.internal).map((item) => item.address);
  const rank = (ip: string) => isPrivate(ip) ? 0 : isOverlay(ip) ? 1 : 2;
  return [...new Set(ips)].sort((left, right) => rank(left) - rank(right)).map((ip) => `${ip}:${port}`);
}

export class HubServer extends EventEmitter {
  private server?: http.Server;
  private sockets?: WebSocketServer;
  private heartbeat?: NodeJS.Timeout;
  private flusher?: NodeJS.Timeout;
  private error?: string;
  private port = 0;
  private readonly connections = new Map<string, Connection>();
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly deps: HubServerDeps) {
    super();
  }

  private now(): number { return (this.deps.now ?? Date.now)(); }

  get isRunning(): boolean { return !!this.server?.listening; }
  get lastError(): string | undefined { return this.error; }

  get boundPort(): number {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : this.port;
  }

  // Device id to address, for the devices list.
  connectedDevices(): ReadonlyMap<string, string> {
    return new Map([...this.connections.values()].map((connection) => [connection.device.id, connection.address]));
  }

  async apply(settings: HubSettings): Promise<void> {
    if (settings.isEnabled && this.isRunning && settings.port === this.port) return;
    await this.stop();
    this.port = settings.port;
    if (settings.isEnabled) await this.start();
  }

  async stop(): Promise<void> {
    clearInterval(this.heartbeat);
    clearInterval(this.flusher);
    for (const connection of this.connections.values()) connection.socket.terminate();
    this.connections.clear();
    this.sockets?.close();
    this.sockets = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  broadcast(api: HubApiKey, event: string, data: unknown): void {
    const key = coalesceKey(api, event, data);
    const message: HubEventMessage = { kind: 'event', api, event, data };
    for (const connection of this.connections.values()) {
      if (!this.deps.wants(connection.id, api, event, data)) continue;
      if (key) connection.pending.set(key, message);
      else {
        this.flush(connection);
        void connection.channel.send(message).catch(() => undefined);
      }
    }
  }

  // A revoked device loses its connection at once.
  drop(deviceId: string): void {
    for (const connection of this.connections.values()) if (connection.device.id === deviceId) connection.socket.close(4003, 'Unpaired');
  }

  // A changed scope holds from the next request; closing makes the phone reconnect and learn it.
  refresh(device: HubDevice): void {
    for (const connection of this.connections.values()) {
      if (connection.device.id !== device.id) continue;
      connection.device = device;
      connection.socket.close(4004, 'Access changed');
    }
  }

  private start(): Promise<void> {
    this.error = undefined;
    const server = http.createServer((request, response) => void this.serve(request, response));
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
    server.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '/', 'http://hub').pathname !== '/hub') return socket.destroy();
      sockets.handleUpgrade(request, socket, head, (ws) => void this.accept(ws, request.socket.remoteAddress ?? 'unknown'));
    });
    this.server = server;
    this.sockets = sockets;
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.flusher = setInterval(() => { for (const connection of this.connections.values()) this.flush(connection); }, FLUSH_MS);
    return new Promise((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.error = error.code === 'EADDRINUSE' ? `Port ${this.port} is already in use` : error.message;
        void this.stop().then(resolve);
      });
      server.listen(this.port, '0.0.0.0', () => resolve());
    });
  }

  private beat(): void {
    for (const connection of this.connections.values()) {
      if (!connection.isAlive) {
        connection.socket.terminate();
        continue;
      }
      connection.isAlive = false;
      connection.socket.ping();
    }
  }

  private flush(connection: Connection): void {
    if (!connection.pending.size || connection.socket.bufferedAmount > BACKLOG_BYTES) return;
    const messages = [...connection.pending.values()];
    connection.pending.clear();
    for (const message of messages) void connection.channel.send(message).catch(() => undefined);
  }

  private isLocked(address: string): boolean {
    const recent = (this.failures.get(address) ?? []).filter((time) => this.now() - time < FAILURE_WINDOW_MS);
    this.failures.set(address, recent);
    return recent.length >= MAX_FAILURES;
  }

  private fail(address: string): void {
    this.failures.set(address, [...(this.failures.get(address) ?? []), this.now()]);
  }

  private async accept(socket: WebSocket, address: string): Promise<void> {
    const refuse = (reason: HubRefusalKey) => {
      socket.send(refusal(reason));
      socket.close(4001, reason);
    };
    if (this.isLocked(address)) return refuse('locked');
    const deadline = setTimeout(() => socket.terminate(), HANDSHAKE_MS);
    socket.on('close', () => clearTimeout(deadline));
    const inbox = new Inbox(socket);
    const helloText = await inbox.next();
    if (typeof helloText !== 'string' || helloText.length > MAX_HELLO) return void socket.terminate();
    let hello;
    try { hello = parseHello(helloText); }
    catch (error) {
      if (error instanceof HubHandshakeError && error.reason === 'version') return refuse('version');
      this.fail(address);
      return void socket.terminate();
    }
    const { devices, crypto } = this.deps;
    const offer = hello.isPairing ? devices.activeOffer() : null;
    let known: HubDevice | undefined;
    if (hello.isPairing && !offer) {
      this.fail(address);
      return refuse('expired');
    }
    if (!hello.isPairing) {
      try { known = devices.find(new Uint8Array(Buffer.from(hello.device, 'base64url'))); }
      catch { known = undefined; }
      if (!known) {
        this.fail(address);
        return refuse('unknown');
      }
    }
    let accepted;
    try { accepted = await acceptDevice(crypto, devices.keyPair, helloText, offer?.token ?? null); }
    catch (error) {
      if (!(error instanceof HubHandshakeError)) this.deps.journal(`A phone could not connect: ${(error as Error).message}`);
      this.fail(address);
      return void socket.terminate();
    }
    const channel = new HubChannel(crypto, accepted.keys, (frame) => socket.send(frame));
    socket.send(accepted.reply);
    const first = await inbox.next();
    let name = '';
    try {
      if (!(first instanceof Uint8Array)) throw new Error('Expected an encrypted frame');
      const auth = await channel.receive(first) as { kind?: unknown; name?: unknown };
      if (auth?.kind !== 'auth') throw new Error('Expected auth');
      name = typeof auth.name === 'string' ? auth.name : '';
    } catch {
      if (hello.isPairing) devices.failOffer();
      this.fail(address);
      return void socket.close(4001, 'Handshake failed');
    }
    clearTimeout(deadline);
    let device: HubDevice;
    try {
      if (hello.isPairing) {
        device = await devices.pair(accepted.deviceKey, name);
        this.deps.journal(`Paired ${device.name} (${device.scope === 'trade' ? 'charts and trading' : 'charts only'}).`);
      } else {
        device = known!;
        await devices.touch(device.id);
      }
    } catch (error) {
      this.deps.journal(`A phone could not be paired: ${(error as Error).message}`);
      return void socket.close(4001, 'Pairing failed');
    }
    for (const other of this.connections.values()) if (other.device.id === device.id) other.socket.close(4002, 'Replaced by a newer connection');
    const connection: Connection = { id: randomUUID(), socket, channel, address, device, pending: new Map(), inFlight: 0, isAlive: true };
    this.connections.set(connection.id, connection);
    socket.on('pong', () => { connection.isAlive = true; });
    inbox.drain((message) => {
      if (!(message instanceof Uint8Array)) return socket.close(4000, 'Expected encrypted frames');
      void this.receive(connection, message);
    });
    socket.on('close', () => {
      this.connections.delete(connection.id);
      this.deps.closed(connection.id);
      this.emit('change');
    });
    const ready: HubReady = { kind: 'ready', hub: { name: this.deps.hubName(), version: this.deps.version }, device: deviceInfo(device) };
    await channel.send(ready);
    this.emit('change');
  }

  private async receive(connection: Connection, frame: Uint8Array): Promise<void> {
    let message: { kind?: unknown; id?: unknown; api?: unknown; method?: unknown; params?: unknown };
    try { message = await connection.channel.receive(frame) as typeof message; }
    catch { return void connection.socket.close(4001, 'Unreadable frame'); }
    if (message?.kind !== 'request' || !Number.isSafeInteger(message.id) || typeof message.api !== 'string' || typeof message.method !== 'string') return void connection.socket.close(4000, 'Malformed request');
    const id = message.id as number;
    const reply = (body: { result: unknown } | { error: string }) => connection.channel.send({ id, kind: 'reply', ...body } as HubReply).catch(() => undefined);
    const device = this.deps.devices.get(connection.device.id);
    if (!device) return void connection.socket.close(4003, 'Unpaired');
    connection.device = device;
    const required = hubMethodScope(message.api, message.method);
    if (!required) return void reply({ error: `${message.method} is not available from a phone.` });
    if (!canUseScope(device.scope, required)) return void reply({ error: 'This device can only view charts. Allow trading for it in Mobile devices on the computer.' });
    if (connection.inFlight >= MAX_IN_FLIGHT) return void reply({ error: 'Too many requests at once' });
    connection.inFlight++;
    try { await reply({ result: await this.deps.call({ device, connectionId: connection.id }, message.api as HubApiKey, message.method, message.params ?? {}) }); }
    catch (error) { await reply({ error: (error as Error).message }); }
    finally { connection.inFlight--; }
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, body: string | Buffer, type = 'text/plain; charset=utf-8', headers: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
      response.end(body);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, 'Method not allowed');
    const root = this.deps.webRoot;
    if (!root) return send(503, 'The phone app is not part of this build. Run npm run build.');
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://hub').pathname); }
    catch { return send(400, 'Bad URL'); }
    const isPage = pathname === '/' || pathname === '/mobile.html';
    const file = path.resolve(root, isPage ? 'mobile.html' : `.${pathname}`);
    if (!isPage && !file.startsWith(path.join(path.resolve(root), 'assets') + path.sep)) return send(404, 'Not found');
    let body: Buffer;
    try { body = await fs.readFile(file); }
    catch { return send(isPage ? 503 : 404, isPage ? 'The phone app is not built yet. Run npm run build.' : 'Not found'); }
    const host = /^[\w.\-:[\]]{1,100}$/.test(request.headers.host ?? '') ? request.headers.host! : `localhost:${this.boundPort}`;
    const headers: Record<string, string> = isPage
      ? { 'cache-control': 'no-store', 'content-security-policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://${host}; worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` }
      : { 'cache-control': 'public, max-age=31536000, immutable' };
    send(200, body, contentTypes[path.extname(file)] ?? 'application/octet-stream', headers);
  }
}

const deviceInfo = (device: HubDevice): HubDeviceInfo => ({ id: device.id, name: device.name, scope: device.scope });

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

// Holds the socket's messages from the first one on, so frames a phone sends while the handshake is
// still being checked are neither lost nor taken out of order (which would break the nonces).
class Inbox {
  private readonly queue: (string | Uint8Array)[] = [];
  private waiter?: (message: string | Uint8Array | null) => void;
  private handler?: (message: string | Uint8Array) => void;
  private isClosed = false;

  constructor(socket: WebSocket) {
    socket.on('message', (data, isBinary) => {
      const bytes = toBytes(data);
      const message = isBinary ? bytes : bytes.length <= MAX_HELLO ? Buffer.from(bytes).toString('utf8') : '';
      if (this.handler) this.handler(message);
      else if (this.waiter) this.take()(message);
      else this.queue.push(message);
    });
    socket.on('close', () => {
      this.isClosed = true;
      this.waiter && this.take()(null);
    });
  }

  next(): Promise<string | Uint8Array | null> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.isClosed) return Promise.resolve(null);
    return new Promise((resolve) => { this.waiter = resolve; });
  }

  drain(handler: (message: string | Uint8Array) => void): void {
    this.handler = handler;
    for (const message of this.queue.splice(0)) handler(message);
  }

  private take(): (message: string | Uint8Array | null) => void {
    const waiter = this.waiter!;
    this.waiter = undefined;
    return waiter;
  }
}
