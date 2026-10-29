import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { SessionPool, type TradeGate, type TradingLink } from './session-pool';

class GatedLink extends EventEmitter {
  gate?: TradeGate;
  setTradeGate(gate: TradeGate | undefined) { this.gate = gate; }
}

test('every trade on the window link is refused for a data feed market before any other admission', () => {
  const ui = new GatedLink();
  const pool = new SessionPool(ui as unknown as TradingLink, () => undefined, () => new GatedLink() as unknown as TradingLink);
  pool.setAdmission(() => 'equity guard');
  assert.equal(ui.gate?.({ action: 'deal', symbol: 'HYPERLIQUID:BTC', type: 'buy', volume: 1 }), 'BTC is market data from another feed and cannot be traded on this account');
  assert.equal(ui.gate?.({ action: 'deal', symbol: 'BTCUSD', type: 'buy', volume: 1 }), null, 'no account is active, so admission is not asked');
  assert.equal(ui.gate?.({ action: 'remove', order: 7 }), null);
});
