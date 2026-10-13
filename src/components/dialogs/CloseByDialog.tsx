import { Component } from 'react';
import type { TradeResult } from '../../../shared/protocol';
import { formatVolume } from '../../lib/format';
import { sendOrder, session, type SessionState } from '../../lib/session';
import { closeDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';

interface CloseByDialogProps {
  readonly ticket: number;
}

interface CloseByDialogState {
  readonly isBusy: boolean;
  readonly positionBy: number;
  readonly result: TradeResult | null;
  readonly snapshot: SessionState;
}

export class CloseByDialog extends Component<CloseByDialogProps, CloseByDialogState> {
  private offSession?: () => void;
  state: CloseByDialogState = { isBusy: false, positionBy: 0, result: null, snapshot: session.get() };

  componentDidMount(): void { this.offSession = session.subscribe(() => this.setState({ snapshot: session.get() })); }
  componentWillUnmount(): void { this.offSession?.(); }

  private async submit(): Promise<void> {
    this.setState({ isBusy: true });
    const result = await sendOrder({ action: 'closeBy', position: this.props.ticket, positionBy: this.state.positionBy });
    this.setState({ result, isBusy: false });
  }

  render() {
    const snapshot = this.state.snapshot;
    const first = snapshot.positions.find((position) => position.ticket === this.props.ticket);
    const others = snapshot.positions.filter((position) => first && position.symbol === first.symbol && position.side !== first.side && position.volume > 0);
    const second = others.find((position) => position.ticket === this.state.positionBy);
    const canClose = snapshot.account?.isHedging && snapshot.account.isFifo === false && snapshot.status?.isTradeAllowed && snapshot.link.state === 'open' && first && second && !this.state.isBusy;
    return <Dialog title={`Close By #${this.props.ticket}`} width={470}>
      {this.state.result ? <>
        <p className={this.state.result.isSuccess ? 'is-profit' : 'is-loss'}>{this.state.result.comment} (retcode {this.state.result.retcode})</p>
        <div className="dialog-actions"><button onClick={closeDialog}>Close</button></div>
      </> : <>
        <p>Offset opposite positions in {first?.symbol ?? 'the same instrument'}. The smaller position closes; any remaining volume stays open.</p>
        {first && <p>#{first.ticket} · {first.side} · {formatVolume(first.volume)} lots</p>}
        <label className="field"><span>Opposite position</span><select value={this.state.positionBy || ''} onChange={(event) => this.setState({ positionBy: Number(event.target.value) })} disabled={this.state.isBusy}>
          <option value="">Select a position</option>
          {others.map((position) => <option key={position.ticket} value={position.ticket}>#{position.ticket} · {position.side} · {formatVolume(position.volume)} lots</option>)}
        </select></label>
        {!others.length && <p>No opposite position is currently available.</p>}
        {first && second && <p>Volume to offset: {formatVolume(Math.min(first.volume, second.volume))} lots</p>}
        <div className="dialog-actions"><button disabled={this.state.isBusy} onClick={closeDialog}>Cancel</button><button className="is-primary" disabled={!canClose} onClick={() => void this.submit()}>{this.state.isBusy ? 'Submitting…' : 'Close By'}</button></div>
      </>}
    </Dialog>;
  }
}
