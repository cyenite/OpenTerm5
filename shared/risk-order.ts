import type { PositionRule, RiskOrderRequest } from './automation';
import { orderType } from './protocol';
import { distanceToPrice, planRisk, type RiskPlan, type VolumeLimits } from './risk';

// How a risk order becomes orders: the entry, stop and targets, the volume split across targets,
// and the management each part gets. The live trade manager and the backtest both place what
// this plans, so a risk order sizes and behaves the same in either.

export interface RiskOrderContext {
  readonly quote: { readonly bid: number; readonly ask: number };
  readonly limits: VolumeLimits;
  readonly equity: number;
  readonly balance: number;
  readonly moneyPerUnit: number;
}

export type LegRule = Pick<PositionRule, 'breakEven' | 'trailing' | 'virtualStop' | 'virtualTarget'>;

export interface RiskOrderLeg {
  readonly lots: number;
  readonly takeProfit: number;
  // Management for this part, or null when it needs none.
  readonly rule: LegRule | null;
}

export interface RiskOrderPlan {
  readonly side: 'buy' | 'sell';
  readonly isPending: boolean;
  // Stops and targets stay off the broker and close at market.
  readonly isStealth: boolean;
  readonly entry: number;
  readonly stopLoss: number;
  readonly plan: RiskPlan;
  readonly legs: readonly RiskOrderLeg[];
}

// Throws with the reason when the order cannot be planned.
export function planRiskOrder(request: RiskOrderRequest, context: RiskOrderContext): RiskOrderPlan {
  const definition = orderType(request.type);
  if (!definition) throw new Error('Unknown order type');
  const { limits, quote } = context;
  const side = definition.isBuy ? 'buy' : 'sell';
  const entry = definition.isPending ? request.price ?? 0 : side === 'buy' ? quote.ask : quote.bid;
  if (definition.isPending && !(entry > 0)) throw new Error('Pending orders need a price');
  const stopLoss = request.stopLoss && request.stopLoss.value > 0 ? distanceToPrice(side, entry, request.stopLoss.value, request.stopLoss.unit, limits, true) : 0;
  const riskDistance = stopLoss ? Math.abs(entry - stopLoss) : 0;
  const targets = request.takeProfitR?.length
    ? request.takeProfitR.map((multiple, _index, all) => ({ price: Number((entry + (side === 'buy' ? 1 : -1) * multiple * riskDistance).toFixed(limits.digits)), share: 100 / all.length }))
    : (request.takeProfits ?? []).filter((target) => target.distance.value > 0).map((target) => ({ price: distanceToPrice(side, entry, target.distance.value, target.distance.unit, limits, false), share: target.share }));
  if (request.takeProfitR?.length && !riskDistance) throw new Error('R-multiple targets need a stop loss');
  const plan = planRisk({
    side, entry, stopLoss, mode: request.mode, value: request.value, limits, takeProfits: targets,
    balance: context.balance, equity: context.equity,
    moneyPerUnit: context.moneyPerUnit, maxLots: request.maxLots, commissionPerLot: request.commissionPerLot,
  });
  if (!plan.isValid) throw new Error(plan.warnings.join(' '));
  const management = request.management ?? {};
  const isStealth = !!management.isStealth;
  const firstTargetPoints = plan.legs[0]?.takeProfit ? Math.round(Math.abs(plan.legs[0].takeProfit - entry) / limits.point) : 0;
  const riskPoints = Math.round(riskDistance / limits.point);
  const legs = plan.legs.map((leg, index): RiskOrderLeg => {
    // With several targets, the parts after the first move to break-even when the first target's
    // distance is reached; otherwise at the break-even R multiple, if one is set.
    const breakEvenPoints = management.isBreakEvenAfterFirstTarget && index > 0 && firstTargetPoints ? firstTargetPoints : management.breakEvenR && riskPoints ? Math.round(management.breakEvenR * riskPoints) : 0;
    const hasRule = !!breakEvenPoints || !!management.trailing || isStealth;
    return {
      lots: leg.lots,
      takeProfit: leg.takeProfit,
      rule: hasRule ? {
        ...(breakEvenPoints ? { breakEven: { triggerPoints: breakEvenPoints, lockPoints: 1 } } : {}),
        ...(management.trailing ? { trailing: management.trailing } : {}),
        ...(isStealth && stopLoss ? { virtualStop: stopLoss } : {}),
        ...(isStealth && leg.takeProfit ? { virtualTarget: leg.takeProfit } : {}),
      } : null,
    };
  });
  return { side, isPending: definition.isPending, isStealth, entry, stopLoss, plan, legs };
}
