import assert from 'node:assert/strict';
import test from 'node:test';
import type { TradeRequest } from '../shared/protocol';
import { BotCheckError } from './bot-check';
import { Mt5WebClient, type WebCredentials } from './mt5-web-client';
import { BinaryWriter } from './mt5-web-codec';
import { Mt5WebLink } from './mt5-web-link';
import { WEB_SYMBOL_DETAILS_BYTES } from './mt5-web-models';
import { WebProtocolError, type WebSession } from './mt5-web-transport';
import { WEB_DEAL_BYTES, WEB_POSITION_BYTES } from './mt5-web-trading';

function accountPayload(balance = 10000): Buffer {
  const payload = Buffer.alloc(820);
  payload.writeUInt8(1);
  payload.writeDoubleLE(balance, 9);
  payload.write('USD', 25, 'utf16le');
  payload.writeUInt32LE(2, 89);
  payload.writeUInt32LE(200, 93);
  payload.write('Fixture account', 97, 'utf16le');
  payload.write('MetaQuotes-Demo', 355, 'utf16le');
  payload.write('MetaQuotes', 483, 'utf16le');
  payload.writeUInt32LE(2, 744);
  return payload;
}

function symbolPayload(name = 'EURUSD'): Buffer {
  const payload = Buffer.alloc(4 + WEB_SYMBOL_DETAILS_BYTES);
  payload.writeUInt32LE(1);
  const record = payload.subarray(4);
  const conditions = record.subarray(1536, 2164);
  record.write(name, 0, 'utf16le');
  record.write('Euro vs US Dollar', 96, 'utf16le');
  record.write('EUR', 1276, 'utf16le');
  record.write('USD', 1308, 'utf16le');
  record.write('EUR', 1340, 'utf16le');
  record.writeUInt32LE(5, 1392);
  record.writeDoubleLE(0.00001, 1396);
  record.writeUInt32LE(17, 1412);
  record.writeDoubleLE(0.00001, 1440);
  record.writeDoubleLE(100000, 1456);
  conditions.write('Forex\\Majors\\EURUSD', 0, 'utf16le');
  conditions.writeUInt32LE(4, 264);
  conditions.writeUInt32LE(2, 276);
  conditions.writeUInt32LE(3, 280);
  conditions.writeUInt32LE(15, 284);
  conditions.writeUInt32LE(127, 288);
  conditions.writeBigUInt64LE(1000000n, 336);
  conditions.writeBigUInt64LE(10000000000n, 344);
  conditions.writeBigUInt64LE(1000000n, 352);
  return payload;
}

function tradeNotification(request: Buffer, code: number): Buffer {
  return new BinaryWriter(380).u32(0).bytes(request).u32(code)
    .i64(101n).i64(102n).i64(1000000n).f64(1.1).u32(1700000000)
    .f64(1.0999).f64(1.1).f64(0).fixedString('Fixture result', 64).finish();
}

class FakeClient extends Mt5WebClient {
  balance = 10000;
  admission = 0;
  isClosed = false;
  loginFailure?: Error;
  connectGate?: Promise<void>;
  onRates?: (request: Buffer) => Buffer;
  onSubmit?: (request: Buffer) => Promise<Buffer>;
  detailsName = 'EURUSD';
  snapshotPayload: Buffer = Buffer.alloc(8);
  readonly loginCalls: bigint[] = [];
  readonly submissions: Buffer[] = [];
  readonly subscriptions: string[][] = [];
  readonly commands: number[] = [];

  constructor(endpoint: string) {
    super(endpoint);
    this.transport.request = async (command, payload) => {
      this.commands.push(command);
      if (command === 3) return accountPayload(this.balance);
      if (command === 4) return this.snapshotPayload;
      if (command === 5) return Buffer.alloc(8);
      if (command === 18) return symbolPayload(this.detailsName);
      if (command === 22) return Buffer.alloc(0);
      if (command === 11 && this.onRates) return this.onRates(Buffer.from(payload!));
      if (command === 11) return new BinaryWriter(48).i32(1700000000).f64(1.1).f64(1.2).f64(1).f64(1.15).u64(123n).i32(5).finish();
      if (command === 12) {
        const request = Buffer.from(payload!);
        this.submissions.push(request);
        return this.onSubmit ? this.onSubmit(request) : new BinaryWriter(4).u32(this.admission).finish();
      }
      throw new Error(`Unexpected fixture command ${command}`);
    };
  }

