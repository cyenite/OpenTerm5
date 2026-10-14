import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { SignalRecord, WebhookSettings, WebhookSource, WebhookStatus } from '../shared/automation';
import { SignalRejected, type Execution } from './signal-executor';
import { SignalError, normalizeSignal, parseSignalBody, type Signal } from './webhook-signal';

export interface WebhookDeps {
  execute(source: WebhookSource, signal: Signal): Promise<Execution>;
  append(record: SignalRecord): void;
  now?: () => number;
}

const MAX_BODY = 64 * 1024;
const REPLAY_WINDOW_MS = 5 * 60_000;
const IDEMPOTENCY_MS = 24 * 3_600_000;
const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_AUTH_FAILURES = 20;
const MAX_RECORDS = 2_000;
const WAIT_MS = 10_000;
const SECRET_FIELDS = new Set(['secret', 'passphrase', 'token']);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest();
const secretEquals = (left: string, right: string) => timingSafeEqual(digest(left), digest(right));

export function signBody(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export class WebhookServer extends EventEmitter {
  private server?: http.Server;
  private settings: WebhookSettings = { host: '127.0.0.1', port: 8787, sources: [], isEnabled: false, isPaused: false };
  private error?: string;
  private readonly records = new Map<string, SignalRecord>();
  private readonly seen = new Map<string, { recordId: string; time: number }>();
  private readonly hits = new Map<string, number[]>();
  private readonly failures = new Map<string, number[]>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly waiters = new Map<string, Array<(record: SignalRecord) => void>>();

  constructor(private readonly deps: WebhookDeps) {
    super();
  }

  private now(): number { return (this.deps.now ?? Date.now)(); }

  status(): WebhookStatus {
    const address = this.server?.address();
    const port = address && typeof address === 'object' ? address.port : this.settings.port;
    const host = this.settings.host === '0.0.0.0' || this.settings.host === '::' ? '127.0.0.1' : this.settings.host;
    return { isRunning: !!this.server?.listening, url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`, ...(this.error ? { error: this.error } : {}) };
  }

  recent(limit = 200): SignalRecord[] {
    return [...this.records.values()].slice(-limit).reverse();
  }

  async test(source: WebhookSource, body: string): Promise<SignalRecord> {
    const started = this.now();
    const record: SignalRecord = { id: randomUUID(), time: started, action: '', status: 'accepted', symbol: '', message: 'Local test (dry run)', sourceId: source.id, remote: 'local test', results: [], payload: {} };
    try {
      const raw = parseSignalBody(body);
      const signal = normalizeSignal(raw);
      const execution = await this.deps.execute({ ...source, isDryRun: true }, signal);
      const result: SignalRecord = { ...record, action: signal.action, symbol: execution.symbol || signal.symbol, payload: this.sanitize(raw), status: 'dryRun', message: execution.message, results: [], latencyMs: this.now() - started };
      this.remember(result);
      return result;
    } catch (error) {
      const result: SignalRecord = { ...record, status: 'rejected', message: (error as Error).message, latencyMs: this.now() - started };
      this.remember(result);
      return result;
    }
  }

  seed(records: readonly SignalRecord[]): void {
    for (const record of records) this.records.set(record.id, record);
  }

  async apply(settings: WebhookSettings): Promise<WebhookStatus> {
    const needsRestart = !this.server || settings.host !== this.settings.host || settings.port !== this.settings.port || settings.isEnabled !== this.settings.isEnabled;
    this.settings = settings;
    if (needsRestart) {
      await this.stop();
      if (settings.isEnabled) await this.start();
    }
    this.emit('status', this.status());
    return this.status();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private start(): Promise<void> {
    this.error = undefined;
    const server = http.createServer((request, response) => void this.handle(request, response));
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    this.server = server;
    return new Promise((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.error = error.code === 'EADDRINUSE' ? `Port ${this.settings.port} is already in use` : error.message;
        this.server = undefined;
        resolve();
      });
      server.listen(this.settings.port, this.settings.host, () => resolve());
    });
  }

  private send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    if (response.headersSent) return;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    response.end(JSON.stringify(body));
  }

  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const declared = Number(request.headers['content-length'] ?? 0);
      if (declared > MAX_BODY) return reject(new HttpError(413, 'Body exceeds 64 KB'));
      const chunks: Buffer[] = [];
      let size = 0;
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Body exceeds 64 KB')); request.destroy(); return; }
        chunks.push(chunk);
      });
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      request.on('error', reject);
    });
  }

  private remote(request: IncomingMessage): string {
    return request.socket.remoteAddress ?? 'unknown';
  }

  private failAuth(remote: string): never {
    const now = this.now();
    const recent = (this.failures.get(remote) ?? []).filter((time) => now - time < FAILURE_WINDOW_MS);
    recent.push(now);
    this.failures.set(remote, recent);
    throw new HttpError(401, 'Authentication failed');
  }

  // X-T5-* are the names used before the rename to OpenTerm; existing senders keep working.
  private header(request: IncomingMessage, name: 'source' | 'timestamp' | 'signature'): string | undefined {
    const value = request.headers[`x-openterm-${name}`] ?? request.headers[`x-t5-${name}`];
    return typeof value === 'string' ? value : undefined;
  }

  private bearer(request: IncomingMessage): string | undefined {
    const header = request.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  }

  private authenticate(request: IncomingMessage, url: URL, body: string, raw: Record<string, unknown> | null, sourceId?: string): WebhookSource {
    const remote = this.remote(request);
    if ((this.failures.get(remote) ?? []).filter((time) => this.now() - time < FAILURE_WINDOW_MS).length >= MAX_AUTH_FAILURES) throw new HttpError(429, 'Too many failed authentication attempts; try again later');
    const signature = this.header(request, 'signature');
    const claimedSource = sourceId ?? this.header(request, 'source');
    if (signature !== undefined) {
      const source = this.settings.sources.find((item) => item.id === claimedSource && item.auth === 'hmac');
      const timestamp = Number(this.header(request, 'timestamp'));
      if (!source || !Number.isFinite(timestamp)) this.failAuth(remote);
      if (Math.abs(this.now() - timestamp * 1000) > REPLAY_WINDOW_MS) throw new HttpError(401, 'Signature timestamp is outside the 5 minute window');
      if (!secretEquals(signature, signBody(source.secret, timestamp, body))) this.failAuth(remote);
      return source;
    }
    const supplied = this.bearer(request) ?? url.searchParams.get('token') ?? (typeof raw?.secret === 'string' ? raw.secret : typeof raw?.passphrase === 'string' ? raw.passphrase : undefined);
    if (!supplied) this.failAuth(remote);
    const candidates = this.settings.sources.filter((item) => item.auth === 'token' && (!claimedSource || item.id === claimedSource));
    const source = candidates.find((item) => secretEquals(supplied, item.secret));
    if (!source) this.failAuth(remote);
    return source;
  }

  private rateLimit(source: WebhookSource): void {
    const now = this.now();
    const recent = (this.hits.get(source.id) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= Math.max(1, source.maxPerMinute)) throw new HttpError(429, `Rate limit of ${source.maxPerMinute} signals per minute reached`);
    recent.push(now);
    this.hits.set(source.id, recent);
  }

  private remember(record: SignalRecord): void {
    this.records.set(record.id, record);
    while (this.records.size > MAX_RECORDS) this.records.delete(this.records.keys().next().value!);
    this.deps.append(record);
    this.emit('record', record);
    if (!['accepted'].includes(record.status)) {
      for (const resolve of this.waiters.get(record.id) ?? []) resolve(record);
      this.waiters.delete(record.id);
    }
  }

  private sanitize(raw: Record<string, unknown> | null): Record<string, unknown> {
    if (!raw) return {};
    return Object.fromEntries(Object.entries(raw).filter(([key]) => !SECRET_FIELDS.has(key.toLowerCase())).slice(0, 40));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = this.now();
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); }
    catch { return this.send(response, 400, { error: 'Bad URL' }); }
    try {
      if (request.method === 'GET' && url.pathname === '/v1/health') return this.send(response, 200, { ok: true, isPaused: this.settings.isPaused });
      const statusMatch = /^\/v1\/signals\/([\w-]{1,64})$/.exec(url.pathname);
      if (request.method === 'GET' && statusMatch) {
        const source = this.authenticate(request, url, '', null);
        const record = this.records.get(statusMatch[1]);
        if (!record || record.sourceId !== source.id) throw new HttpError(404, 'Unknown signal');
        return this.send(response, 200, record);
      }
      const hookMatch = /^\/v1\/hooks\/([\w-]{1,64})$/.exec(url.pathname);
      if (request.method !== 'POST' || !(url.pathname === '/v1/signals' || hookMatch)) throw new HttpError(404, 'Not found. POST /v1/signals or /v1/hooks/{sourceId}');
      const body = await this.readBody(request);
      let raw: Record<string, unknown> | null = null;
      let parseError: string | undefined;
      try { raw = parseSignalBody(body); }
      catch (error) { parseError = (error as Error).message; }
      const source = this.authenticate(request, url, body, raw, hookMatch?.[1]);
      if (!source.isEnabled) throw new HttpError(403, 'This signal source is disabled');
      if (parseError || !raw) throw new HttpError(400, parseError ?? 'Unreadable signal');
      let signal: Signal;
      try { signal = normalizeSignal(raw); }
      catch (error) {
        if (error instanceof SignalError) throw new HttpError(422, error.message);
        throw error;
      }
      const idempotency = signal.id ?? (typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'].slice(0, 128) : undefined);
      if (idempotency) {
        for (const [key, entry] of this.seen) if (started - entry.time > IDEMPOTENCY_MS) this.seen.delete(key);
        const previous = this.seen.get(`${source.id}:${idempotency}`);
        if (previous) return this.send(response, 200, { id: previous.recordId, status: 'duplicate', record: this.records.get(previous.recordId) ?? null });
      }
      this.rateLimit(source);
      const record: SignalRecord = {
        id: randomUUID(), time: started, action: signal.action, status: 'accepted', symbol: signal.symbol, message: 'Queued',
        sourceId: source.id, remote: this.remote(request), results: [], payload: this.sanitize(raw),
      };
      if (idempotency) this.seen.set(`${source.id}:${idempotency}`, { recordId: record.id, time: started });
      if (this.settings.isPaused) {
        this.remember({ ...record, status: 'rejected', message: 'Signal intake is paused (kill switch)' });
        throw new HttpError(503, 'Signal intake is paused');
      }
      this.remember(record);
      const done = new Promise<SignalRecord>((resolve) => this.waiters.set(record.id, [...(this.waiters.get(record.id) ?? []), resolve]));
      this.enqueue(source, signal, record, started);
      if (url.searchParams.get('wait') === '1') {
        const finished = await Promise.race([done, new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS))]);
        return this.send(response, finished ? 200 : 202, finished ?? { id: record.id, status: 'accepted', statusUrl: `/v1/signals/${record.id}` });
      }
      return this.send(response, 202, { id: record.id, status: 'accepted', statusUrl: `/v1/signals/${record.id}` });
    } catch (error) {
      if (error instanceof HttpError) return this.send(response, error.status, { error: error.message }, error.status === 429 ? { 'retry-after': '60' } : {});
      return this.send(response, 500, { error: 'Internal error' });
    }
  }

  // Signals for one account run strictly in arrival order, so an entry and its
  // close can never overtake each other.
  private enqueue(source: WebhookSource, signal: Signal, record: SignalRecord, started: number): void {
    const previous = this.queues.get(source.accountId) ?? Promise.resolve();
    const next = previous.then(async () => {
      let update: Partial<SignalRecord>;
      try {
        const execution = await this.deps.execute(source, signal);
        update = { status: execution.status, message: execution.message, results: execution.results, symbol: execution.symbol || record.symbol };
      } catch (error) {
        update = { status: error instanceof SignalRejected ? 'rejected' : 'failed', message: (error as Error).message };
      }
      this.remember({ ...record, ...update, latencyMs: this.now() - started });
    });
    this.queues.set(source.accountId, next.catch(() => undefined));
  }
}
