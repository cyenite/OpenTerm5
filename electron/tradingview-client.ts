import type { TradingViewAccount, TradingViewChartSettings, TradingViewChartSettingsScan, TradingViewDrawings, TradingViewDrawingSet, TradingViewDrawingTemplate, TradingViewLineToolData, TradingViewPointData, TradingViewScan, TradingViewSkippedLayout, TradingViewSource, TradingViewSymbol } from '../shared/tradingview';

interface LineToolRecord extends TradingViewLineToolData {
  ownerSource?: string;
}

// TradingView has no public API for a user's drawings or themes. These are the requests its own
// chart page makes (read from its 2026-10-14 web build), sent with the signed-in session's cookies.

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const tradingViewSite = 'https://www.tradingview.com';

const sharedChartId = '_shared';

const defaultStorage = 'https://charts-storage.tradingview.com/charts-storage/';

interface ChartPage {
  storageUrl: string;
  account: TradingViewAccount | null;
}

interface LayoutRef {
  url: string;
  name: string;
}

interface Layout {
  id: string;
  url: string;
  name: string;
  // `settings` is the chart cut down to what its chart settings need.
  charts: { chartId: string; symbol: string; interval?: string; seriesId: string; tools: LineToolRecord[]; settings: unknown }[];
}

interface StoredCount {
  count: number;
  chartId: string;
  storageSymbol: string;
  ids: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : typeof value === 'number' ? String(value) : undefined);

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export class TradingViewError extends Error {
  constructor(message: string, readonly status?: number, readonly reason?: string) {
    super(message);
  }
}

export function parseChartPage(html: string): ChartPage {
  const link = /<link\b[^>]*\brel="[^"]*\bchart-storage\b(?!-)[^"]*"[^>]*>/i.exec(html)?.[0];
  const href = link ? /\bhref="([^"]+)"/i.exec(link)?.[1] : undefined;
  const storageUrl = href ? (href.endsWith('/') ? href : `${href}/`) : defaultStorage;
  const isSignedIn = /\bis_authenticated\s*=\s*true\b/.test(html);
  const line = /^\s*var user\s*=\s*(\{.*\});\s*$/m.exec(html)?.[1];
  let account: TradingViewAccount | null = null;
  if (isSignedIn && line) {
    try {
      const user = JSON.parse(line) as Record<string, unknown>;
      const id = Number(user.id);
      if (Number.isSafeInteger(id) && id > 0 && typeof user.username === 'string') account = { id, username: user.username };
    } catch {
      account = null;
    }
  }
  return { storageUrl, account };
}

// A layout's short id from its address (https://www.tradingview.com/chart/AbCd1234/) or the id itself.
function layoutUrlOf(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const fromPath = /\/chart\/([A-Za-z0-9_-]+)/.exec(raw)?.[1];
  return fromPath ?? (/^[A-Za-z0-9_-]+$/.test(raw) ? raw : undefined);
}

export function parseLayoutList(body: unknown): LayoutRef[] {
  const list = Array.isArray(body) ? body : isRecord(body) ? [body.results, body.charts, body.data, body.items].find(Array.isArray) ?? [] : [];
  const seen = new Set<string>();
  return list.flatMap((item): LayoutRef[] => {
    if (!isRecord(item)) return [];
    const url = layoutUrlOf(item.url) ?? layoutUrlOf(item.short_url) ?? layoutUrlOf(item.image_url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ url, name: text(item.name) ?? text(item.title) ?? url }];
  });
}

function pointOf(value: unknown): TradingViewPointData {
  if (!isRecord(value)) return {};
  return { time_t: finite(value.time_t), offset: finite(value.offset), price: finite(value.price), interval: text(value.interval) };
}

// A saved line tool: `{type, id, state, points, zorder, ownerSource}`. Whether it sits on the price
// chart is settled once the layouts' price series ids are known.
export function lineToolOf(value: unknown): LineToolRecord | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !value.type.startsWith('LineTool')) return null;
  const id = text(value.id);
  if (!id || !Array.isArray(value.points) || !isRecord(value.state)) return null;
  return { id, type: value.type, points: value.points.map(pointOf), state: value.state, zorder: finite(value.zorder), isOnPrice: false, ownerSource: text(value.ownerSource) };
}

