// Hybrid logical clock stamps: wall milliseconds, a counter and the device id, fixed width so plain
// string comparison orders them. A device never issues a stamp at or below one it has seen, so a
// computer with a wrong clock still orders its edits after the ones it merged.
const HLC = /^(\d{13})\.(\d{4})\.([a-z0-9]{1,32})$/;
const DEVICE_ID = /^[a-z0-9]{1,32}$/;
const MAX_COUNTER = 9999;

export const isHlc = (value: unknown): value is string => typeof value === 'string' && HLC.test(value);

export const isDeviceId = (value: unknown): value is string => typeof value === 'string' && DEVICE_ID.test(value);

const format = (wall: number, counter: number, deviceId: string) => `${String(wall).padStart(13, '0')}.${String(counter).padStart(4, '0')}.${deviceId}`;

// The lowest stamp at a moment, for cut-offs such as tombstone pruning.
export const hlcAt = (time: number) => format(Math.max(0, Math.floor(time)), 0, '0');

export class HybridClock {
  private wall = 0;
  private counter = 0;

  constructor(private readonly deviceId: string, private readonly now: () => number = Date.now) {
    if (!isDeviceId(deviceId)) throw new Error('Invalid sync device id.');
  }

  tick(): string {
    const now = Math.floor(this.now());
    if (now > this.wall) [this.wall, this.counter] = [now, 0];
    else if (++this.counter > MAX_COUNTER) [this.wall, this.counter] = [this.wall + 1, 0];
    return format(this.wall, this.counter, this.deviceId);
  }

  observe(stamp: string): void {
    const match = HLC.exec(stamp);
    if (!match) throw new Error('Invalid sync clock stamp.');
    const [wall, counter] = [Number(match[1]), Number(match[2])];
    if (wall > this.wall || (wall === this.wall && counter > this.counter)) [this.wall, this.counter] = [wall, counter];
  }

  get last(): string {
    return format(this.wall, this.counter, this.deviceId);
  }
}
