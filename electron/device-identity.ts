import { createHash, randomInt } from 'node:crypto';
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

// Same recipe as the official web terminal: SHA-1 of platform, pixel ratio, language, screen and a
// stored random number, truncated to 16 bytes.
export function deriveClientId(traits: DeviceTraits, seed: string): Buffer {
  const screen = `${Math.max(traits.width, traits.height)}x${Math.min(traits.width, traits.height)}`;
  const source = [traits.platform, traits.scale, traits.language, screen, seed].join(';');
  return createHash('sha1').update(source).digest().subarray(0, 16);
}

export function parseClientId(value: unknown): Buffer {
  const { cid } = (value ?? {}) as { cid?: unknown };
  if (typeof cid !== 'string' || !/^[0-9a-f]{32}$/.test(cid)) throw new Error('Invalid client ID.');
  return Buffer.from(cid, 'hex');
}

export class DeviceIdentity {
  private current?: Buffer;

  constructor(private readonly file: string, private readonly traits: () => DeviceTraits) {}

  get clientId(): Buffer {
    if (!this.current) throw new Error('Device identity has not been loaded');
    return this.current;
  }

  async load(): Promise<Buffer> {
    try {
      this.current = parseClientId(JSON.parse(await fs.readFile(this.file, 'utf8')));
      return this.current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Client ID unreadable, generating a new one');
      return this.regenerate();
    }
  }

  async regenerate(): Promise<Buffer> {
    const next = deriveClientId(this.traits(), String(randomInt(1_000_001)));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify({ cid: next.toString('hex') }, null, 2), { mode: 0o600 });
    this.current = next;
    return next;
  }
}
