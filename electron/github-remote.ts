import { GITHUB_API, GitHubAuthError, type Fetch } from './github-auth';
import type { SyncRemote } from './sync-engine';

const API_VERSION = '2022-11-28';
const SEED_PATH = 'README.md';
const SEED_TEXT = 'Encrypted OpenTerm5 sync data. Do not edit these files by hand.\n';
const BLOB_CACHE = 512;
const READ_CONCURRENCY = 8;

// Files a person might open on github.com stay readable text; everything else is an envelope,
// stored as base64 because tree entries only take UTF-8 text.
const isTextPath = (path: string) => path.endsWith('.json') || path.endsWith('.md');

export class GitHubRateLimitError extends Error {
  constructor(readonly until: number) { super(`GitHub asked to wait until ${new Date(until).toLocaleTimeString()}.`); }
}

export class GitHubNetworkError extends Error {}

export class GitHubRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface RepositoryInfo {
  readonly id: number;
  readonly branch: string;
  readonly fullName: string;
  readonly isPrivate: boolean;
}

interface Reply {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

const repositoryInfo = (value: Record<string, unknown>): RepositoryInfo => ({
  id: Number(value.id), branch: String(value.default_branch ?? 'main'), fullName: String(value.full_name), isPrivate: value.private === true,
});

// Every request goes to api.github.com only, refuses redirects, and never puts the token or a
// response body into an error message.
export class GitHubApi {
  serverOffsetMs = 0;

  constructor(private readonly fetch: Fetch, private readonly token: () => Promise<string>, private readonly now: () => number = Date.now) {}

  get serverNow(): number {
    return this.now() + this.serverOffsetMs;
  }

  async request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const token = await this.token();
    let response: Response;
    try {
      response = await this.fetch(`${GITHUB_API}${path}`, {
        method, redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION, Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new GitHubNetworkError('GitHub could not be reached.');
    }
    const date = Date.parse(response.headers.get('date') ?? '');
    if (Number.isFinite(date)) this.serverOffsetMs = date - this.now();
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { parsed = {}; }
    if (response.status === 401) throw new GitHubAuthError('reconnect', 'GitHub no longer accepts this sign-in. Reconnect GitHub.');
    if ((response.status === 403 || response.status === 429) && (response.headers.get('retry-after') || response.headers.get('x-ratelimit-remaining') === '0')) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      throw new GitHubRateLimitError(retryAfter ? this.now() + retryAfter * 1000 : reset ? reset * 1000 - this.serverOffsetMs : this.now() + 60_000);
    }
    if (response.status >= 500) throw new GitHubRequestError(response.status, `GitHub answered ${response.status}. It will be tried again.`);
    return { status: response.status, headers: response.headers, body: parsed };
  }

  async login(): Promise<string> {
    const reply = await this.request('GET', '/user');
    if (reply.status !== 200 || typeof reply.body.login !== 'string') throw new GitHubRequestError(reply.status, 'GitHub did not return the signed-in account.');
    return reply.body.login;
  }

  // The repositories the OpenTerm5 Sync app was installed on, which are the only ones it can reach.
  async repositories(): Promise<RepositoryInfo[]> {
    const installations = await this.request('GET', '/user/installations?per_page=100');
    const found: RepositoryInfo[] = [];
    for (const installation of (installations.body.installations as Record<string, unknown>[] | undefined) ?? []) {
      const reply = await this.request('GET', `/user/installations/${Number(installation.id)}/repositories?per_page=100`);
      for (const repository of (reply.body.repositories as Record<string, unknown>[] | undefined) ?? []) found.push(repositoryInfo(repository));
    }
    return found.sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  // By numeric id, so a renamed repository is still found; null when it is gone or out of reach.
  async repository(id: number): Promise<RepositoryInfo | null> {
    const reply = await this.request('GET', `/repositories/${id}`);
    if (reply.status === 404) return null;
    if (reply.status !== 200) throw new GitHubRequestError(reply.status, `GitHub answered ${reply.status} for the sync repository.`);
    return repositoryInfo(reply.body);
  }
}

export class GitHubRemote implements SyncRemote {
  private etag: string | null = null;
  private cachedHead: string | null = null;
  private readonly trees = new Map<string, { sha: string; files: Map<string, string> }>();
  private readonly blobs = new Map<string, Buffer>();

  constructor(private readonly api: GitHubApi, private readonly repository: RepositoryInfo, private readonly now: () => number = Date.now) {}

  private get base(): string {
    return `/repos/${this.repository.fullName}`;
  }

  // Conditional on the last ETag (sent back verbatim: GitHub's are weak), so an unchanged head
  // costs no rate limit. An empty repository has no branch yet and reads as null.
  async head(): Promise<string | null> {
    const reply = await this.api.request('GET', `${this.base}/git/ref/heads/${this.repository.branch}`, undefined, this.etag ? { 'If-None-Match': this.etag } : {});
    if (reply.status === 304) return this.cachedHead;
    if (reply.status === 409 || reply.status === 404) {
      [this.etag, this.cachedHead] = [null, null];
      return null;
    }
    const sha = (reply.body.object as { sha?: unknown } | undefined)?.sha;
    if (reply.status !== 200 || typeof sha !== 'string') throw new GitHubRequestError(reply.status, 'GitHub did not return the sync branch.');
    [this.etag, this.cachedHead] = [reply.headers.get('etag'), sha];
    return sha;
  }