  override async connect(): Promise<WebSession> {
    await this.connectGate;
    return { version: 6258, endpoint: this.endpoint };
  }

  override async login(credentials: WebCredentials): Promise<{ session: bigint }> {
    this.loginCalls.push(credentials.login);
    if (this.loginFailure) throw this.loginFailure;
    return { session: 1n };
  }

  override async marketSymbols() {
    return [{ id: 17, flags: 0, digits: 5, calcMode: 0, name: 'EURUSD', path: 'Forex\\Majors', basis: '', description: 'Euro vs US Dollar' }];
  }

  override async subscribe(names: readonly string[]): Promise<void> { this.subscriptions.push([...names]); }
  override close(): void { this.isClosed = true; }
  notify(request: Buffer, code: number): void { this.transport.emit('notification', { command: 19, status: 0, payload: tradeNotification(request, code) }); }
}

function fixture(configure?: (client: FakeClient, index: number) => void) {
  const clients: FakeClient[] = [];
  const link = new Mt5WebLink((endpoint) => {
    const client = new FakeClient(endpoint);
    configure?.(client, clients.length);
    clients.push(client);
    return client;
  }, 5);
  return { link, clients };
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Fixture condition did not become true');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function loggedIn(link: Mt5WebLink): Promise<void> {
  await link.connect('wss://fixture.example/terminal');
  await link.request('account.login', { login: 1234, password: 'fixture-password' });
}

const marketRequest: TradeRequest = { action: 'deal', type: 'buy', symbol: 'EURUSD', volume: 0.01 };

test('direct adapter login hydrates broker metadata and exposes genuine capabilities', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await link.connect('wss://fixture.example/terminal');
  assert.equal((await link.request('terminal.status', {})).connectionState, 'login-required');
  assert.equal(await link.request('account.info', {}), null);
  const account = await link.request('account.login', { login: 1234, password: 'fixture-password' });
  assert.equal(account.server, 'MetaQuotes-Demo');
  assert.equal(account.balance, 10000);
  assert.equal(clients[0].isClosed, true);
  const status = await link.request('terminal.status', {});
  assert.equal(status.mode, 'mt5-web');
  assert.equal(status.isConnected, true);
  assert.equal(status.capabilities?.depth, true);
  const symbols = await link.request('symbols.list', {});
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].volumeMin, 0.01);
  assert.equal(symbols[0].currencyProfit, 'USD');
  assert.equal(symbols[0].visible, true);
  assert.deepEqual(await link.request('history.get', { from: 0, to: 1700000000 }), { orders: [], deals: [] });
  const bars = await link.request('rates.get', { symbol: 'EURUSD', timeframe: 'M1', count: 1 });
  assert.equal(bars[0].time, 1700000000);
  assert.equal(bars[0].close, 1.15);
  assert.equal(bars[0].volume, 123);
  assert.deepEqual(await link.request('book.subscribe', { symbol: 'EURUSD' }), { symbol: 'EURUSD', levels: [] });
});

test('admission zero cannot resolve an order until its matching final notification', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  let isSettled = false;
  const outcome = link.request('order.send', marketRequest).finally(() => { isSettled = true; });
  await until(() => client.submissions.length === 1);
  const request = client.submissions[0];
  const unrelated = Buffer.from(request);
  unrelated.writeUInt32LE(request.readUInt32LE(0) + 1, 0);
  client.notify(unrelated, 10009);
  client.notify(request, 10001);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(isSettled, false);
  client.notify(request, 10009);
  const result = await outcome;
  assert.equal(result.isSuccess, true);
  assert.equal(result.retcode, 10009);
  assert.equal(client.submissions.length, 1);
  assert.equal(client.commands.filter((command) => command === 4).length, 1);
});

test('broker admission rejection returns failure without waiting for execution', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  clients.at(-1)!.admission = 10017;
  const result = await link.request('order.send', marketRequest);
  assert.equal(result.isSuccess, false);
  assert.equal(result.retcode, 10017);
  assert.equal(clients.at(-1)!.submissions.length, 1);
});