export function parseLayout(body: unknown, url: string): Layout {
  if (!isRecord(body)) throw new TradingViewError(`TradingView sent an unreadable layout for ${url}.`);
  let content: unknown = body.content;
  if (typeof content === 'string') {
    try { content = content === 'null' || content === 'undefined' ? null : JSON.parse(content); }
    catch { content = null; }
  }
  const charts = isRecord(content) && Array.isArray(content.charts) ? content.charts : [];
  return {
    id: text(body.uid) ?? url,
    url,
    name: text(body.name) ?? url,
    charts: charts.flatMap((chart, index) => {
      if (!isRecord(chart) || !Array.isArray(chart.panes)) return [];
      const sources = chart.panes.flatMap((pane) => (isRecord(pane) && Array.isArray(pane.sources) ? pane.sources : []));
      const series = sources.find((source) => isRecord(source) && source.type === 'MainSeries');
      const symbol = isRecord(series) && isRecord(series.state) ? text(series.state.symbol) : undefined;
      if (!symbol) return [];
      const tools = sources.map(lineToolOf).filter((tool): tool is LineToolRecord => tool !== null);
      const seriesId = text((series as Record<string, unknown>).id) ?? defaultSeriesId;
      const state = (series as Record<string, unknown>).state as Record<string, unknown>;
      const settings = { chartProperties: chart.chartProperties, timeScale: chart.timeScale, panes: [{ sources: [{ type: 'MainSeries', id: seriesId, state }] }] };
      return [{ chartId: text(chart.chartId) ?? String(index + 1), symbol, interval: text(state.interval), seriesId, tools, settings }];
    }),
  };
}

// `{charts: {[chartId]: {symbols: {[symbol]: {countSources}}}}}`.
export function parseSizes(payload: unknown): StoredCount[] {
  const charts = isRecord(payload) && isRecord(payload.charts) ? payload.charts : {};
  return Object.entries(charts).flatMap(([chartId, chart]) => {
    const symbols = isRecord(chart) && isRecord(chart.symbols) ? chart.symbols : {};
    return Object.entries(symbols).flatMap(([storageSymbol, size]) => {
      const ids = isRecord(size) && Array.isArray(size.ids) ? size.ids.flatMap((id) => text(id) ?? []) : [];
      const count = isRecord(size) ? finite(size.countSources) ?? ids.length : 0;
      return count > 0 ? [{ count, chartId, storageSymbol, ids }] : [];
    });
  });
}

// `{sources: {[id]: {id, state: <line tool>, symbol, ...}}}`.
export function parseSources(payload: unknown): LineToolRecord[] {
  const sources = isRecord(payload) && isRecord(payload.sources) ? payload.sources : {};
  return Object.values(sources).flatMap((source) => {
    const tool = isRecord(source) ? lineToolOf(source.state) : null;
    return tool ? [tool] : [];
  });
}

// Storage can key a symbol with its settings: ={"symbol":"FX:EURUSD","adjustment":"splits"}.
export function displaySymbol(storageSymbol: string): string {
  if (!storageSymbol.startsWith('=')) return storageSymbol;
  try {
    const parsed = JSON.parse(storageSymbol.slice(1)) as Record<string, unknown>;
    return text(parsed.symbol) ?? storageSymbol;
  } catch {
    return storageSymbol;
  }
}

// The error TradingView gives, such as "JWT validation failed", for the message the user sees.
async function reasonOf(response: Response): Promise<string | undefined> {
  try {
    const body = JSON.parse(await response.text()) as unknown;
    return (isRecord(body) ? text(body.detail) ?? text(body.errorMsg) ?? text(body.message) ?? text(body.code) : undefined)?.slice(0, 120);
  } catch {
    return undefined;
  }
}

const entities: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };

export function unescapeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, entity: string) => entities[entity]);
}

// Runs `work` over the items, at most `size` at a time.
async function inBatches<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < items.length; index += size) await Promise.all(items.slice(index, index + size).map(work));
}

// One layout TradingView will not open (locked above the plan's limit, deleted meanwhile) must not
// stop the others from being read.
const isLayoutRefusal = (error: unknown): error is TradingViewError => error instanceof TradingViewError && (error.status === 403 || error.status === 404);

// The price series' id differs per layout (ibCWf0, say); '_seriesId' is the default for new charts.
const defaultSeriesId = '_seriesId';

