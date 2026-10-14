// Some brokers put their web terminal behind Cloudflare's bot check, which only admits a browser
// that has passed the challenge. OpenTerm5 never solves it automatically: the user completes it in a
// real Chromium window whose session all broker traffic shares (see browser-network.ts).
export class BotCheckError extends Error {
  constructor(readonly host: string) {
    super(`${host} is protected by a Cloudflare bot check. Log in again and complete the check in the window OpenTerm5 opens; it closes by itself once the broker lets you through.`);
  }
}

type Headers = Record<string, string | string[] | undefined> | { get(name: string): string | null };

function header(headers: Headers, name: string): string {
  const value = 'get' in headers && typeof headers.get === 'function' ? headers.get(name) : (headers as Record<string, string | string[] | undefined>)[name];
  return (Array.isArray(value) ? value[0] : value ?? '').toLowerCase();
}

export function isBotCheck(status: number, headers: Headers): boolean {
  return header(headers, 'cf-mitigated') === 'challenge' || status === 403 && header(headers, 'server') === 'cloudflare' && header(headers, 'cf-ray') !== '';
}