test('connection loss rejects outstanding order and queued order, reconnects without replay', async (t) => {
  const { link, clients } = fixture((client, index) => { client.balance = 10000 + index; });
  t.after(() => link.disconnect());
  await loggedIn(link);
  await link.request('ticks.subscribe', { symbols: ['EURUSD'] });
  await link.request('rates.subscribe', { symbol: 'EURUSD', timeframe: 'M1' });
  const client = clients.at(-1)!;
  client.onSubmit = (request) => client.submissions.length === 1
    ? Promise.resolve(new BinaryWriter(4).u32(0).finish())
    : new Promise((_, reject) => client.once('fault', () => reject(new Error('Fixture socket closed'))));
  const outcome = link.request('order.send', marketRequest);
  const rejection = assert.rejects(outcome, /outcome is unknown/i);
  const sending = link.request('order.send', marketRequest);
  const sendingRejection = assert.rejects(sending, /outcome is unknown/i);
  await until(() => client.submissions.length === 2);
  const queued = link.request('order.send', marketRequest);
  const queuedRejection = assert.rejects(queued, /Connection changed/);
  client.emit('fault', new Error('Fixture disconnected'));
  await rejection;
  await sendingRejection;
  await queuedRejection;
  await until(() => clients.length === 3 && link.state.state === 'open');
  const restored = clients[2];
  assert.deepEqual(restored.loginCalls, [1234n]);
  assert.deepEqual(restored.subscriptions.at(-1), ['EURUSD']);
  assert.equal((await link.request('account.info', {}))?.balance, 10002);
  assert.equal(restored.commands.includes(4), true);
  assert.equal(restored.submissions.length, 0);
  assert.equal(client.submissions.length, 2);
  client.notify(client.submissions[0], 10009);
  assert.equal(restored.submissions.length, 0);
});

test('transport rejection after send is ambiguous and must never replay', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  client.onSubmit = async () => {
    client.emit('fault', new Error('Fixture mid-flight loss'));
    throw new Error('Fixture socket send failed');
  };
  await assert.rejects(link.request('order.send', marketRequest), /outcome is unknown/i);
  await until(() => clients.length === 3 && link.state.state === 'open');
  assert.equal(client.submissions.length, 1);
  assert.equal(clients[2].submissions.length, 0);
});

test('authentication failure clears credentials and does not retry', async (t) => {
  const { link, clients } = fixture((client, index) => { if (index > 0) client.loginFailure = new WebProtocolError(28, 3); });
  t.after(() => link.disconnect());
  await link.connect('wss://fixture.example/terminal');
  await assert.rejects(link.request('account.login', { login: 1234, password: 'fixture-password' }), /status 3/);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(clients.length, 2);
  assert.equal(link.state.state, 'closed');
  assert.match(link.state.error!, /authentication was not retried/);
});

test('manual disconnect cancels pending order and scheduled reconnect', async () => {
  const { link, clients } = fixture();
  await loggedIn(link);
  const client = clients.at(-1)!;
  const outcome = link.request('order.send', marketRequest);
  const rejection = assert.rejects(outcome, /outcome is unknown/i);
  await until(() => client.submissions.length === 1);
  client.emit('fault', new Error('Fixture connection loss'));
  link.disconnect();
  await rejection;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(link.state.state, 'closed');
  assert.equal(clients.length, 2);
});

test('disconnect during handshake prevents a late completion reopening the link', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { link, clients } = fixture((client) => { client.connectGate = gate; });
  const connecting = link.connect('wss://fixture.example/terminal');
  link.disconnect();
  release();
  await connecting;
  assert.equal(link.state.state, 'closed');
  assert.equal(clients[0].isClosed, true);
});

test('nonzero trade notification status cannot report successful execution', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const outcome = link.request('order.send', marketRequest);
  const rejection = assert.rejects(outcome, /outcome is unknown/i);
  await until(() => client.submissions.length === 1);
  client.transport.emit('notification', { command: 19, status: 3, payload: tradeNotification(client.submissions[0], 10009) });
  await rejection;
  assert.equal(client.isClosed, true);
});


