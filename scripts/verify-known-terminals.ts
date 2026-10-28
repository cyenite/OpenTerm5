import { BotCheckError } from '../electron/bot-check';
import { knownTerminals, type KnownTerminal } from '../electron/known-terminals';
import { Mt5WebClient } from '../electron/mt5-web-client';
import { fetchTerminalPage, parseServerMetadata } from '../electron/mt5-web-discovery';

type Outcome = 'ok' | 'bot-check' | 'incomplete-chain' | 'failed';

interface Verification {
  readonly detail: string;
  readonly outcome: Outcome;
  readonly terminal: KnownTerminal;
}

const batchSize = 8;
const handshakeTimeout = 20_000;

// Node does not fetch missing intermediate certificates the way Chromium does, so a broker that
// omits its intermediate (IC Markets) fails here while working in the app.
function classify(error: unknown): Outcome {
  if (error instanceof BotCheckError) return 'bot-check';
  const text = `${(error as Error).message} ${String((error as { cause?: unknown }).cause ?? '')}`;
  return /issuer certificate|first certificate/i.test(text) ? 'incomplete-chain' : 'failed';
}

async function verify(terminal: KnownTerminal): Promise<Verification> {
  try {
    const listed = parseServerMetadata(await fetchTerminalPage(terminal.webUrl), terminal.webUrl).map((entry) => entry.server);
    if (!listed.includes(terminal.servers[0])) return { terminal, outcome: 'failed', detail: `page lists ${listed.join(', ')}, not ${terminal.servers[0]}` };
    const client = new Mt5WebClient(new URL('/terminal', terminal.webUrl.replace(/^https:/, 'wss:')).href);
    const timer = setTimeout(() => client.close(), handshakeTimeout);
    try {
      const session = await client.connect();
      await client.traderParameters();
      return { terminal, outcome: 'ok', detail: `build ${session.version}` };
    } finally {
      clearTimeout(timer);
      client.close();
    }
  } catch (error) {
    const cause = (error as { cause?: Error }).cause?.message;
    return { terminal, outcome: classify(error), detail: [(error as Error).message || String(error), cause].filter(Boolean).join(': ') };
  }
}

async function main(): Promise<void> {
  const results: Verification[] = [];
  for (let index = 0; index < knownTerminals.length; index += batchSize) {
    results.push(...await Promise.all(knownTerminals.slice(index, index + batchSize).map(verify)));
  }
  for (const { terminal, outcome, detail } of results) {
    if (outcome !== 'ok') console.log(`${outcome.padEnd(16)} ${terminal.servers.join(', ')} ${terminal.webUrl} - ${detail}`);
  }
  const count = (outcome: Outcome) => results.filter((result) => result.outcome === outcome).length;
  console.log(`ok ${count('ok')}, bot-check ${count('bot-check')}, incomplete-chain ${count('incomplete-chain')}, failed ${count('failed')} of ${results.length}`);
  if (count('failed')) process.exitCode = 1;
}

void main();
