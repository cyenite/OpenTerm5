import { createHash } from 'node:crypto';

interface Commit {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly author?: unknown;
}

// In-process GitHub: the device flow and the REST endpoints sync uses, with the behaviour Phase 0
// observed (409 on an empty repository, weak ETags, 304s that cost nothing, 422 for a ref update
// that is not a fast-forward). `fetch` has the signature of the global one.
export class FakeGitHub {
  readonly requests: { method: string; url: string; headers: Record<string, string>; body: string }[] = [];
  readonly repos = new Map<number, { fullName: string; isPrivate: boolean; head: string | null }>();
  rateRemaining = 5000;
  isOffline = false;
  isTokenRevoked = false;
  pendingPolls = 0;
  failNext?: { path: RegExp; status: number; headers?: Record<string, string> };
  beforeRefUpdate?: () => void;
  private count = 0;
  private refreshToken = 'ghr_1';
  private readonly objects = new Map<string, unknown>();

  addRepository(id: number, fullName: string, isPrivate = true): void {
    this.repos.set(id, { fullName, isPrivate, head: null });
  }

  readonly fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const body = typeof init.body === 'string' ? init.body : '';
    this.requests.push({ method, url, headers, body });
    if (this.isOffline) throw new TypeError('fetch failed');
    const { origin, pathname } = new URL(url);
    if (origin === 'https://github.com') return this.web(pathname, new URLSearchParams(body));
    if (origin !== 'https://api.github.com') throw new Error(`unexpected host ${origin}`);
    if (this.failNext && this.failNext.path.test(pathname)) {
      const { status, headers: extra } = this.failNext;
      this.failNext = undefined;
      return this.reply(status, { message: 'injected' }, extra);
    }
    if (this.isTokenRevoked || !headers.authorization?.startsWith('Bearer ghu_')) return this.reply(401, { message: 'Bad credentials' });
    return this.api(method, pathname, body ? JSON.parse(body) as Record<string, unknown> : {}, headers);
  };

  private web(path: string, form: URLSearchParams): Response {
    if (path === '/login/device/code') return this.reply(200, { device_code: 'dc', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 });
    if (form.get('grant_type')?.endsWith('device_code')) {
      if (this.pendingPolls > 0) { this.pendingPolls -= 1; return this.reply(200, { error: 'authorization_pending' }); }
      return this.reply(200, { access_token: `ghu_${++this.count}`, refresh_token: this.refreshToken, expires_in: 28_800, refresh_token_expires_in: 15_638_400 });
    }
    if (form.get('refresh_token') !== this.refreshToken) return this.reply(200, { error: 'incorrect_client_credentials' });
    this.refreshToken = `ghr_${++this.count}`;
    return this.reply(200, { access_token: `ghu_${++this.count}`, refresh_token: this.refreshToken, expires_in: 28_800 });
  }

  private put(value: unknown): string {
    const sha = createHash('sha1').update(JSON.stringify(value)).update(String(++this.count)).digest('hex');
    this.objects.set(sha, value);
    return sha;
  }

  private files(tree: string | null): Map<string, string> {
    return new Map(tree ? (this.objects.get(tree) as [string, string][]) : []);
  }

  private api(method: string, path: string, body: Record<string, unknown>, headers: Record<string, string>): Response {
    this.rateRemaining -= 1;
    if (path === '/user') return this.reply(200, { login: 'octotrader' });
    if (path === '/user/installations') return this.reply(200, { installations: this.repos.size ? [{ id: 1 }] : [] });
    if (path === '/user/installations/1/repositories') {
      return this.reply(200, { repositories: [...this.repos].map(([id, repo]) => ({ id, full_name: repo.fullName, private: repo.isPrivate, default_branch: 'main' })) });
    }
    const byId = path.match(/^\/repositories\/(\d+)$/);
    if (byId) {
      const repo = this.repos.get(Number(byId[1]));
      return repo ? this.reply(200, { id: Number(byId[1]), full_name: repo.fullName, private: repo.isPrivate, default_branch: 'main' }) : this.reply(404, { message: 'Not Found' });
    }
    const match = path.match(/^\/repos\/([^/]+\/[^/]+)\/(.+)$/);
    const entry = match && [...this.repos].find(([, repo]) => repo.fullName === match[1]);
    if (!match || !entry) return this.reply(404, { message: 'Not Found' });
    const repo = entry[1];
    const rest = match[2];
    if (method === 'GET' && rest === 'git/ref/heads/main') {
      if (!repo.head) return this.reply(409, { message: 'Git Repository is empty.' });
      const etag = `W/"${repo.head}"`;
      if (headers['if-none-match'] === etag) { this.rateRemaining += 1; return this.reply(304, null, { etag }); }
      return this.reply(200, { object: { sha: repo.head } }, { etag });
    }
    if (method === 'PUT' && rest.startsWith('contents/')) {
      if (repo.head) return this.reply(422, { message: 'sha wasn\'t supplied' });
      const tree = this.put([[rest.slice('contents/'.length), String(body.content)]]);
      repo.head = this.put({ tree, parents: [] } satisfies Commit);
      return this.reply(201, { commit: { sha: repo.head } });
    }
    if (method === 'POST' && rest === 'git/trees') {
      if (!repo.head) return this.reply(409, { message: 'Git Repository is empty.' });
      const files = this.files(body.base_tree as string);
      for (const item of body.tree as { path: string; content?: string; sha?: null }[]) {
        if (item.sha === null) files.delete(item.path);
        else files.set(item.path, Buffer.from(item.content!, 'utf8').toString('base64'));
      }
      return this.reply(201, { sha: this.put([...files]) });
    }
    const treeMatch = rest.match(/^git\/trees\/(\w+)$/);
    if (method === 'GET' && treeMatch) {
      return this.reply(200, { truncated: false, tree: [...this.files(treeMatch[1])].map(([file, content]) => ({ path: file, type: 'blob', sha: this.put({ blob: content }) })) });
    }
    const blobMatch = rest.match(/^git\/blobs\/(\w+)$/);
    if (method === 'GET' && blobMatch) return this.reply(200, { content: (this.objects.get(blobMatch[1]) as { blob: string }).blob, encoding: 'base64' });
    if (method === 'POST' && rest === 'git/commits') return this.reply(201, { sha: this.put({ tree: body.tree, parents: body.parents, author: body.author } as Commit), author: body.author, committer: body.committer });
    const commitMatch = rest.match(/^git\/commits\/(\w+)$/);
    if (method === 'GET' && commitMatch) return this.reply(200, { tree: { sha: (this.objects.get(commitMatch[1]) as Commit).tree } });
    if (method === 'PATCH' && rest === 'git/refs/heads/main') {
      this.beforeRefUpdate?.();
      this.beforeRefUpdate = undefined;
      const commit = this.objects.get(String(body.sha)) as Commit | undefined;
      if (body.force !== false || !commit || !commit.parents.includes(repo.head!)) return this.reply(422, { message: 'Update is not a fast forward' });
      repo.head = String(body.sha);
      return this.reply(200, { object: { sha: repo.head } });
    }
    return this.reply(404, { message: `fake has no ${method} ${path}` });
  }

  // The repository as files, decoded from base64, for assertions.
  contents(id: number): Map<string, Buffer> {
    const head = this.repos.get(id)!.head;
    const tree = head ? (this.objects.get(head) as Commit).tree : null;
    return new Map([...this.files(tree)].map(([path, content]) => [path, Buffer.from(content, 'base64')]));
  }

  // What someone holding the token could do: rewrite one file in a new commit on the branch.
  tamper(id: number, path: string, change: (content: Buffer) => Buffer): void {
    const repo = this.repos.get(id)!;
    const files = this.files((this.objects.get(repo.head!) as Commit).tree);
    files.set(path, change(Buffer.from(files.get(path)!, 'base64')).toString('base64'));
    repo.head = this.put({ tree: this.put([...files]), parents: [repo.head!] } satisfies Commit);
  }

  private reply(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(status === 304 || body === null ? null : JSON.stringify(body), {
      status, headers: { 'content-type': 'application/json', date: new Date().toUTCString(), 'x-ratelimit-remaining': String(this.rateRemaining), ...headers },
    });
  }
}