test('depth subscriptions decode broker notifications and restore after reconnect', async () => {
  const { link, clients } = fixture();
  const books: unknown[] = [];
  link.on('event', (event, data) => { if (event === 'book') books.push(data); });
  try {
    await loggedIn(link);
    await link.request('book.subscribe', { symbol: 'EURUSD' });
    const payload = new BinaryWriter(47).u32(1).u32(17).i32(0).i32(0).u32(1).u32(2).u16(1).u32(1).u8(1).i64(110010n).i64(500n).finish();
    clients.at(-1)!.transport.emit('notification', { command: 23, status: 0, payload });
    assert.deepEqual(books.at(-1), { symbol: 'EURUSD', isAvailable: true, levels: [{ side: 'sell', price: 1.1001, volume: 0.000005 }] });
    clients.at(-1)!.emit('fault', new Error('Fixture disconnected'));
    await until(() => clients.length === 3 && link.state.state === 'open');
    assert.ok(clients.at(-1)!.commands.includes(22));
    await link.request('book.unsubscribe', { symbol: 'EURUSD' });
    const count = books.length;
    clients.at(-1)!.transport.emit('notification', { command: 23, status: 0, payload });
    assert.equal(books.length, count);
  } finally { link.disconnect(); }
});


test('aggregated charts use native source periods and discard refresh windows when accounts change', async () => {
  const windows: { from: number; period: number }[] = [];
  const now = Math.floor(Date.now() / 120000) * 120;
  const { link } = fixture((client) => {
    client.onRates = (request) => {
      windows.push({ from: request.readInt32LE(66), period: request.readUInt16LE(64) });
      const bars = Array.from({ length: 40 }, (_, index) => new BinaryWriter(48).i32(now - (39 - index) * 60).f64(1.1).f64(1.2).f64(1).f64(1.15).u32(10).f64(0).finish());
      return Buffer.concat(bars);
    };
  });
  try {
    await loggedIn(link);
    const bars = await link.request('rates.get', { symbol: 'EURUSD', timeframe: 'M2', count: 10 });
    assert.equal(bars.length, 10);
    assert.equal(bars.at(-1)!.volume, 10);
    assert.equal(windows[0].period, 1);
    await link.request('rates.get', { symbol: 'EURUSD', timeframe: 'M2', count: 2 });
    assert.ok(windows[1].from > windows[0].from);
    await link.request('account.login', { login: 5678, password: 'fixture-password' });
    await link.request('rates.get', { symbol: 'EURUSD', timeframe: 'M2', count: 2 });
    assert.ok(windows.at(-1)!.from <= windows[0].from + 120);
  } finally { link.disconnect(); }
});


test('close-by validates opposite same-symbol positions and uses source first-position volume', async () => {
  const { link, clients } = fixture((client) => {
    const positions = [0, 1].map((side) => {
      const record = Buffer.alloc(344);
      record.writeBigInt64LE(BigInt(51 + side), 0);
      record.write('EURUSD', 24, 'utf16le');
      record.writeUInt32LE(side, 88);
      record.writeDoubleLE(1.1, 100);
      record.writeBigUInt64LE(side ? 5000000n : 12000000n, 124);
      return record;
    });
    client.snapshotPayload = new BinaryWriter(696).u32(2).bytes(positions[0]).bytes(positions[1]).u32(0).finish();
  });
  try {
    await loggedIn(link);
    await assert.rejects(link.request('order.check', { action: 'closeBy', position: 51, positionBy: 51 }), /opposite/);
    await assert.rejects(link.request('order.check', { action: 'closeBy', position: 51, positionBy: 999 }), /opposite/);
    const checked = await link.request('order.check', { action: 'closeBy', position: 51, positionBy: 52, volume: 999 });
    assert.equal(checked.isSuccess, true);
    const client = clients.at(-1)!;
    client.onSubmit = async (request) => { queueMicrotask(() => client.notify(request, 10009)); return Buffer.alloc(4); };
    const result = await link.request('order.send', { action: 'closeBy', position: 51, positionBy: 52 });
    assert.equal(result.isSuccess, true);
    assert.equal(client.submissions[0].readBigUInt64LE(72), 12000000n);
    assert.equal(client.submissions[0].readBigUInt64LE(236), 52n);
  } finally { link.disconnect(); }
});

