import { useState } from 'react';
import type { PartialTarget, PositionRule } from '../../../shared/automation';
import { pipFactor } from '../../../shared/valuation';
import { automation, automationStore } from '../../lib/automation';
import { formatPrice, formatVolume } from '../../lib/format';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { closeDialog } from '../../lib/workspace';
import { NumberField, Switch } from '../ui/Controls';
import { Dialog } from './Dialog';

interface ManagePositionDialogProps {
  ticket: number;
}

const toLocalInput = (time?: number) => {
  if (!time) return '';
  const date = new Date(time);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ManagePositionDialog({ ticket }: ManagePositionDialogProps) {
  const position = useStore(session, (state) => state.positions.find((item) => item.ticket === ticket));
  const accountId = useStore(session, (state) => state.profileId);
  const spec = useStore(session, (state) => (position ? state.symbols[position.symbol] : undefined));
  const existing = useStore(automationStore, (state) => state.manager.rules.find((rule) => rule.accountId === accountId && rule.ticket === ticket));
  const riskPoints = position?.sl && spec ? Math.round(Math.abs(position.priceOpen - position.sl) / spec.point) : 0;
  const [isBreakEven, setIsBreakEven] = useState(!!existing?.breakEven);
  const [breakEven, setBreakEven] = useState(existing?.breakEven ?? { triggerPoints: riskPoints || 200, lockPoints: 10 });
  const [isTrailing, setIsTrailing] = useState(!!existing?.trailing);
  const [trailing, setTrailing] = useState(existing?.trailing ?? { startPoints: riskPoints || 200, distancePoints: riskPoints || 200, stepPoints: 10 });
  const [partials, setPartials] = useState<PartialTarget[]>(existing?.partials ?? []);
  const [virtualStop, setVirtualStop] = useState(existing?.virtualStop ?? 0);
  const [virtualTarget, setVirtualTarget] = useState(existing?.virtualTarget ?? 0);
  const [closeAt, setCloseAt] = useState(toLocalInput(existing?.closeAt));
  const [error, setError] = useState<string | null>(null);

  if (!position || !accountId || !spec) {
    return <Dialog title={`Manage #${ticket}`}><p className="empty">This position is no longer open.</p></Dialog>;
  }
  const pips = (points: number) => `${(points / pipFactor(spec.digits)).toFixed(1)} pips`;
  const save = () => {
    const direction = position.side === 'buy' ? 1 : -1;
    if (virtualStop && direction * (position.priceCurrent - virtualStop) <= 0) return setError('The hidden stop is already behind the current price.');
    if (virtualTarget && direction * (virtualTarget - position.priceCurrent) <= 0) return setError('The hidden target is already behind the current price.');
    if (partials.reduce((sum, item) => sum + item.percent, 0) > 100) return setError('Partial closes add up to more than 100%.');
    const rule: PositionRule = {
      accountId, ticket, symbol: position.symbol, side: position.side, createdAt: existing?.createdAt ?? Date.now(),
      initialVolume: existing?.initialVolume ?? position.volume, partials: [...partials].sort((left, right) => left.points - right.points),
      ...(isBreakEven ? { breakEven: { ...breakEven, isDone: existing?.breakEven?.isDone } } : {}),
      ...(isTrailing ? { trailing } : {}),
      ...(virtualStop ? { virtualStop } : {}),
      ...(virtualTarget ? { virtualTarget } : {}),
      ...(closeAt ? { closeAt: new Date(closeAt).getTime() } : {}),
    };
    automation.request('manager.setRule', rule).then(closeDialog).catch((reason: Error) => setError(reason.message));
  };
  return (
    <Dialog title={`Manage #${ticket} ${position.side} ${formatVolume(position.volume)} ${position.symbol}`} width={560}>
      <div className="stack">
        <p className="is-muted">
          Open {formatPrice(position.priceOpen, spec.digits)}, now {formatPrice(position.priceCurrent, spec.digits)}{riskPoints ? `, stop ${riskPoints} points (1R)` : ', no stop loss'}. Distances are in points ({pips(10)} = 10 points).
        </p>
        <Switch label="Move stop to break-even" isOn={isBreakEven} onChange={setIsBreakEven} />
        {isBreakEven && (
          <div className="form-grid">
            <NumberField label="When profit reaches" value={breakEven.triggerPoints} suffix="pts" hint={pips(breakEven.triggerPoints)} onChange={(triggerPoints) => setBreakEven({ ...breakEven, triggerPoints })} />
            <NumberField label="Lock in" value={breakEven.lockPoints} suffix="pts" hint="Beyond the entry, to cover costs." onChange={(lockPoints) => setBreakEven({ ...breakEven, lockPoints })} />
          </div>
        )}
        <Switch label="Trailing stop" isOn={isTrailing} onChange={setIsTrailing} />
        {isTrailing && (
          <div className="form-grid">
            <NumberField label="Start after profit of" value={trailing.startPoints} suffix="pts" hint={pips(trailing.startPoints)} onChange={(startPoints) => setTrailing({ ...trailing, startPoints })} />
            <NumberField label="Trail distance" value={trailing.distancePoints} suffix="pts" hint={pips(trailing.distancePoints)} onChange={(distancePoints) => setTrailing({ ...trailing, distancePoints })} />
            <NumberField label="Step" value={trailing.stepPoints} suffix="pts" hint="Minimum move before the stop is modified." onChange={(stepPoints) => setTrailing({ ...trailing, stepPoints })} />
          </div>
        )}
        <div className="form-field">
          <span>Partial take profits</span>
          {partials.map((partial, index) => (
            <div className="hours-row" key={index}>
              <span>Close</span>
              <input aria-label="Percent" type="number" min={1} max={100} value={partial.percent} onChange={(event) => setPartials(partials.map((item, position) => position === index ? { ...item, percent: Number(event.target.value) } : item))} />
              <span>% at +</span>
              <input aria-label="Points" type="number" min={1} value={partial.points} onChange={(event) => setPartials(partials.map((item, position) => position === index ? { ...item, points: Number(event.target.value) } : item))} />
              <span>pts{partial.isDone ? ' (done)' : ''}</span>
              <button type="button" className="link-button" onClick={() => setPartials(partials.filter((_, position) => position !== index))}>Remove</button>
            </div>
          ))}
          <div className="button-row">
            <button type="button" disabled={partials.length >= 4} onClick={() => setPartials([...partials, { points: (riskPoints || 200) * (partials.length + 1), percent: 50 }])}>Add partial</button>
            {riskPoints > 0 && <button type="button" onClick={() => setPartials([{ points: riskPoints, percent: 50 }, { points: riskPoints * 2, percent: 25 }])}>50% at 1R, 25% at 2R</button>}
          </div>
        </div>
        <div className="form-grid">
          <NumberField label="Hidden stop loss" value={virtualStop} step={spec.point} hint="Closed at market by OpenTerm5; the broker never sees it." onChange={setVirtualStop} />
          <NumberField label="Hidden take profit" value={virtualTarget} step={spec.point} onChange={setVirtualTarget} />
          <label className="form-field">
            <span>Close at</span>
            <input type="datetime-local" value={closeAt} onChange={(event) => setCloseAt(event.target.value)} />
            <small>Local time. Leave empty for none.</small>
          </label>
        </div>
        {(virtualStop > 0 || virtualTarget > 0) && <p className="banner is-warn">Hidden levels only work while OpenTerm5 is running and connected.</p>}
        {error && <p className="banner is-bad">{error}</p>}
        <div className="dialog-actions">
          {existing && <button type="button" onClick={() => automation.request('manager.removeRule', { accountId, ticket }).then(closeDialog)}>Stop managing</button>}
          <button type="button" onClick={closeDialog}>Cancel</button>
          <button type="button" className="is-primary" onClick={save}>Save</button>
        </div>
      </div>
    </Dialog>
  );
}
