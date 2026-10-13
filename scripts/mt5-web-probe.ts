import { readFile } from 'node:fs/promises';
import { Mt5WebClient, type WebCredentials } from '../electron/mt5-web-client';
import type { WebTickUpdate } from '../electron/mt5-web-market';

async function credentialsFromFile(path: string): Promise<WebCredentials> {
  const input: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!input || typeof input !== 'object') throw new Error('Credential file must contain a JSON object');
  const values = input as Record<string, unknown>;
  if (typeof values.login !== 'string' || !/^\d+$/.test(values.login) || typeof values.password !== 'string') {
    throw new Error('Credential file requires a decimal login string and password string');
  }
  if (values.otp !== undefined && typeof values.otp !== 'string') throw new Error('OTP must be a string');
  return { login: BigInt(values.login), password: values.password, otp: values.otp };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let credentialsPath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--credentials' && args[index + 1]) credentialsPath = args[++index];
    else throw new Error('Usage: npm run probe:mt5-web -- [--credentials /absolute/private/file.json]');
  }
  const client = new Mt5WebClient();
  let quoteCount = 0;
  let streamFault: unknown;
  client.on('fault', (error) => { streamFault = error; });
  client.on('tick', (tick: WebTickUpdate) => {
    quoteCount++;
    const { symbol, timeMs, bid, ask, last, volume, isDelayed } = tick;
    console.log(JSON.stringify({ stage: 'raw-quote', symbol, timeMs, bid, ask, last, isDelayed, volume: volume?.toString() }));
  });
  try {
    const session = await client.connect();
    console.log(JSON.stringify({ stage: 'handshake', ...session, isStandalone: true }));
    const parameters = await client.traderParameters();
    console.log(JSON.stringify({ stage: 'configuration', ...parameters }));
    if (credentialsPath) {
      await client.login(await credentialsFromFile(credentialsPath));
      console.log(JSON.stringify({ stage: 'authenticated', isReadOnlyProbe: true }));
      const account = await client.account();
      console.log(JSON.stringify({ stage: 'account', type: account.type, currency: account.currency, balance: account.balance }));
      const symbols = await client.marketSymbols();
      console.log(JSON.stringify({ stage: 'symbols', count: symbols.length, extensionBytes: client.symbolExtensionBytes }));
      const symbol = symbols.find((symbol) => symbol.name === 'EURUSD') ?? symbols[0];
      if (!symbol) throw new Error('Demo server returned no symbols');
      await client.subscribe([symbol.name]);
      console.log(JSON.stringify({ stage: 'subscribed', symbol: symbol.name, durationSeconds: 15, prices: 'raw broker quotes' }));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 15_000);
        client.once('fault', (error) => { clearTimeout(timer); reject(error); });
      });
      if (streamFault) throw streamFault;
      if (!quoteCount) throw new Error('Subscription produced no quote updates within 15 seconds');
      console.log(JSON.stringify({ stage: 'complete', quoteCount, isReadOnlyProbe: true }));
    }
  } finally {
    client.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'MT5 web probe failed');
  process.exitCode = 1;
});
