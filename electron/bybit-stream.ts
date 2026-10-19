import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export interface StreamSocket {
  send(data: string): void;
  close(): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: unknown) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

export type OpenSocket = (url: string) => StreamSocket;

export interface StreamMessage {
  op?: string;
  topic?: string;
  type?: string;
  ret_msg?: string;
  success?: boolean;
  data?: unknown;
  ts?: number;
}

export const openWebSocket: OpenSocket = (url) => new WebSocket(url, { handshakeTimeout: 10_000 });

const PING_INTERVAL = 20_000;
const MAX_BACKOFF = 30_000;
const TOPICS_PER_REQUEST = 10;

// Emits 'open' after every (re)connection is authenticated and subscribed, so owners can
// re-read state that changed while it was down; 'data' for topic messages; 'closed' on loss;
// 'failed' when authentication is refused, which stops reconnecting.
export class BybitStream extends EventEmitter {
  private socket?: StreamSocket;
  private pinger?: NodeJS.Timeout;
  private retry?: NodeJS.Timeout;
  private backoff = 500;
  private isOpen = false;
  private isStopped = true;
  private readonly topics = new Set<string>();

  constructor(
    readonly url: string,
    private readonly openSocket: OpenSocket = openWebSocket,
    private readonly auth?: () => [string, number, string],
  ) { super(); }

  get connected(): boolean { return this.isOpen; }

  start(): void {
    if (!this.isStopped) return;
    this.isStopped = false;
    this.connect();
  }

  stop(): void {
    this.isStopped = true;
    this.isOpen = false;
    clearTimeout(this.retry);
    this.teardown();
  }

  // Resolves once the stream is open, or rejects when it fails or the wait runs out.
  ready(timeout = 15_000): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = (error?: Error) => {
        clearTimeout(timer);
        this.off('open', onOpen);
        this.off('failed', onFailed);
        if (error) reject(error); else resolve();
      };
      const onOpen = () => done();
      const onFailed = (error: Error) => done(error);
      const timer = setTimeout(() => done(new Error(`Bybit stream ${this.url} did not open in time`)), timeout);
      this.on('open', onOpen);
      this.on('failed', onFailed);
    });
  }

  subscribe(topics: readonly string[]): void {
    const added = topics.filter((topic) => !this.topics.has(topic));
    for (const topic of added) this.topics.add(topic);
    if (this.isOpen) this.request('subscribe', added);
  }

  unsubscribe(topics: readonly string[]): void {
    const removed = topics.filter((topic) => this.topics.delete(topic));
    if (this.isOpen) this.request('unsubscribe', removed);
  }

  private request(op: 'subscribe' | 'unsubscribe', topics: readonly string[]): void {
    for (let index = 0; index < topics.length; index += TOPICS_PER_REQUEST) {
      this.socket?.send(JSON.stringify({ op, args: topics.slice(index, index + TOPICS_PER_REQUEST) }));
    }
  }

  private connect(): void {
    let socket: StreamSocket;
    try { socket = this.openSocket(this.url); }
    catch (error) { this.lost(error as Error); return; }
    this.socket = socket;
    socket.on('open', () => {
      if (this.socket !== socket) return;
      if (this.auth) socket.send(JSON.stringify({ op: 'auth', args: this.auth() }));
      else this.opened();
    });
    socket.on('message', (raw) => {
      if (this.socket !== socket) return;
      let message: StreamMessage;
      try { message = JSON.parse(String(raw)) as StreamMessage; }
      catch { return; }
      if (message.op === 'auth') {
        if (message.success) this.opened();
        else {
          this.isStopped = true;
          this.teardown();
          this.emit('failed', new Error(`Bybit refused the stream login: ${message.ret_msg || 'unknown reason'}`));
        }
      } else if (message.op === 'subscribe' && message.success === false) {
        this.emit('journal', `Bybit refused a subscription: ${message.ret_msg ?? ''}`);
      } else if (message.topic) this.emit('data', message);
    });
    socket.on('close', () => { if (this.socket === socket) this.lost(); });
    socket.on('error', (error) => { if (this.socket === socket) this.lost(error); });
  }

  private opened(): void {
    this.isOpen = true;
    this.backoff = 500;
    this.request('subscribe', [...this.topics]);
    clearInterval(this.pinger);
    this.pinger = setInterval(() => this.socket?.send(JSON.stringify({ op: 'ping' })), PING_INTERVAL);
    this.emit('open');
  }

  private lost(error?: Error): void {
    const wasOpen = this.isOpen;
    this.isOpen = false;
    this.teardown();
    if (wasOpen || error) this.emit('closed', error);
    if (this.isStopped) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2);
  }

  private teardown(): void {
    clearInterval(this.pinger);
    const socket = this.socket;
    this.socket = undefined;
    try { socket?.close(); } catch { /* already closed */ }
  }
}