test('a bot check stops reconnecting instead of retrying the challenged host', async (t) => {
  let isChallenged = false;
  const { link, clients } = fixture((client) => {
    client.connect = async () => {
      if (isChallenged) throw new BotCheckError('fixture.example');
      return { version: 6258, endpoint: client.endpoint };
    };
  });
  t.after(() => link.disconnect());
  await loggedIn(link);
  isChallenged = true;
  clients.at(-1)!.emit('fault', new Error('dropped'));
  await until(() => link.state.error?.includes('bot check') ?? false);
  const attempts = clients.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(clients.length, attempts);
  assert.equal(link.state.state, 'closed');
});

test('a broker with decorated symbol names still gets a default Market Watch', async (t) => {
  const { link } = fixture((client) => {
    client.detailsName = 'EURUSD.m';
    client.marketSymbols = async () => [
      { id: 17, flags: 0, digits: 5, calcMode: 0, name: 'EURUSD.m', path: 'Forex\\Majors', basis: '', description: 'Euro vs US Dollar' },
      { id: 18, flags: 0, digits: 5, calcMode: 0, name: 'EURNOK.m', path: 'Forex\\Exotics', basis: '', description: 'Euro vs Norwegian Krone' },
    ];
  });
  t.after(() => link.disconnect());
  await loggedIn(link);
  const visible = (await link.request('symbols.list', {})).filter((symbol) => symbol.visible).map((symbol) => symbol.name);
  assert.deepEqual(visible, ['EURUSD.m']);
});


test('orders finish while an active chart read is still waiting on the broker', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const original = client.transport.request.bind(client.transport);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let isReading = false;
  client.transport.request = async (command, payload) => {
    if (command === 11 && !isReading) { isReading = true; await gate; }
    return original(command, payload);
  };
  client.onSubmit = async (request) => {
    queueMicrotask(() => client.notify(request, 10009));
    return new BinaryWriter(4).u32(0).finish();
  };
  const active = link.request('rates.get', { symbol: 'EURUSD', timeframe: 'M1', count: 1 });
  await until(() => isReading);
  const chart = link.request('rates.get', { symbol: 'EURUSD', timeframe: 'M5', count: 1 });
  const order = link.request('order.send', marketRequest);
  await until(() => client.submissions.length === 1);
  assert.equal((await order).isSuccess, true);
  release();
  await Promise.all([active, chart, order]);
  const commands = client.commands.filter((command) => command === 11 || command === 12);
  assert.deepEqual(commands, [12, 11, 11]);
});

test('a final order result returns before the background account refresh finishes', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const original = client.transport.request.bind(client.transport);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  client.transport.request = async (command, payload) => {
    if (command === 3) await gate;
    return original(command, payload);
  };
  const outcome = link.request('order.send', marketRequest);
  await until(() => client.submissions.length === 1);
  client.notify(client.submissions[0], 10009);
  const result = await Promise.race([outcome, new Promise<never>((_resolve, reject) => setImmediate(() => reject(new Error('Order result waited for account refresh'))))]);
  assert.equal(result.retcode, 10009);
  release();
  await link.request('terminal.status', {});
});

test('a quote request wakes on a tick without waiting for a polling timer', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const outcome = link.request('symbols.quote', { symbol: 'EURUSD' });
  await new Promise((resolve) => setImmediate(resolve));
  client.emit('tick', { symbol: 'EURUSD', timeMs: Date.now(), bid: 1.1, ask: 1.1002 });
  const quote = await Promise.race([outcome, new Promise<never>((_resolve, reject) => setImmediate(() => reject(new Error('Quote waited for a polling timer'))))]);
  assert.equal(quote.symbol, 'EURUSD');
  assert.ok(quote.ask > 0);
});

test('disconnect interrupts a pending quote wait', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const outcome = link.request('symbols.quote', { symbol: 'EURUSD' });
  const rejected = assert.rejects(outcome, /connection lost/i);
  await new Promise((resolve) => setImmediate(resolve));
  link.disconnect();
  await rejected;
});

