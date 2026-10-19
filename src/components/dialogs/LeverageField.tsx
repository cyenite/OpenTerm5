import { useEffect, useState } from 'react';
import { marginModes, type LeverageState } from '../../../shared/protocol';
import { floorLeverage, LIQUIDATION_BUFFER } from '../../../shared/leverage';
import { session, terminal } from '../../lib/session';
import { useStore } from '../../lib/store';
import { NumberField } from '../ui/Controls';

interface LeverageFieldProps {
  symbol: string;
  suggested?: number;
  onChanged: () => void;
}

// The exchange keeps leverage per symbol, and a change also re-margins an open position on it,
// so a new value is sent only when the trader confirms it.
export function LeverageField({ symbol, suggested, onChanged }: LeverageFieldProps) {
  const [draft, setDraft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LeverageState | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const hasPosition = useStore(session, (current) => current.positions.some((position) => position.symbol === symbol));
  useEffect(() => {
    let isCancelled = false;
    setState(null);
    setError(null);
    terminal.request('symbols.leverage', { symbol })
      .then((next) => { if (!isCancelled) { setState(next); setDraft(next.leverage); } })
      .catch((reason: Error) => { if (!isCancelled) setError(reason.message); });
    return () => { isCancelled = true; };
  }, [symbol]);
  const apply = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const next = await terminal.request('symbols.setLeverage', { symbol, leverage: draft });
      setState(next);
      setDraft(next.leverage);
      onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setIsBusy(false); }
  };
  const margin = marginModes.find((mode) => mode.key === state?.marginMode)?.label;
  const recommended = state && suggested !== undefined ? floorLeverage(suggested, state.leverageMin, state.leverageMax, state.leverageStep) : null;
  const hint = state
    ? `${margin ? `${margin} margin, ` : ''}${state.leverageMin}x to ${state.leverageMax}x. Changes margin and liquidation, not the risk.${hasPosition ? ` Also applies to your open ${symbol} position.` : ''}`
    : 'Reading the symbol leverage…';
  return (
    <div>
      <NumberField label="Leverage" value={draft} step={state?.leverageStep || 1} min={state?.leverageMin ?? 1} max={state?.leverageMax} suffix="x" hint={hint} onChange={setDraft} />
      {recommended !== null && recommended !== draft && (
        <button type="button" disabled={isBusy} title={`The highest leverage that keeps liquidation at least ${LIQUIDATION_BUFFER} stop distances from the entry, so the stop closes the trade first. With isolated margin, the margin is then about the money at risk.`} onClick={() => setDraft(recommended)}>
          Suggest {recommended}x
        </button>
      )}
      {state && draft !== state.leverage && <button type="button" disabled={isBusy || !(draft > 0)} onClick={() => void apply()}>{isBusy ? 'Setting…' : `Set ${draft}x on ${symbol}`}</button>}
      {error && <small className="is-loss" role="alert">{error}</small>}
    </div>
  );
}
