import type { Fetch } from './exchange-common';
import type { RawCandle, RawPerpMeta, RawSpotMeta } from './hyperliquid-models';

export const HYPERLIQUID_API = 'https://api.hyperliquid.xyz';

const TIMEOUT = 15_000;
const INFO_WEIGHT = 20;
const CANDLES_PER_WEIGHT = 60;

// Hyperliquid allows each IP 1200 request weight a minute. Requests wait for weight instead of
// being refused, so a layout full of charts loads a little slower rather than failing.
export class WeightBudget {
  private updatedAt: number;
  private available: number;

  constructor(
    private readonly capacity = 1200,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.updatedAt = now();
    this.available = capacity;
  }

  async take(weight: number): Promise<void> {
    for (;;) {
      this.refill();
      if (this.available >= weight) {
        this.available -= weight;
        return;
      }
      await this.sleep(Math.ceil((weight - this.available) * 60_000 / this.capacity));
    }
  }

  // Weight only known after the answer, such as candleSnapshot's charge per 60 candles.
  spend(weight: number): void {
    this.refill();
    this.available -= weight;
  }

  private refill(): void {
    const now = this.now();
    this.available = Math.min(this.capacity, this.available + (now - this.updatedAt) * this.capacity / 60_000);
    this.updatedAt = now;
  }
}

export class HyperliquidInfo {
  constructor(
    readonly baseUrl = HYPERLIQUID_API,
    private readonly fetcher: Fetch = fetch,
    private readonly budget = new WeightBudget(),
  ) {}

  perpMeta(): Promise<RawPerpMeta> {
    return this.post({ type: 'meta' });
  }

  spotMeta(): Promise<RawSpotMeta> {
    return this.post({ type: 'spotMeta' });
  }

  // Candles opening from `startTime` to `endTime` (epoch ms, both inclusive). Only the latest
  // 5000 of each interval exist; older ranges come back empty.
  async candles(coin: string, interval: string, startTime: number, endTime: number): Promise<RawCandle[]> {
    const candles = await this.post<RawCandle[]>({ type: 'candleSnapshot', req: { coin, interval, startTime, endTime } });
    this.budget.spend(Math.floor(candles.length / CANDLES_PER_WEIGHT));
    return candles;
  }

  private async post<T>(body: object): Promise<T> {
    await this.budget.take(INFO_WEIGHT);
    const response = await this.fetcher(`${this.baseUrl}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (response.status === 429) throw new Error('Hyperliquid rate limit reached. Wait a moment and try again.');
    if (!response.ok) throw new Error(`Hyperliquid answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return await response.json() as T;
  }
}
