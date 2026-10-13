import { togglePanel } from '../lib/commands';
import { cursor } from '../lib/cursor';
import { formatPrice, formatTime } from '../lib/format';
import { useStore } from '../lib/store';
import { Panel } from './Panel';

export function DataWindow() {
  const state = useStore(cursor, (current) => current);
  const { bar, digits } = state;
  const rows: [string, string][] = bar
    ? [
        ['Date', formatTime(bar.time * 1000, false).split(' ')[0]],
        ['Time', formatTime(bar.time * 1000, false).split(' ')[1]],
        ['Open', formatPrice(bar.open, digits)],
        ['High', formatPrice(bar.high, digits)],
        ['Low', formatPrice(bar.low, digits)],
        ['Close', formatPrice(bar.close, digits)],
        ['Tick Volume', String(bar.volume)],
        ...state.values.map((value): [string, string] => [value.label, value.value.toFixed(digits + 1)]),
      ]
    : [];

  return (
    <Panel title="Data Window" onClose={() => togglePanel('isDataWindowShown')}>
      <div className="scroll">
        <table className="grid details">
          <tbody>
            <tr>
              <th colSpan={2}>{state.symbol}</th>
            </tr>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th>{label}</th>
                <td className="num">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!bar && <p className="empty">Move the cursor over a chart</p>}
      </div>
    </Panel>
  );
}
