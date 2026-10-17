// Study types of imported Pine scripts: the prefix and the script's local id.
export const pineStudyPrefix = 'pine-';

export const pineStudyType = (id: string) => `${pineStudyPrefix}${id}`;

// What a Pine script says about itself before it runs: its Pine version, its licence and author
// (from the comment header TradingView's editor writes), and why OpenTerm5 cannot run it, if so.

export interface PineHeader {
  version: number | null;
  author: string | null;
  // An SPDX identifier where one is recognised, else the licence line as written; null when the
  // script states none, which leaves all rights with its author.
  license: string | null;
}

const HEADER_LINES = 40;

const knownLicenses: [RegExp, string][] = [
  [/mozilla public license,?\s*(?:v(?:ersion)?\.?\s*)?2\.0|mpl[-\s]?2\.0/i, 'MPL-2.0'],
  [/creativecommons\.org\/licenses\/by-nc-sa\/(\d\.\d)|attribution-noncommercial-sharealike\s+(\d\.\d)/i, 'CC-BY-NC-SA-$1'],
  [/creativecommons\.org\/licenses\/by-nc\/(\d\.\d)|attribution-noncommercial\s+(\d\.\d)/i, 'CC-BY-NC-$1'],
  [/creativecommons\.org\/licenses\/by-sa\/(\d\.\d)|attribution-sharealike\s+(\d\.\d)/i, 'CC-BY-SA-$1'],
  [/creativecommons\.org\/licenses\/by\/(\d\.\d)/i, 'CC-BY-$1'],
  [/\bmit license\b/i, 'MIT'],
  [/apache license,?\s*(?:version\s*)?2\.0/i, 'Apache-2.0'],
  [/gnu affero general public license/i, 'AGPL-3.0'],
  [/gnu general public license/i, 'GPL-3.0'],
];

function commentHeader(source: string): string[] {
  return source.split(/\r?\n/).slice(0, HEADER_LINES).filter((line) => line.trimStart().startsWith('//')).map((line) => line.trimStart().slice(2).trim());
}

function licenseOf(lines: readonly string[]): string | null {
  const joined = lines.join('\n');
  const spdx = /SPDX-License-Identifier:\s*([\w.+-]+)/i.exec(joined)?.[1];
  if (spdx) return spdx;
  for (const [pattern, id] of knownLicenses) {
    const match = pattern.exec(joined);
    if (match) return id.replace('$1', match[1] ?? match[2] ?? '');
  }
  return lines.find((line) => /licen[cs]e/i.test(line))?.slice(0, 120) ?? null;
}

function authorOf(lines: readonly string[]): string | null {
  for (const line of lines) {
    const match = /(?:©|\(c\)|copyright)\s*(?:\d{4}(?:\s*[-\u2013]\s*(?:\d{4}|present))?\s*)?(?:by\s+)?([^\s·,|]+(?:\s[^\s·,|\d][^\s·,|]*)?)/i.exec(line);
    if (match?.[1] && !/^(?:licen[cs]ed|this|the)$/i.test(match[1])) return match[1];
  }
  return null;
}

export function readPineHeader(source: string): PineHeader {
  const lines = commentHeader(source);
  const version = /^\s*\/\/\s*@version\s*=\s*(\d+)/m.exec(source)?.[1];
  return { version: version ? Number(version) : null, author: authorOf(lines), license: licenseOf(lines) };
}

// The declaration call that opens the script body, ignoring comments.
function declarationOf(source: string): 'indicator' | 'strategy' | 'library' | null {
  for (const line of source.split(/\r?\n/)) {
    const code = line.replace(/\/\/.*$/, '').trim();
    if (!code) continue;
    const match = /^(indicator|strategy|library|study)\s*\(/.exec(code);
    if (match) return match[1] === 'study' ? 'indicator' : (match[1] as 'indicator' | 'strategy' | 'library');
  }
  return null;
}

// Why the script cannot run here, as a sentence for the user, or null when it can be tried.
export function pineSourceProblem(source: string): string | null {
  if (!source.trim()) return 'The script is empty.';
  // PineTS's own JavaScript dialect runs as JavaScript, outside Pine's sandbox.
  if (/^\s*\/\/\s*@PineTS\b/m.test(source)) return 'This is PineTS JavaScript, not Pine Script. OpenTerm5 runs Pine Script only.';
  const { version } = readPineHeader(source);
  if (version === null) return 'The script has no //@version line. OpenTerm5 runs Pine Script v5 and v6.';
  if (version < 5) return `The script is written for Pine Script v${version}. OpenTerm5 runs v5 and v6; TradingView's editor can convert it.`;
  const declaration = declarationOf(source);
  if (declaration === 'strategy') return 'This is a strategy. OpenTerm5 runs indicators only.';
  if (declaration === 'library') return 'This is a library, which other scripts import; it does not draw anything on its own.';
  if (declaration === null) return 'The script does not declare an indicator.';
  const library = /^\s*import\s+([\w-]+\/[\w-]+\/\d+)/m.exec(source)?.[1];
  if (library) return `The script imports the TradingView library ${library}, which OpenTerm5 cannot load.`;
  return null;
}

// Pine names a day 'D' or '1D' and seconds with 'S'; Meridian always counts ('1D') and writes
// seconds as '5s'. Minutes are plain numbers in both.
export function chartTimeframeOf(timeframe: string): string {
  const match = /^(\d*)([SDWM]?)$/i.exec(timeframe.trim());
  if (!match || !match[2]) return timeframe.trim();
  const count = match[1] || '1';
  return match[2].toUpperCase() === 'S' ? `${count}s` : `${count}${match[2].toUpperCase()}`;
}

export function pineTimeframeOf(timeframe: string): string {
  return /^\d+s$/.test(timeframe) ? timeframe.toUpperCase() : timeframe;
}
