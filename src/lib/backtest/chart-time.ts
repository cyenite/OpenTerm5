// Chart times are the broker's clock written as UTC, so date fields read and write them as UTC.

export const chartTimeInput = (time: number) => new Date(time).toISOString().slice(0, 16);

export function parseChartTimeInput(value: string): number | null {
  const time = Date.parse(`${value}Z`);
  return Number.isFinite(time) ? time : null;
}

export function formatDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
