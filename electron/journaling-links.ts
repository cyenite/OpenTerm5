import { isSamePlatform, normalizeCode } from '../shared/journaling';

export const protocolScheme = 'openterm5';

export interface ConnectLink {
  readonly code: string;
  readonly platform: string;
}

export type LinkCheck =
  | { readonly isAccepted: true; readonly link: ConnectLink }
  | { readonly isAccepted: false; readonly error: string };

// `openterm5://journaling/connect?code=ABCD-EFGH&platform=https://tradescribe.io`
export function parseConnectLink(input: string): ConnectLink | null {
  let url: URL;
  try { url = new URL(input); }
  catch { return null; }
  if (url.protocol !== `${protocolScheme}:` || url.hostname !== 'journaling' || url.pathname.replace(/\/+$/, '') !== '/connect') return null;
  const code = normalizeCode(url.searchParams.get('code') ?? '');
  const platform = url.searchParams.get('platform') ?? '';
  let origin: string;
  try { origin = new URL(platform).origin; }
  catch { return null; }
  if (!code || origin === 'null') return null;
  return { code, platform: origin };
}

// Windows and Linux hand the link over as a command-line argument, to a new process or, through the
// single-instance lock, to the running one.
export function findConnectLink(argv: readonly string[]): string | null {
  return argv.find((value) => value.toLowerCase().startsWith(`${protocolScheme}://`)) ?? null;
}

export function checkConnectLink(input: string, configuredPlatform: string): LinkCheck {
  const link = parseConnectLink(input);
  if (!link) return { isAccepted: false, error: 'The connection link is not valid. Copy the code from Tradescribe and paste it on the Journaling page instead.' };
  if (!isSamePlatform(link.platform, configuredPlatform)) {
    return { isAccepted: false, error: `This code is for ${link.platform}, but OpenTerm5 journals to ${new URL(configuredPlatform).origin}. Change the journaling platform under Tools > Options to use it.` };
  }
  return { isAccepted: true, link };
}
