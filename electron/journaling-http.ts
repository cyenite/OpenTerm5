import { createHmac } from 'node:crypto';

export interface ApiCredentials {
  readonly key: string;
  readonly secret: string;
}

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiReply<T> {
  readonly data: T;
  readonly etag: string | null;
}

export interface ApiRequest {
  readonly path: string;
  readonly body?: unknown;
  readonly etag?: string | null;
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  // Connect endpoints are public: they carry no key and are not signed.
  readonly isPublic?: boolean;
}

const TIMEOUT_MS = 30_000;

export class JournalingApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly upgradeUrl: string | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }

  get isAuthLost(): boolean { return this.status === 401 && this.code !== 'stale_signature'; }
}

// Tradescribe's signed-request scheme: HMAC-SHA256 over `<timestamp>.<raw body>`, keyed with the
// secret, so the secret itself never travels.
export function signRequest(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function errorMessage(status: number, code: string, message: string | undefined): string {
  if (code === 'stale_signature') return 'This computer\'s clock is more than 5 minutes off. Correct the system time and try again.';
  if (message) return message;
  return `The journaling platform answered HTTP ${status}.`;
}

export class JournalingClient {
  constructor(
    private readonly platform: string,
    private readonly credentials: () => ApiCredentials | null,
    private readonly fetch: Fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async request<T>(request: ApiRequest): Promise<ApiReply<T>> {
    const method = request.method ?? 'GET';
    const url = new URL(`/api/v1${request.path}`, this.platform);
    for (const [name, value] of Object.entries(request.query ?? {})) if (value !== undefined) url.searchParams.set(name, String(value));
    const body = request.body === undefined ? '' : JSON.stringify(request.body);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (request.etag) headers['if-match'] = request.etag;
    if (!request.isPublic) {
      const credentials = this.credentials();
      if (!credentials) throw new JournalingApiError(401, 'missing_credentials', 'Journaling is not connected.');
      const timestamp = Math.floor(this.now() / 1000).toString();
      headers['x-tradescribe-key'] = credentials.key;
      headers['x-tradescribe-timestamp'] = timestamp;
      headers['x-tradescribe-signature'] = signRequest(credentials.secret, timestamp, body);
    }
    let response: Response;
    try {
      response = await this.fetch(url.toString(), { method, headers, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS), ...(body ? { body } : {}) });
    } catch (error) {
      throw new JournalingApiError(0, 'network', `The journaling platform could not be reached: ${(error as Error).message}`);
    }
    const text = await response.text();
    let json: { data?: T; error?: { code?: string; message?: string; upgradeUrl?: string } } = {};
    try { json = text ? JSON.parse(text) : {}; }
    catch {
      if (response.ok) throw new JournalingApiError(response.status, 'invalid_response', 'The journaling platform sent a reply OpenTerm5 could not read.');
    }
    if (!response.ok) {
      const code = json.error?.code ?? `http_${response.status}`;
      throw new JournalingApiError(response.status, code, errorMessage(response.status, code, json.error?.message), json.error?.upgradeUrl ?? null, retryAfterMs(response.headers.get('retry-after'), this.now()));
    }
    if (json.data === undefined) throw new JournalingApiError(response.status, 'invalid_response', 'The journaling platform sent a reply without data.');
    return { data: json.data, etag: response.headers.get('etag') };
  }
}