  async read(commit: string, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>> {
    const { files } = await this.tree(commit);
    const result = new Map<string, Buffer | null>();
    const queue = [...paths];
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const sha = files.get(path);
        result.set(path, sha ? await this.blob(sha, path) : null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, worker));
    return result;
  }

  // Phase 0: the Git Data API refuses an empty repository, so its first commit is made through the
  // Contents API, and every later commit is tree, commit, then a fast-forward-only ref update that
  // GitHub refuses (422) when someone else moved the branch first.
  async commit(parent: string | null, writes: ReadonlyMap<string, Buffer | null>): Promise<string | null> {
    if (parent === null) {
      if (await this.head() !== null) return null;
      parent = await this.seed();
      if (!parent) return null;
    }
    const { sha: baseTree, files } = await this.tree(parent);
    const entries = [...writes].flatMap<{ path: string; mode: string; type: string; content?: string; sha?: null }>(([path, content]) => content
      ? [{ path, mode: '100644', type: 'blob', content: isTextPath(path) ? content.toString('utf8') : content.toString('base64') }]
      : files.has(path) ? [{ path, mode: '100644', type: 'blob', sha: null }] : []);
    if (!entries.length) return parent;
    const tree = await this.api.request('POST', `${this.base}/git/trees`, { base_tree: baseTree, tree: entries });
    if (tree.status !== 201) throw new GitHubRequestError(tree.status, `GitHub refused the sync files (${tree.status}).`);
    const author = { name: 'OpenTerm5 Sync', email: 'sync@openterm5.invalid', date: new Date(Math.floor(this.now() / 3_600_000) * 3_600_000).toISOString().replace('.000Z', 'Z') };
    const created = await this.api.request('POST', `${this.base}/git/commits`, { message: 'sync', tree: tree.body.sha, parents: [parent], author, committer: author });
    if (created.status !== 201 || typeof created.body.sha !== 'string') throw new GitHubRequestError(created.status, `GitHub refused the sync commit (${created.status}).`);
    const moved = await this.api.request('PATCH', `${this.base}/git/refs/heads/${this.repository.branch}`, { sha: created.body.sha, force: false });
    if (moved.status === 422) return null;
    if (moved.status !== 200) throw new GitHubRequestError(moved.status, `GitHub refused to move the sync branch (${moved.status}).`);
    [this.etag, this.cachedHead] = [null, created.body.sha];
    return created.body.sha;
  }

  private async seed(): Promise<string | null> {
    const reply = await this.api.request('PUT', `${this.base}/contents/${SEED_PATH}`, { message: 'Set up OpenTerm5 sync', content: Buffer.from(SEED_TEXT).toString('base64') });
    if (reply.status === 409 || reply.status === 422) return null;
    const sha = (reply.body.commit as { sha?: unknown } | undefined)?.sha;
    if (reply.status !== 201 || typeof sha !== 'string') throw new GitHubRequestError(reply.status, `GitHub refused to set up the repository (${reply.status}).`);
    return sha;
  }

  private async tree(commit: string): Promise<{ sha: string; files: Map<string, string> }> {
    const cached = this.trees.get(commit);
    if (cached) return cached;
    const reply = await this.api.request('GET', `${this.base}/git/commits/${commit}`);
    const treeSha = (reply.body.tree as { sha?: unknown } | undefined)?.sha;
    if (reply.status !== 200 || typeof treeSha !== 'string') throw new GitHubRequestError(reply.status, 'GitHub did not return the sync commit.');
    const listing = await this.api.request('GET', `${this.base}/git/trees/${treeSha}?recursive=1`);
    if (listing.status !== 200 || listing.body.truncated === true) throw new GitHubRequestError(listing.status, 'GitHub did not return every sync file.');
    const files = new Map(((listing.body.tree as { path: string; sha: string; type: string }[] | undefined) ?? []).filter((item) => item.type === 'blob').map((item) => [item.path, item.sha]));
    const tree = { sha: treeSha, files };
    if (this.trees.size >= 4) this.trees.delete(this.trees.keys().next().value!);
    this.trees.set(commit, tree);
    return tree;
  }

  private async blob(sha: string, path: string): Promise<Buffer> {
    const key = `${isTextPath(path) ? 'text' : 'envelope'}|${sha}`;
    const cached = this.blobs.get(key);
    if (cached) return cached;
    const reply = await this.api.request('GET', `${this.base}/git/blobs/${sha}`);
    if (reply.status !== 200 || typeof reply.body.content !== 'string') throw new GitHubRequestError(reply.status, 'GitHub did not return a sync file.');
    const raw = Buffer.from(reply.body.content, 'base64');
    const content = isTextPath(path) ? raw : Buffer.from(raw.toString('utf8'), 'base64');
    if (this.blobs.size >= BLOB_CACHE) this.blobs.delete(this.blobs.keys().next().value!);
    this.blobs.set(key, content);
    return content;
  }
}
