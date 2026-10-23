import { createHmac, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { queryString, type Fetch, type Query } from './exchange-common';

export interface BinanceKey {
  readonly apiKey: string;
  readonly apiSecret: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

const RECV_WINDOW = 5000;
const TIMEOUT = 10_000;
const TIMESTAMP_REJECTED = -1021;

export class BinanceApiError extends Error {
  constructor(message: string, readonly code: number) { super(message); }
}

// A single-line field turns a pasted PEM's line breaks into spaces, which OpenSSL cannot read, so
// the block is rebuilt from its markers and base64 body.
export function normalisePem(text: string): string {
  const match = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!match) return text;
  const body = match[2].replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
  return [`-----BEGIN ${match[1]}-----`, ...body, `-----END ${match[1]}-----`, ''].join('\n');
}

// A secret pasted as a PEM block is a self-generated Ed25519 key; anything else is an HMAC secret.
export function signer(secret: string): (payload: string) => string {
  if (!secret.includes('-----BEGIN')) return (payload) => createHmac('sha256', secret).update(payload).digest('hex');
  let key: KeyObject;
  try { key = createPrivateKey(normalisePem(secret)); }
  catch { throw new Error('The private key could not be read. Paste the whole PEM block, including its BEGIN and END lines.'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Binance private keys must be Ed25519. Paste the API secret for an HMAC key instead.');
  return (payload) => sign(null, Buffer.from(payload), key).toString('base64');
}

const messages: Record<number, string> = {
  [-1003]: 'Binance rate limit reached. Wait a moment and try again.',
  [-1022]: 'Binance rejected the request signature. Check the API secret or private key.',
  [-2014]: 'Binance does not recognise this API key. Check it was created for the chosen environment (live or demo trading).',
  [-2015]: 'Binance refused this API key: it is unknown, bound to other IP addresses, or lacks the Futures permission.',
  [-2019]: 'Not enough margin on Binance for this order.',
  [-2021]: 'The trigger price has already been passed, so Binance would trigger the order at once.',
  [-4131]: 'Binance refused the price: it is outside the range Binance accepts around the market price (-4131).',
  [-4164]: 'The order is below the Binance minimum order value for this contract.',
};

export class BinanceRest {
  private clockOffset = 0;
  private readonly sign?: (payload: string) => string;

  constructor(
    readonly baseUrl: string,
    private readonly key?: BinanceKey,
    private readonly fetch: Fetch = (url, init) => globalThis.fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {
    if (key) this.sign = signer(key.apiSecret);
  }

  // The same key and clock against another Binance API, such as spot for the key's permissions.
  at(baseUrl: string): BinanceRest {
    const rest = new BinanceRest(baseUrl, this.key, this.fetch, this.now);
    rest.clockOffset = this.clockOffset;
    return rest;
  }

  async syncClock(): Promise<void> {
    const sent = this.now();
    const { serverTime } = await this.send<{ serverTime: number }>('GET', `${this.baseUrl}/fapi/v1/time`, {});
    const received = this.now();
    this.clockOffset = serverTime - Math.round((sent + received) / 2);
  }

  get<T>(path: string, query: Query = {}, isSigned = false): Promise<T> { return this.call('GET', path, query, isSigned, true); }

  // Writes are never retried: after a lost response Binance may already have acted on them.
  post<T>(path: string, query: Query = {}): Promise<T> { return this.call('POST', path, query, true, false); }

  put<T>(path: string, query: Query = {}): Promise<T> { return this.call('PUT', path, query, true, false); }

  delete<T>(path: string, query: Query = {}): Promise<T> { return this.call('DELETE', path, query, true, false); }

  // The listen key routes take the API key header but no signature.
  keyed<T>(method: Method, path: string): Promise<T> {
    return this.send<T>(method, `${this.baseUrl}${path}`, this.headers());
  }

  private async call<T>(method: Method, path: string, query: Query, isSigned: boolean, isRetried: boolean): Promise<T> {
    const attempt = () => {
      const search = isSigned ? this.signed(query) : queryString(query);
      return this.send<T>(method, `${this.baseUrl}${path}${search ? `?${search}` : ''}`, isSigned ? this.headers() : {});
    };
    try { return await attempt(); }
    catch (error) {
      if (!(error instanceof BinanceApiError) || error.code !== TIMESTAMP_REJECTED || !isSigned || !isRetried) throw error;
      await this.syncClock();
      return attempt();
    }
  }

  // Everything goes in the query string, so the signed payload is exactly what is sent.
  private signed(query: Query): string {
    if (!this.sign) throw new Error('A Binance API key is required');
    const payload = queryString({ ...query, recvWindow: RECV_WINDOW, timestamp: this.now() + this.clockOffset });
    return `${payload}&signature=${encodeURIComponent(this.sign(payload))}`;
  }

  private headers(): Record<string, string> {
    if (!this.key) throw new Error('A Binance API key is required');
    return { 'X-MBX-APIKEY': this.key.apiKey };
  }

  private async send<T>(method: Method, url: string, headers: Record<string, string>): Promise<T> {
    let response: Response;
    try { response = await this.fetch(url, { method, headers, signal: AbortSignal.timeout(TIMEOUT) }); }
    catch (error) { throw new Error(`Binance could not be reached: ${(error as Error).message}`); }
    if (response.status === 418 || response.status === 429) throw new BinanceApiError(`Binance rate limit reached (HTTP ${response.status}). Wait a few minutes before trying again.`, -1003);
    // Binance documents an HTTP 503 without its throttling code as an unknown outcome.
    if (response.status === 503 && !(await response.clone().text()).includes('-1008')) throw new Error('Binance did not say whether the request was carried out (HTTP 503).');
    if (response.status === 403) throw new BinanceApiError('Binance refused this connection (HTTP 403). Binance blocks some countries and networks.', 403);
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { throw new BinanceApiError(`Binance answered HTTP ${response.status} without JSON.`, response.status); }
    const failure = body as { code?: number; msg?: string } | null;
    if (!response.ok || typeof failure?.code === 'number' && failure.code < 0) {
      const code = typeof failure?.code === 'number' ? failure.code : response.status;
      throw new BinanceApiError(messages[code] ?? `Binance: ${failure?.msg || `HTTP ${response.status}`} (${code})`, code);
    }
    return body as T;
  }
}
