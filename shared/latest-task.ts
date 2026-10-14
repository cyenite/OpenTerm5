interface Task<T> {
  readonly value: T;
  readonly revision: number;
}

export class LatestTask<T, R> {
  private revision = 0;
  private isRunning = false;
  private next?: Task<T>;

  constructor(
    private readonly run: (value: T) => Promise<R>,
    private readonly onError: (error: unknown, input: T) => void,
    private readonly onResult: (value: R, input: T) => void,
  ) {}

  submit(value: T): void {
    this.next = { value, revision: ++this.revision };
    if (this.isRunning) return;
    this.isRunning = true;
    void this.drain();
  }

  cancel(): void {
    this.revision++;
    this.next = undefined;
  }

  private async drain(): Promise<void> {
    while (this.next) {
      const task = this.next;
      this.next = undefined;
      try {
        const result = await this.run(task.value);
        if (task.revision === this.revision) this.onResult(result, task.value);
      } catch (error) {
        if (task.revision === this.revision) this.onError(error, task.value);
      }
    }
    this.isRunning = false;
  }
}
