import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
}

export interface Loopback {
  readonly port: number;
  readonly callbackUrl: string;
  // Resolves with the code once the browser comes back with the right state.
  readonly code: Promise<string>;
  close(): void;
}

export class ConnectCancelledError extends Error {}

const CODE_LIFETIME_MS = 10 * 60_000;

export const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeOf(verifier) };
}

export const createState = () => randomBytes(24).toString('base64url');

export function isStateMatch(expected: string, received: string | null): boolean {
  if (!received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function connectUrl(platform: string, values: { callback?: string; state?: string; challenge?: string; device: string }): string {
  const url = new URL('/connect/openterm', platform);
  if (values.callback) url.searchParams.set('callback', values.callback);
  if (values.state) url.searchParams.set('state', values.state);
  if (values.challenge) url.searchParams.set('challenge', values.challenge);
  url.searchParams.set('device', values.device);
  return url.toString();
}

const page = (title: string, detail: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0}main{max-width:420px;padding:24px;text-align:center}h1{font-size:18px;margin:0 0 8px}p{margin:0;opacity:.75}</style></head><body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;

function reply(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', connection: 'close' });
  response.end(html);
}

// A one-shot listener on 127.0.0.1 for the browser's redirect. A request with the wrong state is
// answered and ignored, so another page on this computer cannot end the wait or plant a code.
export function startLoopback(state: string, timeoutMs = CODE_LIFETIME_MS): Promise<Loopback> {
  return new Promise((resolveStart, rejectStart) => {
    let isDone = false;
    let finish: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
    const code = new Promise<string>((resolve, reject) => { finish = { resolve, reject }; });
    code.catch(() => undefined);
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== '/callback') return reply(response, 404, page('Not found', 'This address only receives the Tradescribe connection.'));
      if (!isStateMatch(state, url.searchParams.get('state'))) return reply(response, 400, page('Link expired', 'This connection request does not match the one OpenTerm5 is waiting for. Start again from OpenTerm5.'));
      const error = url.searchParams.get('error');
      const received = url.searchParams.get('code');
      if (error || !received) {
        reply(response, 200, page('Connection cancelled', 'OpenTerm5 was not connected. You can close this tab.'));
        done(new ConnectCancelledError(error === 'access_denied' ? 'You cancelled the connection in Tradescribe.' : 'Tradescribe did not send a connection code.'));
        return;
      }
      reply(response, 200, page('OpenTerm5 is connecting', 'You can close this tab and return to OpenTerm5.'));
      done(null, received);
    });
    const timer = setTimeout(() => done(new ConnectCancelledError('The connection timed out. Start again from the Journaling page.')), timeoutMs);
    function done(error: Error | null, received?: string): void {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      server.close();
      server.closeIdleConnections();
      if (error) finish!.reject(error);
      else finish!.resolve(received!);
    }
    server.on('error', (error) => { clearTimeout(timer); rejectStart(error); });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolveStart({ port, callbackUrl: `http://127.0.0.1:${port}/callback`, code, close: () => done(new ConnectCancelledError('Connection cancelled.')) });
    });
  });
}
