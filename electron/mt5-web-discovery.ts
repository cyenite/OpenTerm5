import type { ServerLookupResult } from '../shared/protocol';

const publicTerminal = 'https://web.metatrader.app/terminal';
const maximumBytes = 1_048_576;

export function validateTerminalUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Enter an HTTPS broker web-terminal URL without credentials or a fragment.');
  }
  if (url.hostname === 'localhost' || !url.hostname.includes('.') || /^[\d.]+$/.test(url.hostname)) {
    throw new Error('Use the public hostname of the broker web terminal.');
  }
  return url;
}

export function parseServerMetadata(html: string, webUrl: string): ServerLookupResult[] {
  const url = validateTerminalUrl(webUrl);
  const match = /(?:window\.)?__terminal_params\s*=\s*/.exec(html);
  if (!match) throw new Error('This page does not publish supported MT5 web-terminal server metadata.');
  const start = match.index + match[0].length;
  let depth = 0;
  let isString = false;
  let isEscaped = false;
  let end = -1;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (isString) {
      if (isEscaped) isEscaped = false;
      else if (char === '\\') isEscaped = true;
      else if (char === '"') isString = false;
    } else if (char === '"') isString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) { end = index + 1; break; }
    else if (index === start && char !== '{') break;
  }
  if (end === -1) throw new Error('The MT5 web-terminal metadata is incomplete.');
  const params: unknown = JSON.parse(html.slice(start, end));
  if (!params || typeof params !== 'object') throw new Error('Invalid MT5 terminal metadata.');
  const config = params as { broker?: { name?: unknown }; servers?: unknown };
  if (typeof config.broker?.name !== 'string' || !Array.isArray(config.servers)) {
    throw new Error('The page does not declare a broker and its supported servers.');
  }
  if (config.servers.length > 100) throw new Error('The server catalogue exceeds the supported size.');
  const endpoint = new URL('/terminal', url);
  endpoint.protocol = 'wss:';
  return config.servers.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid server catalogue entry.');
    const entry = value as { server?: unknown; type?: unknown };
    if (typeof entry.server !== 'string' || entry.server.length > 128 || !entry.server.trim()) {
      throw new Error('Invalid server name in web-terminal metadata.');
    }
    return {
      broker: config.broker!.name as string,
      server: entry.server,
      type: typeof entry.type === 'string' ? entry.type : 'unknown',
      webUrl: url.href,
      webEndpoint: endpoint.href,
      isWebAvailable: true,
    };
  });
}

export async function discoverServers(
  params: { query?: string; webUrl?: string },
  fetchPage: typeof fetch = fetch,
): Promise<ServerLookupResult[]> {
  const url = validateTerminalUrl(params.webUrl?.trim() || publicTerminal);
  const response = await fetchPage(url.href, {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'text/html' },
  });
  if (!response.ok) throw new Error(`The web terminal returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('The web terminal returned an empty page.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new Error('The web-terminal page exceeds the supported size.');
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } finally {
    await reader.cancel();
  }
  const query = params.query?.trim().toLowerCase() ?? '';
  return parseServerMetadata(html, url.href).filter((entry) =>
    !query || `${entry.broker} ${entry.server} ${entry.type}`.toLowerCase().includes(query),
  );
}