test('cached trading prerequisites and orders bypass a held history request', { timeout: 1_000 }, async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  client.emit('tick', { symbol: 'EURUSD', timeMs: Date.now(), bid: 1.1, ask: 1.1002 });
  const original = client.transport.request.bind(client.transport);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let isReading = false;
  client.transport.request = async (command, payload) => {
    if (command === 5) { isReading = true; await gate; }
    return original(command, payload);
  };
  const history = link.request('history.get', { from: 0, to: 1700000000 });
  await until(() => isReading);
  const subscriptions = client.subscriptions.length;
  const [spec, valuation, quote, account] = await Promise.all([
    link.request('symbols.info', { symbol: 'EURUSD' }),
    link.request('symbols.valuation', { symbol: 'EURUSD' }),
    link.request('symbols.quote', { symbol: 'EURUSD' }),
    link.request('account.info', {}),
  ]);
  assert.equal(spec.name, 'EURUSD');
  assert.ok(valuation.moneyPerUnit > 0);
  assert.ok(quote.ask > 0);
  assert.equal(account?.login, 1234);
  assert.equal(client.subscriptions.length, subscriptions);
  const started = performance.now();
  const order = link.request('order.send', marketRequest);
  await until(() => client.submissions.length === 1);
  t.diagnostic(`Submission with held history: ${(performance.now() - started).toFixed(2)} ms (fixture)`);
  client.notify(client.submissions[0], 10009);
  assert.equal((await order).isSuccess, true);
  release();
  await history;
});

test('the next order is sent once the previous one is admitted, without waiting for its final result', { timeout: 1_000 }, async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const original = client.transport.request.bind(client.transport);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let isRefreshing = false;
  client.transport.request = async (command, payload) => {
    if (command === 3) { isRefreshing = true; await gate; }
    return original(command, payload);
  };
  let isFirstSettled = false;
  const first = link.request('order.send', marketRequest).finally(() => { isFirstSettled = true; });
  const second = link.request('order.send', { ...marketRequest, type: 'sell' });
  await until(() => client.submissions.length === 2);
  assert.ok(client.submissions[0].readUInt32LE(0) < client.submissions[1].readUInt32LE(0));
  client.notify(client.submissions[1], 10009);
  assert.equal((await second).isSuccess, true);
  assert.equal(isFirstSettled, false);
  client.notify(client.submissions[0], 10009);
  assert.equal((await first).isSuccess, true);
  await until(() => isRefreshing);
  const third = link.request('order.send', marketRequest);
  await until(() => client.submissions.length === 3);
  client.notify(client.submissions[2], 10009);
  assert.equal((await third).isSuccess, true);
  release();
  await link.request('trade.snapshot', {});
});

test('orders are admitted one at a time in submission order', { timeout: 1_000 }, async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  let admit!: () => void;
  client.onSubmit = (request) => client.submissions.length === 1
    ? new Promise((resolve) => { admit = () => resolve(new BinaryWriter(4).u32(0).finish()); })
    : Promise.resolve(new BinaryWriter(4).u32(0).finish());
  const first = link.request('order.send', marketRequest);
  const second = link.request('order.send', { ...marketRequest, type: 'sell' });
  await until(() => client.submissions.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(client.submissions.length, 1);
  admit();
  await until(() => client.submissions.length === 2);
  client.notify(client.submissions[0], 10009);
  client.notify(client.submissions[1], 10009);
  assert.equal((await first).isSuccess, true);
  assert.equal((await second).isSuccess, true);
});

test('login waits for existing orders and later orders cannot cross its barrier', { timeout: 1_000 }, async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const first = link.request('order.send', marketRequest);
  await until(() => client.submissions.length === 1);
  const login = link.request('account.login', { login: 5678, password: 'fixture-password' });
  const later = link.request('order.send', marketRequest);
  const rejected = assert.rejects(later, /Connection changed/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(client.isClosed, false);
  assert.equal(client.submissions.length, 1);
  client.notify(client.submissions[0], 10009);
  assert.equal((await first).isSuccess, true);
  assert.equal((await login).login, 5678);
  await rejected;
  assert.deepEqual(clients.at(-1)!.loginCalls, [5678n]);
  assert.equal(clients.at(-1)!.submissions.length, 0);
});

