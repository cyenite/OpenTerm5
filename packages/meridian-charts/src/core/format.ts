const pad = (value: number) => (value < 10 ? `0${value}` : String(value));

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Decimal places for a tick size: 0.00001 → 5, 0.25 → 2, 1 → 0.
export function precisionOf(tickSize: number): number {
  if (!(tickSize > 0)) return 2;
  const text = tickSize.toString();
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

export function formatPrice(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toFixed(Math.max(0, Math.min(10, precision)));
}

// Compact form for study values of any size: 1234567 → 1.235M.
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return '';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return `${(value / 1e9).toFixed(3)}B`;
  if (magnitude >= 1e6) return `${(value / 1e6).toFixed(3)}M`;
  if (magnitude >= 1e4) return `${(value / 1e3).toFixed(2)}K`;
  if (magnitude >= 100) return value.toFixed(2);
  if (magnitude >= 1) return value.toFixed(4);
  return value.toPrecision(4);
}

// Chart times are shown as given (the host decides the time zone of its bars).
export function formatCrosshairTime(time: number, intervalMs: number): string {
  const date = new Date(time);
  const day = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} '${pad(date.getUTCFullYear() % 100)}`;
  if (intervalMs >= 86_400_000) return day;
  const clock = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return intervalMs < 60_000 ? `${day} ${clock}:${pad(date.getUTCSeconds())}` : `${day} ${clock}`;
}

export function formatClock(time: number, hasSeconds: boolean): string {
  const date = new Date(time);
  const clock = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return hasSeconds ? `${clock}:${pad(date.getUTCSeconds())}` : clock;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const rest = seconds % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}` : `${pad(minutes)}:${pad(seconds % 60)}`;
}
