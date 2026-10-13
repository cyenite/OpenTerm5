const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function formatPrice(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value) || value === 0) {
    return '';
  }
  return value.toFixed(digits);
}

export function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return '';
  }
  const [whole, fraction] = Math.abs(value).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '-' : ''}${grouped}.${fraction}`;
}

export function formatVolume(value: number): string {
  return value.toFixed(2);
}

export function formatTime(milliseconds: number, hasSeconds = true): string {
  if (!milliseconds) {
    return '';
  }
  const date = new Date(milliseconds);
  const day = `${date.getUTCFullYear()}.${pad(date.getUTCMonth() + 1)}.${pad(date.getUTCDate())}`;
  const clock = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return hasSeconds ? `${day} ${clock}:${pad(date.getUTCSeconds())}` : `${day} ${clock}`;
}

export function formatClock(milliseconds: number): string {
  const date = new Date(milliseconds);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}
