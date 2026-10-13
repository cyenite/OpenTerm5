import type { History } from '../../shared/protocol';

function csvCell(value: string | number): string {
  const raw = String(value);
  const text = typeof value === 'string' && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${text.replaceAll('"', '""')}"`;
}

export function historyCsv(history: History): string {
  const rows: (string | number)[][] = [['Record', 'Ticket', 'Time UTC', 'Symbol', 'Type', 'Entry / State', 'Volume', 'Price', 'Order', 'Position', 'Commission', 'Swap', 'Fee', 'Profit', 'Comment']];
  for (const deal of history.deals) {
    rows.push(['Deal', deal.ticket, new Date(deal.time).toISOString(), deal.symbol, deal.type, deal.entry, deal.volume, deal.price, deal.order, deal.positionId, deal.commission, deal.swap, deal.fee, deal.profit, deal.comment]);
  }
  for (const order of history.orders) {
    rows.push(['Order', order.ticket, new Date(order.time).toISOString(), order.symbol, order.type, order.state, order.volumeInitial, order.priceOpen, order.ticket, order.positionId, '', '', '', '', order.comment]);
  }
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadHistory(history: History): void {
  const blob = new Blob([historyCsv(history)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `terminal5-history-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
