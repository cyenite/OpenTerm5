import { Component } from 'react';
import { drawingToolInfo } from '@meridian/charts';
import { chartObjects, drawingsForSymbol, replaceChartObjects, symbolDrawings } from '../../lib/symbol-drawings';
import { closeDialog, layoutDrawings, workspace, type Drawing } from '../../lib/workspace';
import { Dialog } from './Dialog';

interface ObjectsProps { readonly chartId: string }
interface ObjectsState {
  error: string;
  selected: string;
  // Anchor fields as typed: time in seconds since the epoch (UTC) and price.
  anchors: { time: string; price: string }[];
}

function drawingLabel(drawing: Drawing): string {
  return drawingToolInfo.get(drawing.type)?.label ?? drawing.type;
}

export class DrawingObjectsDialog extends Component<ObjectsProps, ObjectsState> {
  state: ObjectsState = { error: '', selected: '', anchors: [] };
  private unsubscribe?: () => void;

  private unsubscribeSymbols?: () => void;

  componentDidMount() {
    this.unsubscribe = workspace.subscribe(() => this.forceUpdate());
    this.unsubscribeSymbols = symbolDrawings.subscribe(() => this.forceUpdate());
  }

  componentWillUnmount() {
    this.unsubscribe?.();
    this.unsubscribeSymbols?.();
  }

  private chart() {
    return workspace.get().charts.find((chart) => chart.id === this.props.chartId);
  }

  private select = (id: string) => {
    const chart = this.chart();
    const drawing = chart && chartObjects(chart).find((entry) => entry.id === id);
    const anchors = (drawing?.anchors ?? []).map((anchor) => ({ time: String(Math.round(anchor.time / 1000)), price: String(anchor.price) }));
    this.setState({ selected: id, anchors, error: '' });
  };

  private save = () => {
    const chart = this.chart();
    const objects = chart ? chartObjects(chart) : [];
    const drawing = objects.find((entry) => entry.id === this.state.selected);
    if (!chart || !drawing) { this.setState({ error: 'The selected object no longer exists.' }); return; }
    const anchors = this.state.anchors.map((anchor) => ({ time: Number(anchor.time) * 1000, price: Number(anchor.price) }));
    if (!anchors.every((anchor) => Number.isFinite(anchor.time) && Number.isFinite(anchor.price))) { this.setState({ error: 'Enter finite values for every coordinate.' }); return; }
    replaceChartObjects(chart, objects.map((entry) => entry.id === drawing.id ? { ...entry, anchors } : entry));
    this.setState({ error: '' });
  };

  private remove = (isAll: boolean) => {
    const chart = this.chart();
    if (!chart) return;
    replaceChartObjects(chart, isAll ? [] : chartObjects(chart).filter((entry) => entry.id !== this.state.selected));
    this.setState({ selected: '', anchors: [], error: '' });
  };

  private setAnchor(index: number, field: 'time' | 'price', value: string) {
    this.setState(({ anchors }) => ({ anchors: anchors.map((anchor, position) => position === index ? { ...anchor, [field]: value } : anchor) }));
  }

  render() {
    const chart = this.chart();
    const { error, anchors, selected } = this.state;
    const objects = chart ? chartObjects(chart) : [];
    const symbolIds = new Set(chart ? drawingsForSymbol(symbolDrawings.get(), chart.symbol).map((entry) => entry.id) : []);
    const tabIds = new Set(chart ? layoutDrawings(workspace.get(), chart).map((entry) => entry.id) : []);
    const scope = (id: string) => symbolIds.has(id) ? `every ${chart?.symbol} chart` : tabIds.has(id) ? `${chart?.symbol} charts in this tab` : id;
    const drawing = objects.find((entry) => entry.id === selected);
    return (
      <Dialog title={`Objects: ${chart?.symbol ?? 'closed chart'}`} width={560}>
        <div className="order-form">
          <label className="field"><span>Object</span><select value={selected} onChange={(event) => this.select(event.target.value)}><option value="">Select an object</option>{objects.map((entry) => <option key={entry.id} value={entry.id}>{drawingLabel(entry)} · {scope(entry.id)}</option>)}</select></label>
          {!objects.length && <p>No drawing objects on this chart.</p>}
          {drawing && anchors.map((anchor, index) => {
            const milliseconds = Number(anchor.time) * 1000;
            const display = anchor.time.trim() && Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8.64e15 ? new Date(milliseconds).toISOString().slice(0, 19) : '';
            const name = anchors.length > 1 ? `Anchor ${index + 1} ` : '';
            return (
              <div key={index} className="stack">
                {drawing.type !== 'hline' && <label className="field"><span>{name}time (UTC)</span><input type="datetime-local" step="1" value={display} onChange={(event) => this.setAnchor(index, 'time', event.target.value ? String(Date.parse(`${event.target.value}Z`) / 1000) : '')} /></label>}
                {drawing.type !== 'vline' && <label className="field"><span>{name}price</span><input type="number" step="any" value={anchor.price} onChange={(event) => this.setAnchor(index, 'price', event.target.value)} /></label>}
              </div>
            );
          })}
          {error && <p role="alert" className="is-loss">{error}</p>}
          <div className="dialog-actions">
            <button disabled={!objects.length} onClick={() => this.remove(true)}>Delete all</button>
            <button disabled={!drawing} onClick={() => this.remove(false)}>Delete selected</button>
            <button disabled={!drawing} className="is-primary" onClick={this.save}>Apply properties</button>
            <button onClick={closeDialog}>Close</button>
          </div>
        </div>
      </Dialog>
    );
  }
}
