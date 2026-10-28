import { EventEmitter } from 'node:events';
import { openWebSocket, type OpenSocket, type StreamSocket } from './bybit-stream';

export const HYPERLIQUID_STREAM = 'wss://api.hyperliquid.xyz/ws';

export interface Subscription {
  coin: string;
  type: 'candle' | 'bbo';
  interval?: string;
}

export interface StreamMessage {
  data?: unknown;
  channel?: string;
}

// A thin market can go quiet for minutes; pings keep the socket from looking idle.
const PING_INTERVAL = 50_000;
const MAX_BACKOFF = 30_000;

const keyOf = (subscription: Subscription) => [subscription.type, subscription.coin, subscription.interval ?? ''].join('|');

// Emits 'open' after every (re)connection has resubscribed, 'data' for channel messages,
// 'closed' on loss and 'journal' for subscriptions Hyperliquid refused.
export class HyperliquidStream extends EventEmitter {
  private retry?: NodeJS.Timeout;
  private pinger?: NodeJS.Timeout;
  private socket?: StreamSocket;
  private backoff = 500;
  private isOpen = false;
  private isStopped = true;
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(
    readonly url = HYPERLIQUID_STREAM,
    private readonly openSocket: OpenSocket = openWebSocket,
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

  // Subscribes to exactly these, sending only the difference from what is already subscribed.
  sync(wanted: readonly Subscription[]): void {
    const next = new Map(wanted.map((subscription) => [keyOf(subscription), subscription]));
    for (const [key, subscription] of this.subscriptions) {
      if (next.has(key)) continue;
      this.subscriptions.delete(key);
      this.send('unsubscribe', subscription);
    }
    for (const [key, subscription] of next) {
      if (this.subscriptions.has(key)) continue;
      this.subscriptions.set(key, subscription);
      this.send('subscribe', subscription);
    }
  }

  private send(method: 'subscribe' | 'unsubscribe', subscription: Subscription): void {
    if (this.isOpen) this.socket?.send(JSON.stringify({ method, subscription }));
  }

  private connect(): void {
    let socket: StreamSocket;
    try { socket = this.openSocket(this.url); }
    catch (error) { this.lost(error as Error); return; }
    this.socket = socket;
    socket.on('open', () => { if (this.socket === socket) this.opened(); });
    socket.on('message', (raw) => {
      if (this.socket !== socket) return;
      let message: StreamMessage;
      try { message = JSON.parse(String(raw)) as StreamMessage; }
      catch { return; }
      if (message.channel === 'error') this.emit('journal', `Hyperliquid refused a request: ${String(message.data)}`);
      else if (message.channel && message.channel !== 'pong' && message.channel !== 'subscriptionResponse') this.emit('data', message);
    });
    socket.on('close', () => { if (this.socket === socket) this.lost(); });
    socket.on('error', (error) => { if (this.socket === socket) this.lost(error); });
  }

  private opened(): void {
    this.isOpen = true;
    this.backoff = 500;
    for (const subscription of this.subscriptions.values()) this.send('subscribe', subscription);
    clearInterval(this.pinger);
    this.pinger = setInterval(() => this.socket?.send(JSON.stringify({ method: 'ping' })), PING_INTERVAL);
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
