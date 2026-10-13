import { promises as fs } from 'node:fs';
import path from 'node:path';

export class JsonStore<T> {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly parse: (value: unknown) => T, private readonly fallback: () => T) {}

  async load(): Promise<T> {
    try {
      return this.parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.fallback();
      throw new Error(`${path.basename(this.file)} could not be read: ${(error as Error).message}`);
    }
  }

  // Writes are serialised and atomic (temp file then rename) so a crash never
  // leaves a half-written file and two saves cannot interleave.
  save(value: T): Promise<void> {
    const next = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.file);
    });
    this.writing = next.catch(() => {});
    return next;
  }
}

export class JsonLog<T> {
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string, private readonly maxBytes = 5 * 1024 * 1024) {}

  append(entry: T): void {
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      try {
        const { size } = await fs.stat(this.file);
        if (size > this.maxBytes) await fs.rename(this.file, `${this.file}.1`);
      } catch { /* first write */ }
      await fs.appendFile(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    }).catch(() => {});
  }

  async tail(limit: number): Promise<T[]> {
    try {
      const lines = (await fs.readFile(this.file, 'utf8')).trim().split('\n').slice(-limit);
      return lines.flatMap((line) => { try { return [JSON.parse(line) as T]; } catch { return []; } });
    } catch { return []; }
  }
}