const placed = (tool: LineToolRecord, seriesIds: ReadonlySet<string>): TradingViewLineToolData => {
  const { ownerSource, ...data } = tool;
  return { ...data, isOnPrice: !ownerSource || seriesIds.has(ownerSource) };
};

export class TradingViewClient {
  private page?: ChartPage;
  private readonly tokens = new Map<string, Promise<string>>();
  private readonly layouts = new Map<string, Promise<Layout>>();
  private readonly seriesIds = new Set<string>([defaultSeriesId]);

  constructor(private readonly fetcher: Fetcher) {}

  async account(): Promise<TradingViewAccount | null> {
    this.page = parseChartPage(await this.text(`${tradingViewSite}/chart/`, 'the chart page'));
    return this.page.account;
  }

  async symbols(): Promise<TradingViewScan> {
    const account = await this.signedIn();
    const skippedLayouts: TradingViewSkippedLayout[] = [];
    const found = new Map<string, { ids: Set<string>; unnamed: number; sources: TradingViewSource[] }>();
    const add = (symbol: string, ids: readonly string[], count: number, source: TradingViewSource) => {
      const entry = found.get(symbol) ?? { ids: new Set<string>(), unnamed: 0, sources: [] };
      if (ids.length) ids.forEach((id) => entry.ids.add(id));
      else entry.unnamed += count;
      entry.sources.push(source);
      found.set(symbol, entry);
    };
    let firstLayout: Layout | undefined;
    for (const ref of parseLayoutList(await this.json(`${tradingViewSite}/my-charts/`, 'your chart layouts'))) {
      try {
        const layout = await this.layout(ref.url, ref.name);
        const base = { layoutId: layout.id, layoutUrl: layout.url, layoutName: layout.name };
        const stored = parseSizes(await this.storage(account, layout.id, `layout/${layout.id}/sizes`, {}));
        firstLayout ??= layout;
        for (const chart of layout.charts) {
          const ids = chart.tools.filter((tool) => placed(tool, this.seriesIds).isOnPrice).map((tool) => tool.id);
          if (ids.length) add(chart.symbol, ids, ids.length, { ...base, scope: 'layout', chartId: chart.chartId, storageSymbol: chart.symbol, seriesId: chart.seriesId });
        }
        for (const size of stored) {
          const seriesId = layout.charts.find((chart) => chart.chartId === size.chartId)?.seriesId;
          add(displaySymbol(size.storageSymbol), size.ids, size.count, { ...base, scope: 'chart', chartId: size.chartId, storageSymbol: size.storageSymbol, ...(seriesId ? { seriesId } : {}) });
        }
      } catch (error) {
        if (!isLayoutRefusal(error)) throw error;
        skippedLayouts.push({ layoutName: ref.name, reason: error.reason ?? `TradingView answered ${error.status}` });
      }
    }
    // Synced drawings are requested through any layout TradingView opens.
    if (firstLayout) {
      const base = { layoutId: firstLayout.id, layoutUrl: firstLayout.url, layoutName: firstLayout.name };
      try {
        for (const stored of parseSizes(await this.storage(account, firstLayout.id, 'user/sizes', {}))) {
          add(displaySymbol(stored.storageSymbol), stored.ids, stored.count, { ...base, scope: 'synced', storageSymbol: stored.storageSymbol });
        }
      } catch (error) {
        if (!isLayoutRefusal(error)) throw error;
        skippedLayouts.push({ layoutName: 'Drawings synced to all layouts', reason: error.reason ?? `TradingView answered ${error.status}` });
      }
    }
    const symbols = [...found]
      .map(([symbol, entry]) => ({ symbol, count: entry.ids.size + entry.unnamed, ids: [...entry.ids], sources: entry.sources }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
    return { symbols, skippedLayouts };
  }

  async drawings(symbols: readonly TradingViewSymbol[]): Promise<TradingViewDrawings> {
    const account = await this.signedIn();
    const sets: TradingViewDrawingSet[] = [];
    const skipped = new Map<string, string>();
    // Every layout's price series id is needed to tell price drawings from indicator ones.
    for (const source of symbols.flatMap((symbol) => symbol.sources)) {
      try { await this.layout(source.layoutUrl, source.layoutName); }
      catch (error) { if (!isLayoutRefusal(error)) throw error; }
    }
    for (const symbol of symbols) {
      const tools = new Map<string, LineToolRecord>();
      for (const source of symbol.sources) {
        try {
          for (const tool of await this.sourceTools(account, source)) tools.set(tool.id, tool);
        } catch (error) {
          if (!isLayoutRefusal(error)) throw error;
          skipped.set(source.scope === 'synced' ? 'Drawings synced to all layouts' : source.layoutName, error.reason ?? `TradingView answered ${error.status}`);
        }
      }
      sets.push({ symbol: symbol.symbol, tools: [...tools.values()].map((tool) => placed(tool, this.seriesIds)) });
    }
    return { sets, skippedLayouts: [...skipped].map(([layoutName, reason]) => ({ layoutName, reason })) };
  }

  // Every template saved for the given tool classes. TradingView lists names HTML-escaped (S&amp;R)
  // and finds a template only by that escaped name, so it is sent back as listed and unescaped for
  // display.
  async drawingTemplates(types: readonly string[]): Promise<TradingViewDrawingTemplate[]> {
    await this.signedIn();
    const found: TradingViewDrawingTemplate[] = [];
    await inBatches(types, 6, async (type) => {
      const listed = await this.optionalJson(`${tradingViewSite}/drawing-templates/${encodeURIComponent(type)}/`, `your ${type} templates`);
      const names = Array.isArray(listed) ? listed.flatMap((name) => text(name) ?? []) : [];
      for (const name of names) {
        const body = await this.optionalJson(`${tradingViewSite}/drawing-template/${encodeURIComponent(type)}/?templateName=${encodeURIComponent(name)}`, `the template "${unescapeHtml(name)}"`);
        const content = isRecord(body) ? body.content : undefined;
        if (typeof content !== 'string' || !content) continue;
        try { found.push({ type, name: unescapeHtml(name), content: JSON.parse(content) }); }
        catch { continue; }
      }
    });
    return found.sort((left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name));
  }

  // The chart settings of every chart in every layout TradingView opens.
  async chartSettings(): Promise<TradingViewChartSettingsScan> {
    await this.signedIn();
    const charts: TradingViewChartSettings[] = [];
    const skippedLayouts: TradingViewSkippedLayout[] = [];
    for (const ref of parseLayoutList(await this.json(`${tradingViewSite}/my-charts/`, 'your chart layouts'))) {
      try {
        const layout = await this.layout(ref.url, ref.name);
        for (const chart of layout.charts) {
          charts.push({ layoutName: layout.name, layoutUrl: layout.url, chartId: chart.chartId, symbol: chart.symbol, ...(chart.interval ? { interval: chart.interval } : {}), content: chart.settings });
        }
      } catch (error) {
        if (!isLayoutRefusal(error)) throw error;
        skippedLayouts.push({ layoutName: ref.name, reason: error.reason ?? `TradingView answered ${error.status}` });
      }
    }
    return { charts, skippedLayouts };
  }

  async themes(): Promise<string[]> {
    await this.signedIn();
    const body = await this.json(`${tradingViewSite}/themes/`, 'your chart themes');
    const list = Array.isArray(body) ? body : isRecord(body) ? [body.themes, body.results, body.data].find(Array.isArray) ?? [] : [];
    return [...new Set(list.flatMap((item) => {
      const name = isRecord(item) ? text(item.name) : text(item);
      return name ? [name] : [];
    }))];
  }

  async theme(name: string): Promise<unknown> {
    await this.signedIn();
    const body = await this.json(`${tradingViewSite}/theme/?themeName=${encodeURIComponent(name)}`, `the theme "${name}"`);
    const content = isRecord(body) ? body.content : undefined;
    if (typeof content !== 'string') throw new TradingViewError(`TradingView sent no colours for the theme "${name}".`);
    try { return JSON.parse(content); }
    catch { throw new TradingViewError(`TradingView sent unreadable colours for the theme "${name}".`); }
  }

  private async sourceTools(account: TradingViewAccount, source: TradingViewSource): Promise<LineToolRecord[]> {
    if (source.scope === 'layout') {
      const layout = await this.layout(source.layoutUrl, source.layoutName);
      return layout.charts.filter((chart) => chart.chartId === source.chartId && chart.symbol === source.storageSymbol).flatMap((chart) => chart.tools);
    }
    const path = source.scope === 'synced' ? 'get/user/sources' : `get/layout/${source.layoutId}/sources`;
    // As TradingView's own request: drawings shared within the layout live under chart "_shared",
    // and only a chart's own drawings are narrowed to the price series (narrowing shared ones
    // returns nothing).
    const query: Record<string, string> = { symbol: source.storageSymbol };
    if (source.scope === 'chart' && source.chartId) {
      query.chart_id = source.chartId;
      if (source.chartId !== sharedChartId) query.includeOwnerSource = source.seriesId ?? defaultSeriesId;
    }
    query.brokerName = '';
    return parseSources(await this.storage(account, source.layoutId, path, query));
  }

  private layout(url: string, name: string): Promise<Layout> {
    const cached = this.layouts.get(url);
    if (cached) return cached;
    const layout = this.json(`${tradingViewSite}/chart/${url}/json/`, `the layout "${name}"`).then((body) => {
      const parsed = parseLayout(body, url);
      parsed.charts.forEach((chart) => this.seriesIds.add(chart.seriesId));
      return parsed;
    });
    layout.catch(() => this.layouts.delete(url));
    this.layouts.set(url, layout);
    return layout;
  }

  private async signedIn(): Promise<TradingViewAccount> {
    const account = this.page?.account ?? await this.account();
    if (!account) throw new TradingViewError('Sign in to TradingView first.');
    return account;
  }

  private token(account: TradingViewAccount, layoutId: string): Promise<string> {
    const cached = this.tokens.get(layoutId);
    if (cached) return cached;
    const url = `${tradingViewSite}/chart-token/?image_url=${encodeURIComponent(layoutId)}&user_id=${account.id}`;
    const token = this.json(url, 'access to your drawings').then((body) => {
      const value = isRecord(body) ? text(body.token) : undefined;
      if (!value) throw new TradingViewError('TradingView did not grant access to your drawings. Sign in again.');
      return value;
    });
    token.catch(() => this.tokens.delete(layoutId));
    this.tokens.set(layoutId, token);
    return token;
  }

  private async storage(account: TradingViewAccount, layoutId: string, path: string, query: Record<string, string>): Promise<unknown> {
    const url = new URL(path, this.page?.storageUrl ?? defaultStorage);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set('layout_id', layoutId);
    url.searchParams.set('jwt', await this.token(account, layoutId));
    const body = await this.json(url.href, 'your drawings');
    if (!isRecord(body) || body.success !== true) throw new TradingViewError('TradingView could not read your drawings.');
    return body.payload;
  }

  // TradingView's own fetch marks requests to its site as XHR; without that, /my-charts/ redirects
  // to the home page instead of answering. A redirect from a data request means the session is gone.
  private async request(url: string, what: string, isPage: boolean): Promise<Response> {
    const isSite = new URL(url).origin === tradingViewSite;
    const headers: Record<string, string> = isPage ? { Accept: 'text/html' } : { Accept: 'application/json', ...(isSite ? { 'X-Requested-With': 'XMLHttpRequest' } : {}) };
    const send = () => this.fetcher(url, { headers, redirect: isPage ? 'follow' : 'manual', signal: AbortSignal.timeout(20_000) });
    let response = await send();
    if (response.status === 429) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      response = await send();
    }
    if (response.ok) return response;
    const reason = await reasonOf(response);
    const detail = reason ? `: ${reason}` : '';
    const { status } = response;
    if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) throw new TradingViewError(`TradingView sent a page instead of ${what}. Sign in to TradingView again.`);
    if (status === 401 || status === 403) throw new TradingViewError(`TradingView refused access to ${what} (${status}${detail}). Sign in to TradingView again if this continues.`, status, reason);
    if (status === 429) throw new TradingViewError('TradingView is limiting requests. Try again in a minute.', status, reason);
    throw new TradingViewError(`TradingView answered ${status}${detail} when reading ${what}.`, status, reason);
  }

  private async text(url: string, what: string): Promise<string> {
    return (await this.request(url, what, true)).text();
  }

  // A request whose absence (a tool with no templates) is not an error.
  private async optionalJson(url: string, what: string): Promise<unknown> {
    try { return await this.json(url, what); }
    catch (error) {
      if (error instanceof TradingViewError && error.status === 404) return null;
      throw error;
    }
  }

  private async json(url: string, what: string): Promise<unknown> {
    const body = await (await this.request(url, what, false)).text();
    try { return JSON.parse(body); }
    catch { throw new TradingViewError(`TradingView sent an unreadable answer when reading ${what}.`); }
  }
}
