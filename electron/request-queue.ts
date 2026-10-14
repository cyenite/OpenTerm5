interface QueuedRequest {
  readonly isBarrier: boolean;
  readonly isUrgent: boolean;
  readonly run: () => Promise<void>;
}

export class RequestQueue {
  private isRunning = false;
  private readonly requests: QueuedRequest[] = [];

  enqueue<T>(run: () => Promise<T>, isUrgent = false, isBarrier = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requests.push({ isUrgent, isBarrier, run: async () => {
        try { resolve(await run()); }
        catch (error) { reject(error); }
      } });
      if (this.isRunning) return;
      this.isRunning = true;
      queueMicrotask(() => void this.drain());
    });
  }

  private async drain(): Promise<void> {
    while (this.requests.length) {
      const barrier = this.requests.findIndex((request) => request.isBarrier);
      const limit = barrier < 0 ? this.requests.length : barrier;
      const urgent = this.requests.findIndex((request, index) => index < limit && request.isUrgent);
      const [request] = this.requests.splice(urgent < 0 ? 0 : urgent, 1);
      await request.run();
    }
    this.isRunning = false;
  }
}
