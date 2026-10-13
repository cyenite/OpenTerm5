import { Component } from 'react';
import { isDrawing } from '../../lib/drawing-geometry';
import { closeDialog, tools, updateChart, workspace, type Drawing } from '../../lib/workspace';
import { Dialog } from './Dialog';

interface ObjectsProps { readonly chartId: string }
interface ObjectsState {
  error: string;
  selected: string;
  fields: Record<string, string>;
}

export class DrawingObjectsDialog extends Component<ObjectsProps, ObjectsState> {
  state: ObjectsState = { error: '', selected: '', fields: {} };
  private unsubscribe?: () => void;

  componentDidMount() { this.unsubscribe = workspace.subscribe(() => this.forceUpdate()); }
  componentWillUnmount() { this.unsubscribe?.(); }

  private select = (id: string) => {
    const drawing = workspace.get().charts.find((chart) => chart.id === this.props.chartId)?.drawings.find((entry) => entry.id === id);
    const fields: Record<string, string> = {};
    if (drawing?.kind === 'hline') fields.price = String(drawing.price);
    else if (drawing?.kind === 'vline') fields.time = String(drawing.time);
    else if (drawing) {
      fields.fromTime = String(drawing.from.time);
      fields.fromPrice = String(drawing.from.price);
      if ('to' in drawing) { fields.toTime = String(drawing.to.time); fields.toPrice = String(drawing.to.price); }
    }
    this.setState({ selected: id, fields, error: '' });
  };

  private save = () => {
    const chart = workspace.get().charts.find((entry) => entry.id === this.props.chartId);
    const drawing = chart?.drawings.find((entry) => entry.id === this.state.selected);
    if (!chart || !drawing) { this.setState({ error: 'The selected object no longer exists.' }); return; }
    const number = (name: string) => {
      const raw = this.state.fields[name]?.trim();
      const value = raw ? Number(raw) : NaN;
      if (!Number.isFinite(value)) throw new Error('Enter finite values for every coordinate.');
      return value;
    };
    try {
      const candidate: Drawing = drawing.kind === 'hline' ? { ...drawing, price: number('price') } : drawing.kind === 'vline' ? { ...drawing, time: number('time') } : drawing.kind === 'ray' ? { ...drawing, from: { time: number('fromTime'), price: number('fromPrice') } } : { ...drawing, from: { time: number('fromTime'), price: number('fromPrice') }, to: { time: number('toTime'), price: number('toPrice') } };
      if (!isDrawing(candidate)) throw new Error('Invalid object coordinates.');
      updateChart(chart.id, { drawings: chart.drawings.map((entry) => entry.id === candidate.id ? candidate : entry) });
      this.setState({ error: '' });
    } catch (reason) { this.setState({ error: reason instanceof Error ? reason.message : 'Object properties could not be saved.' }); }
  };

  private remove = (isAll: boolean) => {
    const chart = workspace.get().charts.find((entry) => entry.id === this.props.chartId);
    if (!chart) return;
    updateChart(chart.id, { drawings: isAll ? [] : chart.drawings.filter((entry) => entry.id !== this.state.selected) });
    this.setState({ selected: '', fields: {}, error: '' });
  };

  render() {
    const chart = workspace.get().charts.find((entry) => entry.id === this.props.chartId);
    const { error, fields, selected } = this.state;
    const drawing = chart?.drawings.find((entry) => entry.id === selected);
    const labels: Record<string, string> = { price: 'Price', time: 'Time (UTC)', fromTime: 'First anchor time (UTC)', fromPrice: 'First anchor price', toTime: 'Second anchor time (UTC)', toPrice: 'Second anchor price' };
    return (
      <Dialog title={`Objects: ${chart?.symbol ?? 'closed chart'}`} width={560}>
        <div className="order-form">
          <label className="field"><span>Object</span><select value={selected} onChange={(event) => this.select(event.target.value)}><option value="">Select an object</option>{chart?.drawings.map((entry) => <option key={entry.id} value={entry.id}>{tools.find((tool) => tool.key === entry.kind)?.label ?? entry.kind} · {entry.id}</option>)}</select></label>
          {!chart?.drawings.length && <p>No drawing objects on this chart.</p>}
          {drawing && Object.entries(fields).map(([name, value]) => {
            const isTime = name === 'time' || name.endsWith('Time');
            const milliseconds = Number(value) * 1000;
            const display = isTime ? !!value.trim() && Number.isFinite(milliseconds) && Math.abs(milliseconds) <= 8.64e15 ? new Date(milliseconds).toISOString().slice(0, 19) : '' : value;
            return <label className="field" key={name}><span>{labels[name]}</span><input type={isTime ? 'datetime-local' : 'number'} step={isTime ? '1' : 'any'} value={display} onChange={(event) => this.setState({ fields: { ...fields, [name]: isTime ? event.target.value ? String(Date.parse(`${event.target.value}Z`) / 1000) : '' : event.target.value } })} /></label>;
          })}
          {drawing?.kind === 'fibonacci' && <p className="is-muted">0% is the second anchor; 100% is the first. Levels extend to the right. Edit anchor coordinates to change direction and scale.</p>}
          {error && <p role="alert" className="is-loss">{error}</p>}
          <div className="dialog-actions">
            <button disabled={!chart?.drawings.length} onClick={() => this.remove(true)}>Delete all</button>
            <button disabled={!drawing} onClick={() => this.remove(false)}>Delete selected</button>
            <button disabled={!drawing} className="is-primary" onClick={this.save}>Apply properties</button>
            <button onClick={closeDialog}>Close</button>
          </div>
        </div>
      </Dialog>
    );
  }
}
