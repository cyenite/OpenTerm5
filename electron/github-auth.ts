// GitHub App sign-in by the device flow. The app ships only its public client id: device-flow
// tokens refresh without a client secret (confirmed in Phase 0), so there is no secret to leak.
export const GITHUB_CLIENT_ID = 'Iv23liFThQygQHujfYaD';
export const GITHUB_APP_SLUG = 'openterm5-sync';
export const GITHUB_WEB = 'https://github.com';
export const GITHUB_API = 'https://api.github.com';

// Refreshed this long before expiry, so a token never runs out in the middle of a sync.
const REFRESH_MARGIN_MS = 5 * 60_000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GitHubTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly refreshExpiresAt: number;
}

export interface DeviceCode {
  readonly userCode: string;
  readonly deviceCode: string;
  readonly expiresAt: number;
  readonly intervalMs: number;
  readonly verificationUri: string;
}

export class GitHubAuthError extends Error {
  constructor(readonly reason: 'denied' | 'expired' | 'reconnect' | 'network' | 'cancelled', message: string) { super(message); }
}

export interface GitHubAuthDeps {
  readonly fetch: Fetch;
  readonly clientId?: string;
  readonly now?: () => number;
  readonly pause?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly load: () => GitHubTokens | null;
  readonly save: (tokens: GitHubTokens | null) => Promise<void>;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new GitHubAuthError('cancelled', 'Connecting to GitHub was cancelled.')); }, { once: true });
  });
}

export class GitHubAuth {
  private refreshing: Promise<string> | null = null;
  private readonly now: () => number;
  private readonly clientId: string;
  private readonly pause: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(private readonly deps: GitHubAuthDeps) {
    this.now = deps.now ?? Date.now;
    this.clientId = deps.clientId ?? GITHUB_CLIENT_ID;
    this.pause = deps.pause ?? wait;
  }

  get isSignedIn(): boolean {
    const tokens = this.deps.load();
    return !!tokens && tokens.refreshExpiresAt > this.now();
  }

  async start(): Promise<DeviceCode> {
    const reply = await this.form('/login/device/code', { client_id: this.clientId });
    if (typeof reply.device_code !== 'string' || typeof reply.user_code !== 'string' || typeof reply.verification_uri !== 'string') {
      throw new GitHubAuthError('network', `GitHub did not start the sign-in${typeof reply.error === 'string' ? ` (${reply.error})` : ''}.`);
    }
    if (new URL(reply.verification_uri).origin !== GITHUB_WEB) throw new GitHubAuthError('network', 'GitHub sent an unexpected sign-in address.');
    return {
      userCode: reply.user_code, deviceCode: reply.device_code, verificationUri: reply.verification_uri,
      intervalMs: Math.max(5, Number(reply.interval) || 5) * 1000, expiresAt: this.now() + (Number(reply.expires_in) || 900) * 1000,
    };
  }

  async poll(code: DeviceCode, signal?: AbortSignal): Promise<GitHubTokens> {
    let interval = code.intervalMs;
    while (this.now() < code.expiresAt) {
      await this.pause(interval, signal);
      const reply = await this.form('/login/oauth/access_token', { client_id: this.clientId, device_code: code.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
      if (reply.error === 'authorization_pending') continue;
      if (reply.error === 'slow_down') { interval = (Number(reply.interval) || interval / 1000 + 5) * 1000; continue; }
      if (reply.error === 'access_denied') throw new GitHubAuthError('denied', 'The sign-in was declined on GitHub.');
      if (reply.error === 'expired_token') break;
      const tokens = this.tokensFrom(reply);
      if (!tokens) throw new GitHubAuthError('network', `GitHub refused the sign-in${typeof reply.error === 'string' ? ` (${reply.error})` : ''}.`);
      await this.deps.save(tokens);
      return tokens;
    }
    throw new GitHubAuthError('expired', 'The GitHub code expired. Start again.');
  }

  // Refresh tokens are single use, so refreshes run one at a time and the new pair is saved before
  // the new access token is handed out: a crash between the two cannot strand a spent token.
  accessToken(): Promise<string> {
    const tokens = this.deps.load();
    if (!tokens || tokens.refreshExpiresAt <= this.now()) return Promise.reject(new GitHubAuthError('reconnect', 'Reconnect GitHub to keep syncing.'));
    if (tokens.expiresAt - REFRESH_MARGIN_MS > this.now()) return Promise.resolve(tokens.accessToken);
    this.refreshing ??= this.refresh(tokens).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async signOut(): Promise<void> {
    await this.deps.save(null);
  }

  private async refresh(tokens: GitHubTokens): Promise<string> {
    const reply = await this.form('/login/oauth/access_token', { client_id: this.clientId, grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    const next = this.tokensFrom(reply);
    // Phase 0 got incorrect_client_credentials for a spent refresh token where GitHub documents
    // bad_refresh_token, so no particular error code is relied on.
    if (!next) {
      await this.deps.save(null);
      throw new GitHubAuthError('reconnect', 'GitHub ended this sign-in. Reconnect GitHub to keep syncing.');
    }
    await this.deps.save(next);
    return next.accessToken;
  }

  private tokensFrom(reply: Record<string, unknown>): GitHubTokens | null {
    const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, refresh_token_expires_in: refreshExpiresIn } = reply;
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || !Number(expiresIn)) return null;
    const now = this.now();
    return { accessToken, refreshToken, expiresAt: now + Number(expiresIn) * 1000, refreshExpiresAt: now + (Number(refreshExpiresIn) || 180 * 86_400) * 1000 };
  }

  private async form(path: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.deps.fetch(`${GITHUB_WEB}${path}`, {
        method: 'POST', redirect: 'error', body: new URLSearchParams(fields).toString(),
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      throw new GitHubAuthError('network', 'GitHub could not be reached.');
    }
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new GitHubAuthError('network', `GitHub answered ${response.status} without JSON.`); }
  }
}
