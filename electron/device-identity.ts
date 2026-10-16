import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface DeviceTraits {
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly platform: string;
  readonly language: string;
}

export function navigatorPlatform(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'win32') return 'Win32';
  if (platform === 'darwin') return 'MacIntel';
  return `Linux ${arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : arch}`;
}

// Version 2 seeds the hash with 128 random bits. Version 1 used the official web terminal's
// number up to 1,000,000, which strangers with the same screen, scale and language can share.
const SEED_VERSION = 2;

// Same recipe as the official web terminal: SHA-1 of platform, pixel ratio, language, screen and a
// stored random seed, truncated to 16 bytes.
export function deriveClientId(traits: DeviceTraits, seed: string): Buffer {
  const screen = `${Math.max(traits.width, traits.height)}x${Math.min(traits.width, traits.height)}`;
  const source = [traits.platform, traits.scale, traits.language, screen, seed].join(';');
  return createHash('sha1').update(source).digest().subarray(0, 16);
}

export function parseClientId(value: unknown): { cid: Buffer; hasWeakSeed: boolean } {
  const { cid, version } = (value ?? {}) as { cid?: unknown; version?: unknown };
  if (typeof cid !== 'string' || !/^[0-9a-f]{32}$/.test(cid)) throw new Error('Invalid client ID.');
  return { cid: Buffer.from(cid, 'hex'), hasWeakSeed: version !== SEED_VERSION };
}

export class DeviceIdentity {
  private current?: Buffer;
  private isWeak = false;

  constructor(private readonly file: string, private readonly traits: () => DeviceTraits) {}

  get clientId(): Buffer {
    if (!this.current) throw new Error('Device identity has not been loaded');
    return this.current;
  }

  get hasWeakSeed(): boolean {
    return this.isWeak;
  }

  async load(): Promise<Buffer> {
    try {
      const stored = parseClientId(JSON.parse(await fs.readFile(this.file, 'utf8')));
      this.current = stored.cid;
      this.isWeak = stored.hasWeakSeed;
      return this.current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Client ID unreadable, generating a new one');
      return this.regenerate();
    }
  }

  // Replaces a narrow-seed ID once; an ID that is already unique is kept, so asking at every
  // login never makes the computer look like a new device.
  async ensureUnique(): Promise<boolean> {
    if (!this.isWeak) return false;
    await this.regenerate();
    return true;
  }

  async regenerate(): Promise<Buffer> {
    const next = deriveClientId(this.traits(), randomBytes(16).toString('hex'));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ cid: next.toString('hex'), version: SEED_VERSION }, null, 2), { mode: 0o600 });
    this.current = next;
    this.isWeak = false;
    return next;
  }
}
