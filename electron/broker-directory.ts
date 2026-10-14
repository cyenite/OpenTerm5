import type { BrokerServer, ResolvedServer, ServerSource } from '../shared/protocol';
import { JsonStore } from './json-store';
import { BotCheckError } from './bot-check';
import { fetchTerminalPage, findTerminalFrame, parseServerMetadata } from './mt5-web-discovery';

const catalogueUrl = 'https://metatraderweb.app/trade/servers?version=5';
const catalogueAge = 7 * 86_400_000;
const probeTimeout = 6_000;
const probeLimit = 10;

interface KnownTerminal {
  readonly webUrl: string;
  readonly prefixes: readonly string[];
}

// Verified by fetching each page and reading its __terminal_params (2026-10-14).
export const knownTerminals: readonly KnownTerminal[] = [
  { webUrl: 'https://web.metatrader.app/terminal', prefixes: ['MetaQuotes-'] },
  { webUrl: 'https://mt5webterminal.ftmo.com/terminal', prefixes: ['FTMO-'] },
  { webUrl: 'https://mt5-demo01.pepperstone.com/terminal', prefixes: ['Pepperstone-Demo'] },
  { webUrl: 'https://mt5-1.pepperstone.com/terminal', prefixes: ['Pepperstone-MT5-Live'] },
];

// The web terminal is served by the broker's access servers, which follow a few naming habits
// (mt5-demo01.pepperstone.com, mt5-1.pepperstone.com) besides dedicated web hosts.
const webHosts = ['mt5webterminal', 'webterminal', 'mt5web', 'mt5-web', 'webtrader', 'web', 'mt5', 'trade', 'terminal'];
const demoHosts = ['mt5-demo01', 'mt5-demo', 'mt5demo', 'mt5-demo1', 'demo-mt5', 'demo.mt5', 'demo'];
const liveHosts = ['mt5-1', 'mt5-live01', 'mt5-live', 'mt5-real01', 'mt5-real', 'mt5live', 'mt5real', 'live-mt5', 'live.mt5', 'live', 'real', 'access'];
const companySuffixes = /(global|international|intl|group|ltd|limited|llc|inc|corp|markets?|fx|trading|trade|capital|financial|investments?|securities|broker|sc|eu|uk|au|za|ky|bs|vu|mu|sv)$/;

interface Catalogue {
  readonly fetchedAt: number;
  readonly servers: readonly string[];
}

interface Resolved {
  readonly [server: string]: { readonly webUrl: string; readonly broker: string; readonly isListed: boolean };
}

export function serverPrefix(server: string): string {
  return server.split('-')[0];
}

export function brokerDomains(server: string): string[] {
  const prefix = serverPrefix(server).toLowerCase().replace(/[^a-z0-9]/g, '');
  const domains = new Set<string>();
  let base = prefix;
  for (let index = 0; index < 3 && base.length >= 4; index++) {
    domains.add(`${base}.com`);
    const trimmed = base.replace(companySuffixes, '');
    if (trimmed === base) break;
    base = trimmed;
  }
  return [...domains];
}

export function candidateTerminals(server: string): string[] {
  const isDemo = /demo|trial|contest/i.test(server);
  const hosts = isDemo ? [...webHosts, ...demoHosts, ...liveHosts] : [...webHosts, ...liveHosts, ...demoHosts];
  return brokerDomains(server).flatMap((domain) => hosts.map((host) => `https://${host}.${domain}/terminal`));
}

export function rankServers(servers: readonly string[], query: string, limit = 40): BrokerServer[] {
  const needle = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!needle) return [];
  const scored = servers.flatMap((server) => {
    const name = server.toLowerCase();
    const at = name.replace(/\s+/g, '').indexOf(needle);
    return at < 0 ? [] : [{ server, score: at === 0 ? 0 : name.includes(`-${needle}`) ? 1 : 2 }];
  });
  scored.sort((left, right) => left.score - right.score || left.server.length - right.server.length || left.server.localeCompare(right.server));
  return scored.slice(0, limit).map(({ server }) => ({ server, broker: serverPrefix(server), type: /demo|trial|contest/i.test(server) ? 'demo' : '' }));
}

function parseCatalogue(value: unknown): Catalogue {
  const catalogue = value as Partial<Catalogue>;
  if (typeof catalogue?.fetchedAt !== 'number' || !Array.isArray(catalogue.servers)) throw new Error('Invalid server catalogue');
  return { fetchedAt: catalogue.fetchedAt, servers: catalogue.servers.filter((server): server is string => typeof server === 'string') };
}

function parseResolved(value: unknown): Resolved {
  if (!value || typeof value !== 'object') throw new Error('Invalid resolved servers');
  return value as Resolved;
}

export class BrokerDirectory {
  private catalogue?: Promise<readonly string[]>;
  private readonly catalogueStore: JsonStore<Catalogue>;
  private readonly resolvedStore: JsonStore<Resolved>;

  constructor(directory: string, private readonly fetchPage: typeof fetch = fetch) {
    this.catalogueStore = new JsonStore(`${directory}/broker-servers.json`, parseCatalogue, () => ({ fetchedAt: 0, servers: [] }));
    this.resolvedStore = new JsonStore(`${directory}/broker-terminals.json`, parseResolved, () => ({}));
  }

  async search(query: string, saved: readonly string[] = []): Promise<BrokerServer[]> {
    const servers = await this.servers();
    return rankServers([...new Set([...saved, ...servers])], query);
  }

