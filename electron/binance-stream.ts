import { EventEmitter } from 'node:events';
import { openWebSocket, type OpenSocket, type StreamSocket } from './bybit-stream';

export interface BinanceMessage {
  stream?: string;
  data?: Record<string, unknown>;
  e?: string;
  [field: string]: unknown;
}

const MAX_BACKOFF = 30_000;
const STREAMS_PER_REQUEST = 50;
// Binance closes connections that send more than ten messages a second.
const REQUEST_GAP = 250;

// One Binance WebSocket. The address is asked for on every connection, so a user data stream
// can fetch a fresh listen key. Emits 'open' after every (re)connection, 'data' for each event
// (unwrapped from combined streams), 'closed' on loss, and 'failed' when the address cannot be
// had before the first connection; later it keeps retrying.
export class BinanceStream extends EventEmitter {
  private socket?: StreamSocket;
  private retry?: NodeJS.Timeout;
  private sender?: NodeJS.Timeout;
  private backoff = 500;
  private requestId = 0;
  private isOpen = false;
  private hasOpened = false;
  private isStopped = true;
  private readonly queue: string[] = [];
  private readonly streams = new Set<string>();

  constructor(
    private readonly address: () => string | Promise<string>,
    private readonly openSocket: OpenSocket = openWebSocket,
  ) { super(); }

  get connected(): boolean { return this.isOpen; }

  start(): void {
    if (!this.isStopped) return;
    this.isStopped = false;
    void this.connect();
  }

  stop(): void {
    this.isStopped = true;
    this.isOpen = false;
    clearTimeout(this.retry);
    this.teardown();
  }

  // Drops the connection and opens another, as when Binance expires a listen key.
  restart(): void {
    if (this.isStopped) return;
    this.lost();
  }

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
      const timer = setTimeout(() => done(new Error('The Binance stream did not open in time')), timeout);
      this.on('open', onOpen);
      this.on('failed', onFailed);
    });
  }

  subscribe(streams: readonly string[]): void {
    const added = streams.filter((stream) => !this.streams.has(stream));
    for (const stream of added) this.streams.add(stream);
    if (this.isOpen) this.request('SUBSCRIBE', added);
  }

  unsubscribe(streams: readonly string[]): void {
    const removed = streams.filter((stream) => this.streams.delete(stream));
    if (this.isOpen) this.request('UNSUBSCRIBE', removed);
  }

  private request(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', streams: readonly string[]): void {
    for (let index = 0; index < streams.length; index += STREAMS_PER_REQUEST) {
      this.queue.push(JSON.stringify({ method, params: streams.slice(index, index + STREAMS_PER_REQUEST), id: ++this.requestId }));
    }
    this.drain();
  }

  private drain(): void {
    if (this.sender || !this.queue.length) return;
    this.socket?.send(this.queue.shift()!);
    this.sender = setTimeout(() => { this.sender = undefined; this.drain(); }, REQUEST_GAP);
  }

  private async connect(): Promise<void> {
    let url: string;
    try { url = await this.address(); }
    catch (error) {
      if (this.isStopped) return;
      if (!this.hasOpened) this.emit('failed', error as Error);
      this.lost(error as Error);
      return;
    }
    if (this.isStopped) return;
    let socket: StreamSocket;
    try { socket = this.openSocket(url); }
    catch (error) { this.lost(error as Error); return; }
    this.socket = socket;
    socket.on('open', () => { if (this.socket === socket) this.opened(); });
    socket.on('message', (raw) => {
      if (this.socket !== socket) return;
      let message: BinanceMessage;
      try { message = JSON.parse(String(raw)) as BinanceMessage; }
      catch { return; }
      if (typeof message.code === 'number' || message.error) this.emit('journal', `Binance refused a stream request: ${JSON.stringify(message.error ?? message)}`);
      else if (message.stream && message.data) this.emit('data', message.data, message.stream);
      else if (message.e) this.emit('data', message, undefined);
    });
    socket.on('close', () => { if (this.socket === socket) this.lost(); });
    socket.on('error', (error) => { if (this.socket === socket) this.lost(error); });
  }

  private opened(): void {
    this.isOpen = true;
    this.hasOpened = true;
    this.backoff = 500;
    this.queue.length = 0;
    this.request('SUBSCRIBE', [...this.streams]);
    this.emit('open');
  }

  private lost(error?: Error): void {
    const wasOpen = this.isOpen;
    this.isOpen = false;
    this.teardown();
    if (wasOpen || error) this.emit('closed', error);
    if (this.isStopped) return;
    clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.connect(), this.backoff);
    this.backoff = Math.min(MAX_BACKOFF, this.backoff * 2);
  }

  private teardown(): void {
    clearTimeout(this.sender);
    this.sender = undefined;
    const socket = this.socket;
    this.socket = undefined;
    try { socket?.close(); } catch { /* already closed */ }
  }
}