test('an account response cannot overwrite a newer trade transaction balance', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const original = client.transport.request.bind(client.transport);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  let isRefreshing = false;
  client.transport.request = async (command, payload) => {
    if (command !== 3) return original(command, payload);
    isRefreshing = true;
    await gate;
    return accountPayload(10000);
  };
  const snapshot = link.request('trade.snapshot', {});
  await until(() => isRefreshing);
  const transaction = new BinaryWriter(12 + WEB_DEAL_BYTES + WEB_POSITION_BYTES + 48)
    .u32(2).u32(4).u32(0).bytes(Buffer.alloc(WEB_DEAL_BYTES + WEB_POSITION_BYTES))
    .f64(10100).f64(5).bytes(Buffer.alloc(24)).u32(0).u32(0).finish();
  client.transport.emit('notification', { command: 10, status: 0, payload: transaction });
  assert.equal((await link.request('account.info', {}))?.balance, 10100);
  assert.equal((await link.request('account.info', {}))?.equity, 10105);
  release();
  assert.equal((await snapshot).account?.balance, 10100);
  assert.equal((await link.request('account.info', {}))?.credit, 5);
  assert.equal((await link.request('account.info', {}))?.equity, 10105);
});

test('existing stream subscriptions are reused across charts, watchlists and quotes', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  client.emit('tick', { symbol: 'EURUSD', timeMs: Date.now(), bid: 1.1, ask: 1.1002 });
  const before = client.subscriptions.length;
  await link.request('ticks.subscribe', { symbols: ['EURUSD'] });
  await link.request('rates.subscribe', { symbol: 'EURUSD', timeframe: 'M1' });
  await link.request('rates.subscribe', { symbol: 'EURUSD', timeframe: 'M5' });
  await link.request('symbols.quote', { symbol: 'EURUSD' });
  assert.equal(client.subscriptions.length, before);
});

test('failed stream subscriptions can be retried without poisoning the cache', async (t) => {
  const { link, clients } = fixture((client) => {
    const symbols = client.marketSymbols.bind(client);
    client.marketSymbols = async () => [...await symbols(), { id: 18, flags: 0, digits: 5, calcMode: 0, name: 'GBPJPY', path: 'Forex', basis: '', description: 'Pound Yen' }];
  });
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  client.detailsName = 'GBPJPY';
  const subscribe = client.subscribe.bind(client);
  let attempts = 0;
  client.subscribe = async (names) => {
    if (++attempts === 1) throw new Error('fixture subscription failed');
    return subscribe(names);
  };
  await assert.rejects(link.request('ticks.subscribe', { symbols: ['GBPJPY'] }), /subscription failed/);
  await link.request('ticks.subscribe', { symbols: ['GBPJPY'] });
  assert.equal(attempts, 2);
  assert.deepEqual(client.subscriptions.at(-1), ['GBPJPY', 'EURUSD']);
});

test('a name the broker does not list does not fail the other quote subscriptions', async (t) => {
  const { link, clients } = fixture();
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  const quotes = await link.request('ticks.subscribe', { symbols: ['EURUSD.m', 'EURUSD'] });
  assert.equal(quotes.length, 2);
  assert.ok(client.subscriptions.at(-1)!.includes('EURUSD'));
  assert.ok(!client.subscriptions.at(-1)!.includes('EURUSD.m'));
});

test('a chart subscription stays until the last chart showing that symbol and timeframe leaves', async (t) => {
  const { link, clients } = fixture((client) => {
    const symbols = client.marketSymbols.bind(client);
    client.marketSymbols = async () => [...await symbols(), { id: 18, flags: 0, digits: 5, calcMode: 0, name: 'GBPJPY', path: 'Forex', basis: '', description: 'Pound Yen' }];
  });
  t.after(() => link.disconnect());
  await loggedIn(link);
  const client = clients.at(-1)!;
  client.detailsName = 'GBPJPY';
  await link.request('rates.subscribe', { symbol: 'GBPJPY', timeframe: 'H1' });
  await link.request('rates.subscribe', { symbol: 'GBPJPY', timeframe: 'H1' });
  await link.request('rates.unsubscribe', { symbol: 'GBPJPY', timeframe: 'H1' });
  await link.request('ticks.subscribe', { symbols: ['EURUSD'] });
  assert.ok(client.subscriptions.at(-1)!.includes('GBPJPY'), 'the other chart still shows GBPJPY');
  await link.request('rates.unsubscribe', { symbol: 'GBPJPY', timeframe: 'H1' });
  await link.request('ticks.subscribe', { symbols: ['EURUSD'] });
  assert.ok(!client.subscriptions.at(-1)!.includes('GBPJPY'));
});
