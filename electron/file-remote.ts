import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../shared/sync';
import type { SyncRemote } from './sync-engine';

export const SYNC_FILE_EXTENSION = 'ot5sync';
const FORMAT = 'openterm5-sync-file';
const MAX_FILE_BYTES = 256 * 1024 * 1024;

interface SyncFile {
  readonly format: typeof FORMAT;
  readonly version: 1;
  readonly head: string;
  readonly files: Readonly<Record<string, string>>;
}

export class SyncFileUnavailableError extends Error {}

export class SyncFileDamagedError extends Error {}

// The whole sync repository in one file, for people without GitHub: on a USB stick, a NAS share or
// a synced folder. Its head is the hash of its contents, so a commit lands only on the version it
// was based on. A missing file reads as unavailable (a drive not plugged in), never as empty, so it
// cannot look like the repository was wiped.
export class FileRemote implements SyncRemote {
  constructor(private readonly file: string, private readonly isNew = false) {}

  async head(): Promise<string | null> {
    return (await this.load())?.head ?? null;
  }

  async read(commit: string, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>> {
    const current = await this.load();
    if (!current || current.head !== commit) throw new SyncFileUnavailableError('The sync file changed while it was being read. It will be read again.');
    return new Map(paths.map((item) => [item, item in current.files ? Buffer.from(current.files[item], 'base64') : null]));
  }

  async commit(parent: string | null, writes: ReadonlyMap<string, Buffer | null>): Promise<string | null> {
    const current = await this.load();
    if ((current?.head ?? null) !== parent) return null;
    const files: Record<string, string> = { ...current?.files };
    for (const [item, content] of writes) {
      if (content) files[item] = content.toString('base64');
      else delete files[item];
    }
    const head = createHash('sha256').update(canonicalJson(files)).digest('hex');
    const next: SyncFile = { format: FORMAT, version: 1, head, files };
    const temporary = `${this.file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await fs.rename(temporary, this.file);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw new SyncFileUnavailableError(`The sync file could not be written: ${(error as Error).message}`);
    }
    return head;
  }

  private async load(): Promise<SyncFile | null> {
    let text: string;
    try {
      const { size } = await fs.stat(this.file);
      if (size > MAX_FILE_BYTES) throw new SyncFileDamagedError('The sync file is too large to be one.');
      text = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (error instanceof SyncFileDamagedError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && this.isNew) {
        try { await fs.access(path.dirname(this.file)); return null; } catch { /* folder gone too */ }
      }
      throw new SyncFileUnavailableError(`The sync file ${path.basename(this.file)} is not available. Is its drive or folder connected?`);
    }
    let value: Partial<SyncFile>;
    try { value = JSON.parse(text) as Partial<SyncFile>; } catch { throw new SyncFileDamagedError('That file is not an OpenTerm5 sync file, or it is damaged.'); }
    if (value.format !== FORMAT || value.version !== 1 || typeof value.head !== 'string' || !value.files || typeof value.files !== 'object') {
      throw new SyncFileDamagedError('That file is not an OpenTerm5 sync file, or it is damaged.');
    }
    return value as SyncFile;
  }
}
