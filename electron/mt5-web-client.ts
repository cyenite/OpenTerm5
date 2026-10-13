import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { unzipSync } from 'node:zlib';
import { BinaryReader, BinaryWriter } from './mt5-web-codec';
import { Mt5WebTransport, WebCommand, type WebSession } from './mt5-web-transport';
import { buildSymbolSubscription, parseSymbols, parseTickUpdates, type WebSymbol } from './mt5-web-market';

export interface WebCredentials {
  readonly login: bigint;
  readonly otp?: string;
  readonly password: string;
}

export interface TraderParameters {
  readonly country: string;
  readonly currency: string;
}

export interface WebAuthentication {
  readonly session: bigint;
}

export interface WebAccount {
  readonly type: number;
  readonly balance: number;
  readonly permissions: number;
  readonly name: string;
  readonly currency: string;
}

export function parseAccount(payload: Uint8Array): WebAccount {
  if (payload.byteLength < 816) throw new Error('Truncated MT5 account record');
  const reader = new BinaryReader(payload);
  const type = reader.u8();
  const permissions = reader.i32();
  reader.bytes(4);
  const balance = reader.f64();
  reader.bytes(8);
  const currency = reader.fixedString(64);
  reader.bytes(8);
  const name = reader.fixedString(256);
  if (!Number.isFinite(balance)) throw new Error('Invalid MT5 account balance');
  return { type, permissions, balance, currency, name };
}

export function buildLoginPayload(credentials: WebCredentials, identity: Uint8Array): Buffer {
  if (credentials.login < 1n) throw new Error('Account login must be positive');
  if (!credentials.password || credentials.password.length > 32 || credentials.password.includes('\0')) {
    throw new Error('Password must contain between 1 and 32 UTF-16 code units');
  }
  if (identity.byteLength !== 16) throw new Error('Device identity must be 16 bytes');
  return new BinaryWriter(912)
    .u32(0).fixedString(credentials.password, 64).fixedString(credentials.otp ?? '', 128)
    .bytes(identity).fixedString('', 64).fixedString('', 64).u64(0n).fixedString('', 128)
    .u32(0).fixedString('', 256).u64(credentials.login).bytes(Buffer.alloc(160)).u64(0n).finish();
}

export class Mt5WebClient extends EventEmitter {
  readonly transport: Mt5WebTransport;
  private isAuthenticated = false;
  private isPinging = false;
  private heartbeat?: NodeJS.Timeout;
  private symbolExtension: Buffer = Buffer.alloc(0);
  private readonly symbols = new Map<number, WebSymbol>();
  private readonly identity = createHash('sha1').update(`${process.platform};1;en;0x0;${randomBytes(16).toString('hex')}`).digest().subarray(0, 16);

  constructor(readonly endpoint = 'wss://web.metatrader.app/terminal') {
    super();
    this.transport = new Mt5WebTransport(endpoint);
    this.transport.on('disconnected', (error) => {
      this.close();
      this.emit('fault', error);
    });
    this.transport.on('notification', (response) => {
      if (!this.isAuthenticated || (response.command !== 8 && response.command !== 17)) return;
      try {
        if (response.status) throw new Error(`Quote stream returned status ${response.status}`);
        for (const update of parseTickUpdates(response.command, response.payload, this.symbols)) this.emit('tick', update);
      } catch (error) {
        this.close();
        this.emit('fault', error);
      }
    });
  }

  async connect(): Promise<WebSession> {
    return this.transport.connect();
  }

  async traderParameters(): Promise<TraderParameters> {
    const configuration = new Mt5WebTransport(this.endpoint);
    try {
      await configuration.connect();
      await configuration.request(WebCommand.configuration, Buffer.alloc(744));
      const reader = new BinaryReader(await configuration.request(WebCommand.traderParameters));
      const country = reader.fixedString(32);
      const currency = reader.fixedString(32);
      reader.finish();
      return { country, currency };
    } finally {
      configuration.close();
    }
  }

  async login(credentials: WebCredentials): Promise<WebAuthentication> {
    if (this.isAuthenticated) throw new Error('Account is already authenticated');
    const payload = buildLoginPayload(credentials, this.identity);
    try {
      const reader = new BinaryReader(await this.transport.request(WebCommand.login, payload));
      const token = reader.bytes(160);
      const session = reader.u64();
      reader.finish();
      token.fill(0);
      this.isAuthenticated = true;
      this.heartbeat = setInterval(() => {
        if (this.isPinging) return;
        this.isPinging = true;
        void this.transport.request(WebCommand.ping).catch((error: unknown) => {
          this.close();
          this.emit('fault', error);
        }).finally(() => { this.isPinging = false; });
      }, 5_000);
      return { session };
    } finally {
      payload.fill(0);
    }
  }

  async account(): Promise<WebAccount> {
    this.requireAuthentication();
    return parseAccount(await this.transport.request(3));
  }

  async marketSymbols(): Promise<readonly WebSymbol[]> {
    this.requireAuthentication();
    const compressed = await this.transport.request(34);
    if (compressed.length < 4) throw new Error('Truncated compressed symbol response');
    const list = parseSymbols(unzipSync(compressed.subarray(4), { maxOutputLength: 16 * 1024 * 1024 }));
    const symbols = list.symbols;
    this.symbolExtension = list.extension;
    this.symbols.clear();
    for (const symbol of symbols) this.symbols.set(symbol.id, symbol);
    return symbols;
  }

  get symbolExtensionBytes(): number {
    return this.symbolExtension.length;
  }

  async subscribe(names: readonly string[]): Promise<void> {
    this.requireAuthentication();
    const ids = names.map((name) => {
      const symbol = [...this.symbols.values()].find((symbol) => symbol.name === name);
      if (!symbol) throw new Error(`Symbol is not available: ${name}`);
      return symbol.id;
    });
    const payload = buildSymbolSubscription(ids);
    await this.transport.request(18, payload);
    await this.transport.request(7, payload);
  }

  private requireAuthentication(): void {
    if (!this.isAuthenticated) throw new Error('Broker login is required');
  }

  close(): void {
    this.isAuthenticated = false;
    this.isPinging = false;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.symbols.clear();
    this.symbolExtension = Buffer.alloc(0);
    this.transport.close();
  }
}