  // Only verified directory entries and servers that already logged in are trusted. A discovered or
  // typed host is returned unsaved so the user must approve it, because anyone who owns a guessed
  // domain can publish any server name in its page.
  async resolve(server: string): Promise<ResolvedServer> {
    const name = server.trim();
    if (!/^[\w .&()+-]{2,64}$/.test(name)) throw new Error('Enter the trade server name shown by your broker, for example FTMO-Server.');
    const resolved = await this.resolvedStore.load();
    const cached = resolved[name];
    if (cached) return this.result(name, cached.webUrl, cached.broker, cached.isListed, 'saved');
    const known = knownTerminals.filter((terminal) => terminal.prefixes.some((prefix) => name.startsWith(prefix))).map((terminal) => terminal.webUrl);
    const candidates = candidateTerminals(name).filter((url) => !known.includes(url));
    const blocked: string[] = [];
    const trusted = new Set(known);
    const found = await this.probe(name, known, trusted, blocked) ?? await this.probe(name, candidates, trusted, blocked);
    if (!found && blocked.length) throw new BotCheckError(blocked[0]);
    if (!found) throw new Error(`Could not find the address of ${name}. Ask your broker for its MT5 web trading address and enter it under Advanced.`);
    return this.result(name, found.webUrl, found.broker, found.isListed, known.includes(found.webUrl) ? 'known' : 'discovered');
  }

  async inspect(server: string, webUrl: string): Promise<ResolvedServer> {
    const name = server.trim();
    const found = await this.match(name, webUrl, true);
    if (!found) throw new Error('That address does not serve MT5 trading.');
    const isKnown = knownTerminals.some((terminal) => terminal.webUrl === found.webUrl);
    return this.result(name || found.server, found.webUrl, found.broker, found.isListed, isKnown ? 'known' : 'manual');
  }

  async remember(server: string, webEndpoint: string, broker: string): Promise<void> {
    const name = server.trim();
    if (!name) return;
    const endpoint = new URL(webEndpoint);
    endpoint.protocol = 'https:';
    const resolved = await this.resolvedStore.load();
    await this.resolvedStore.save({ ...resolved, [name]: { webUrl: endpoint.href, broker, isListed: true } });
  }

  private result(server: string, webUrl: string, broker: string, isListed: boolean, source: ServerSource): ResolvedServer {
    const endpoint = new URL('/terminal', webUrl);
    endpoint.protocol = 'wss:';
    return { server, broker, webUrl, webEndpoint: endpoint.href, isListed, source };
  }

  private async probe(server: string, candidates: readonly string[], trusted: ReadonlySet<string>, blocked: string[]) {
    for (let index = 0; index < candidates.length; index += probeLimit) {
      const batch = candidates.slice(index, index + probeLimit);
      const controller = new AbortController();
      const result = await new Promise<Awaited<ReturnType<BrokerDirectory['match']>>>((resolve) => {
        let remaining = batch.length;
        let fallback: Awaited<ReturnType<BrokerDirectory['match']>> = null;
        for (const webUrl of batch) {
          void this.match(server, webUrl, trusted.has(webUrl), controller.signal).then((found) => {
            if (found?.isListed) { resolve(found); controller.abort(); }
            else if (found && trusted.has(found.webUrl)) fallback ??= found;
          }).catch((error: unknown) => {
            if (!controller.signal.aborted && error instanceof BotCheckError) blocked.push(error.host);
          }).finally(() => { if (--remaining === 0) resolve(fallback); });
        }
      });
      if (result) return result;
    }
    return null;
  }

  // A guessed host is accepted only when its page declares the exact server name, so an
  // unrelated site on a look-alike domain is never handed the user's password.
  private async match(server: string, webUrl: string, isTrusted: boolean, signal?: AbortSignal): Promise<{ webUrl: string; broker: string; server: string; isListed: boolean } | null> {
    let url = webUrl;
    let html = await fetchTerminalPage(url, this.fetchPage, probeTimeout, signal);
    if (!html.includes('__terminal_params')) {
      const frame = findTerminalFrame(html, url);
      if (!frame) return null;
      url = frame;
      html = await fetchTerminalPage(url, this.fetchPage, probeTimeout, signal);
    }
    const servers = parseServerMetadata(html, url);
    const exact = servers.find((entry) => entry.server.toLowerCase() === server.toLowerCase());
    if (exact) return { webUrl: url, broker: exact.broker, server: exact.server, isListed: true };
    if (!isTrusted || !servers.length) return null;
    return { webUrl: url, broker: servers[0].broker, server: servers[0].server, isListed: false };
  }

  private servers(): Promise<readonly string[]> {
    this.catalogue ??= this.loadCatalogue().catch((error: unknown) => {
      this.catalogue = undefined;
      throw error;
    });
    return this.catalogue;
  }

  private async loadCatalogue(): Promise<readonly string[]> {
    const cached = await this.catalogueStore.load().catch(() => ({ fetchedAt: 0, servers: [] as string[] }));
    if (cached.servers.length && Date.now() - cached.fetchedAt < catalogueAge) return cached.servers;
    try {
      const response = await this.fetchPage(catalogueUrl, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { mt5?: unknown };
      if (!Array.isArray(body.mt5)) throw new Error('unexpected catalogue');
      const servers = body.mt5.filter((server): server is string => typeof server === 'string' && server.length <= 64);
      await this.catalogueStore.save({ fetchedAt: Date.now(), servers });
      return servers;
    } catch (error) {
      if (cached.servers.length) return cached.servers;
      throw new Error(`The broker server list is unavailable (${(error as Error).message}). Type the full server name instead.`);
    }
  }
}
