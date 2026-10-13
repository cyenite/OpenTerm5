import { signalActions, type Distance } from '../shared/automation';

export { signalActions };
import type { OrderTypeKey } from '../shared/protocol';

export type SignalAction = (typeof signalActions)[number]['key'];

const aliases: Record<string, SignalAction> = {
  long: 'buy', short: 'sell', exit: 'close', flat: 'close', close_long: 'close_buy', close_short: 'close_sell',
  buylimit: 'buy_limit', selllimit: 'sell_limit', buystop: 'buy_stop', sellstop: 'sell_stop', closeall: 'close_all',
  cancelall: 'cancel_all', be: 'breakeven', break_even: 'breakeven',
};

export const pendingTypes: Partial<Record<SignalAction, OrderTypeKey>> = {
  buy: 'buy', sell: 'sell', buy_limit: 'buyLimit', sell_limit: 'sellLimit', buy_stop: 'buyStop', sell_stop: 'sellStop',
};

export interface Signal {
  id?: string;
  scope: 'source' | 'symbol';
  action: SignalAction;
  symbol: string;
  secret?: string;
  comment?: string;
  stop?: Distance;
  targets: Distance[];
  targetR: number[];
  price?: number;
  lots?: number;
  ticket?: number;
  riskMoney?: number;
  riskPercent?: number;
  closePercent?: number;
  breakEvenR?: number;
  expirationMinutes?: number;
  trailing?: { startPoints: number; distancePoints: number; stepPoints: number };
}

export class SignalError extends Error {}

const MAX_TARGETS = 5;

function number(value: unknown, field: string, { min = 0, isPositive = true } = {}): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min || isPositive && parsed <= 0) throw new SignalError(`"${field}" must be a positive number`);
  return parsed;
}

function list(value: unknown, field: string): number[] {
  if (value === undefined || value === null || value === '') return [];
  const items = Array.isArray(value) ? value : String(value).split(/[,\s]+/).filter(Boolean);
  if (items.length > MAX_TARGETS) throw new SignalError(`"${field}" allows at most ${MAX_TARGETS} values`);
  return items.map((item) => number(item, field)!);
}

function text(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') throw new SignalError(`"${field}" must be text`);
  const result = String(value).trim();
  if (result.length > max) throw new SignalError(`"${field}" is longer than ${max} characters`);
  return result;
}

// Text form: "buy EURUSD risk=1 sl_pips=20 tp_r=1,2" for tools that cannot send JSON.
export function parseTextSignal(body: string): Record<string, unknown> {
  const [action, symbol, ...pairs] = body.trim().split(/\s+/);
  const result: Record<string, unknown> = { action, symbol };
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    if (!key || !rest.length) throw new SignalError(`Cannot read "${pair}"; use key=value`);
    result[key.toLowerCase()] = rest.join('=');
  }
  return result;
}

export function parseSignalBody(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (!trimmed) throw new SignalError('Empty signal');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value: unknown;
    try { value = JSON.parse(trimmed); }
    catch { throw new SignalError('Body is not valid JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SignalError('Signal must be a JSON object');
    return value as Record<string, unknown>;
  }
  return parseTextSignal(trimmed);
}

export function normalizeSignal(raw: Record<string, unknown>): Signal {
  const field = (...names: string[]) => names.map((name) => raw[name]).find((value) => value !== undefined && value !== null && value !== '');
  const rawAction = text(field('action', 'side', 'order'), 'action', 32)?.toLowerCase().replace(/[\s-]/g, '_');
  if (!rawAction) throw new SignalError('"action" is required');
  const action = (aliases[rawAction] ?? rawAction) as SignalAction;
  if (!signalActions.some((item) => item.key === action)) throw new SignalError(`Unknown action "${rawAction}"`);
  const symbol = text(field('symbol', 'ticker', 'instrument'), 'symbol', 64) ?? '';
  if (!symbol && action !== 'close_all' && action !== 'cancel_all') throw new SignalError('"symbol" is required');
  const distance = (price: string, points: string, pips: string): Distance | undefined => {
    const absolute = number(raw[price], price);
    if (absolute !== undefined) return { unit: 'price', value: absolute };
    const inPoints = number(raw[points], points);
    if (inPoints !== undefined) return { unit: 'points', value: inPoints };
    const inPips = number(raw[pips], pips);
    return inPips !== undefined ? { unit: 'pips', value: inPips } : undefined;
  };
  const targets: Distance[] = [
    ...list(raw.tp, 'tp').map((value) => ({ unit: 'price' as const, value })),
    ...list(raw.tp_points, 'tp_points').map((value) => ({ unit: 'points' as const, value })),
    ...list(raw.tp_pips, 'tp_pips').map((value) => ({ unit: 'pips' as const, value })),
  ];
  const targetR = list(raw.tp_r, 'tp_r');
  if (targets.length && targetR.length) throw new SignalError('Use either tp prices/distances or tp_r, not both');
  if (targets.length > MAX_TARGETS) throw new SignalError(`At most ${MAX_TARGETS} take-profit levels are allowed`);
  const trailingDistance = number(raw.trailing_points, 'trailing_points');
  const scope = text(raw.scope, 'scope', 16);
  if (scope && scope !== 'source' && scope !== 'symbol') throw new SignalError('"scope" must be "source" or "symbol"');
  const closePercent = number(raw.close_percent, 'close_percent');
  if (closePercent !== undefined && closePercent > 100) throw new SignalError('"close_percent" cannot exceed 100');
  const riskPercent = number(field('risk', 'risk_percent'), 'risk');
  if (riskPercent !== undefined && riskPercent > 100) throw new SignalError('"risk" is a percentage and cannot exceed 100');
  return {
    action, symbol, targets, targetR,
    scope: scope === 'symbol' ? 'symbol' : 'source',
    id: text(field('id', 'signal_id', 'idempotency_key'), 'id', 128),
    secret: text(field('secret', 'passphrase', 'token'), 'secret', 256),
    comment: text(raw.comment, 'comment', 31),
    stop: distance('sl', 'sl_points', 'sl_pips'),
    price: number(raw.price, 'price'),
    lots: number(field('volume', 'lots', 'qty', 'quantity'), 'volume'),
    ticket: number(raw.ticket, 'ticket'),
    riskMoney: number(raw.risk_money, 'risk_money'),
    riskPercent, closePercent,
    breakEvenR: number(raw.breakeven_r, 'breakeven_r'),
    expirationMinutes: number(raw.expiration_minutes, 'expiration_minutes'),
    trailing: trailingDistance ? { distancePoints: trailingDistance, startPoints: number(raw.trailing_start_points, 'trailing_start_points', { isPositive: false }) ?? trailingDistance, stepPoints: number(raw.trailing_step_points, 'trailing_step_points') ?? 10 } : undefined,
  };
}

export function mapSymbol(symbol: string, map: Record<string, string>, suffix: string): string {
  if (!symbol) return symbol;
  if (map[symbol]) return map[symbol];
  const bare = symbol.includes(':') ? symbol.slice(symbol.lastIndexOf(':') + 1) : symbol;
  if (map[bare]) return map[bare];
  const cleaned = bare.replace(/\.P$|PERP$/i, '');
  return suffix && !cleaned.endsWith(suffix) ? `${cleaned}${suffix}` : cleaned;
}
