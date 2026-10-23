import { createHmac } from 'node:crypto';
import { queryString, type Fetch, type Query } from './exchange-common';

export interface BybitKey {
  readonly apiKey: string;
  readonly apiSecret: string;
}

interface Envelope<T> {
  time?: number;
  retMsg: string;
  result: T;
  retCode: number;
}

const RECV_WINDOW = 5000;
const TIMEOUT = 10_000;
const TIMESTAMP_REJECTED = 10002;

export class BybitApiError extends Error {
  constructor(message: string, readonly code: number) { super(message); }
}

export const signature = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('hex');

const messages: Record<number, string> = {
  10003: 'Bybit does not recognise this API key. Check it was created for the chosen environment (live, demo trading or testnet).',
  10004: 'Bybit rejected the request signature. Check the API secret.',
  10005: 'This API key lacks the permission for this action.',
  10006: 'Bybit rate limit reached. Wait a moment and try again.',
  10010: 'This API key is bound to other IP addresses.',
  110003: 'Bybit refused the price: it is outside the range Bybit accepts around the market price (110003).',
  33004: 'This API key has expired. Create a new one on Bybit.',
};

export class BybitRest {
  private clockOffset = 0;

  constructor(
    readonly baseUrl: string,
    private readonly key?: BybitKey,
    private readonly fetch: Fetch = (url, init) => globalThis.fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {}

  get hasKey(): boolean { return !!this.key; }

  async syncClock(): Promise<void> {
    const sent = this.now();
    const envelope = await this.send<{ timeNano: string }>(`${this.baseUrl}/v5/market/time`, { method: 'GET' });
    const received = this.now();
    const server = Number(BigInt(envelope.result.timeNano) / 1_000_000n);
    this.clockOffset = server - Math.round((sent + received) / 2);
  }

  async get<T>(path: string, query: Query = {}, isSigned = false): Promise<T> {
    const search = queryString(query);
    const url = `${this.baseUrl}${path}${search ? `?${search}` : ''}`;
    try {
      return (await this.send<T>(url, { method: 'GET', headers: isSigned ? this.headers(search) : {} })).result;
    } catch (error) {
      if (!(error instanceof BybitApiError) || error.code !== TIMESTAMP_REJECTED || !isSigned) throw error;
      await this.syncClock();
      return (await this.send<T>(url, { method: 'GET', headers: this.headers(search) })).result;
    }
  }

  // Writes are never retried: after a lost response Bybit may already have acted on them.
  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const json = JSON.stringify(body);
    return (await this.send<T>(`${this.baseUrl}${path}`, { method: 'POST', body: json, headers: { ...this.headers(json), 'Content-Type': 'application/json' } })).result;
  }

  realtimeAuth(): [string, number, string] {
    if (!this.key) throw new Error('A Bybit API key is required');
    const expires = this.now() + this.clockOffset + 10_000;
    return [this.key.apiKey, expires, signature(this.key.apiSecret, `GET/realtime${expires}`)];
  }

  private headers(payload: string): Record<string, string> {
    if (!this.key) throw new Error('A Bybit API key is required');
    const timestamp = String(this.now() + this.clockOffset);
    return {
      'X-BAPI-API-KEY': this.key.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': String(RECV_WINDOW),
      'X-BAPI-SIGN': signature(this.key.apiSecret, `${timestamp}${this.key.apiKey}${RECV_WINDOW}${payload}`),
    };
  }

  private async send<T>(url: string, init: RequestInit): Promise<Envelope<T>> {
    let response: Response;
    try { response = await this.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) }); }
    catch (error) { throw new Error(`Bybit could not be reached: ${(error as Error).message}`); }
    if (response.status === 403) throw new BybitApiError('Bybit refused this connection (HTTP 403). Bybit blocks some countries, and too many requests ban the IP for 10 minutes.', 403);
    if (response.status === 401) throw new BybitApiError('Bybit rejected the API key (HTTP 401).', 401);
    const text = await response.text();
    let envelope: Envelope<T>;
    try { envelope = JSON.parse(text) as Envelope<T>; }
    catch { throw new BybitApiError(`Bybit answered HTTP ${response.status} without JSON.`, response.status); }
    if (envelope.retCode !== 0) throw new BybitApiError(messages[envelope.retCode] ?? `Bybit: ${envelope.retMsg || 'request failed'} (${envelope.retCode})`, envelope.retCode);
    return envelope;
  }
}
