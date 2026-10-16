import type { Account, Deal } from '../shared/protocol';

export const account: Account = {
  name: 'Aaron Rono', server: 'MetaQuotes-Demo', company: 'MetaQuotes Ltd.', currency: 'USD', tradeMode: 'demo', login: 5012345,
  credit: 0, margin: 0, equity: 1000, profit: 0, balance: 1000, leverage: 100, marginFree: 1000, marginLevel: 0, isHedging: true, isTradeAllowed: true, utcOffsetSeconds: 10800,
};

export const deal = (ticket: number, time: number, patch: Partial<Deal> = {}): Deal => ({
  type: 'buy', entry: 'in', symbol: 'EURUSD', comment: '', fee: 0, swap: 0, time, order: ticket - 1000, price: 1.1008,
  ticket, volume: 1, profit: 0, positionId: 7001, commission: -3.5, ...patch,
});
