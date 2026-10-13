import { randomBytes } from 'node:crypto';

export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

function checkSize(size: number, maximum = MAX_FRAME_BYTES): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > maximum) {
    throw new RangeError(`Invalid binary size: ${size}`);
  }
}

function checkInteger(value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Integer outside binary field range: ${value}`);
  }
}

function copyBytes(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes);
}

export class BinaryWriter {
  private offset = 0;
  private readonly buffer: Buffer;

  constructor(size: number) {
    checkSize(size);
    this.buffer = Buffer.alloc(size);
  }

  private reserve(size: number): number {
    checkSize(size);
    if (size > this.buffer.length - this.offset) throw new RangeError('Binary write exceeds buffer');
    const offset = this.offset;
    this.offset += size;
    return offset;
  }

  u8(value: number): this {
    checkInteger(value, 0, 0xff);
    this.buffer.writeUInt8(value, this.reserve(1));
    return this;
  }

  u16(value: number): this {
    checkInteger(value, 0, 0xffff);
    this.buffer.writeUInt16LE(value, this.reserve(2));
    return this;
  }

  u32(value: number): this {
    checkInteger(value, 0, 0xffffffff);
    this.buffer.writeUInt32LE(value, this.reserve(4));
    return this;
  }

  i32(value: number): this {
    checkInteger(value, -0x80000000, 0x7fffffff);
    this.buffer.writeInt32LE(value, this.reserve(4));
    return this;
  }

  u64(value: bigint): this {
    if (typeof value !== 'bigint' || value < 0n || value > 0xffffffffffffffffn) {
      throw new RangeError('Unsigned 64-bit value outside binary field range');
    }
    this.buffer.writeBigUInt64LE(value, this.reserve(8));
    return this;
  }

  i64(value: bigint): this {
    if (typeof value !== 'bigint' || value < -0x8000000000000000n || value > 0x7fffffffffffffffn) {
      throw new RangeError('Signed 64-bit value outside binary field range');
    }
    this.buffer.writeBigInt64LE(value, this.reserve(8));
    return this;
  }

  f64(value: number): this {
    if (!Number.isFinite(value)) throw new RangeError('Binary float must be finite');
    this.buffer.writeDoubleLE(value, this.reserve(8));
    return this;
  }

  bytes(value: Uint8Array): this {
    this.buffer.set(value, this.reserve(value.byteLength));
    return this;
  }

  fixedString(value: string, byteLength: number): this {
    checkSize(byteLength);
    if (byteLength % 2 !== 0) throw new RangeError('UTF-16 field must have an even byte length');
    if (value.includes('\0')) throw new RangeError('Fixed string cannot contain a null character');
    if (value.length > byteLength / 2) throw new RangeError('Fixed string exceeds field');
    const offset = this.reserve(byteLength);
    this.buffer.write(value, offset, byteLength, 'utf16le');
    return this;
  }

  finish(): Buffer {
    if (this.offset !== this.buffer.length) throw new RangeError('Binary write did not fill buffer');
    return copyBytes(this.buffer);
  }
}

export class BinaryReader {
  private offset = 0;
  private readonly buffer: Buffer;

  constructor(bytes: Uint8Array) {
    checkSize(bytes.byteLength);
    this.buffer = copyBytes(bytes);
  }

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  private reserve(size: number): number {
    checkSize(size);
    if (size > this.remaining) throw new RangeError('Truncated binary field');
    const offset = this.offset;
    this.offset += size;
    return offset;
  }

  u8(): number { return this.buffer.readUInt8(this.reserve(1)); }
  u16(): number { return this.buffer.readUInt16LE(this.reserve(2)); }
  u32(): number { return this.buffer.readUInt32LE(this.reserve(4)); }
  i32(): number { return this.buffer.readInt32LE(this.reserve(4)); }
  u64(): bigint { return this.buffer.readBigUInt64LE(this.reserve(8)); }
  i64(): bigint { return this.buffer.readBigInt64LE(this.reserve(8)); }
  f64(): number { return this.buffer.readDoubleLE(this.reserve(8)); }

  bytes(size: number): Buffer {
    const offset = this.reserve(size);
    return copyBytes(this.buffer.subarray(offset, offset + size));
  }

  fixedString(byteLength: number): string {
    checkSize(byteLength);
    if (byteLength % 2 !== 0) throw new RangeError('UTF-16 field must have an even byte length');
    const bytes = this.bytes(byteLength);
    let end = bytes.length;
    for (let offset = 0; offset < bytes.length; offset += 2) {
      if (bytes.readUInt16LE(offset) === 0) {
        end = offset;
        break;
      }
    }
    return bytes.toString('utf16le', 0, end);
  }

  finish(): void {
    if (this.remaining !== 0) throw new RangeError('Unexpected trailing binary data');
  }
}

export function encodeFrame(ciphertext: Uint8Array): Buffer {
  checkSize(ciphertext.byteLength, MAX_FRAME_BYTES - 8);
  return new BinaryWriter(ciphertext.byteLength + 8).u32(ciphertext.byteLength).u32(1).bytes(ciphertext).finish();
}

export function decodeFrame(frame: Uint8Array, expectedMarker: 0 | 1 = 0): Buffer {
  checkInteger(expectedMarker, 0, 1);
  const reader = new BinaryReader(frame);
  const length = reader.u32();
  const marker = reader.u32();
  if (marker !== expectedMarker) throw new RangeError(`Invalid frame marker: ${marker}`);
  if (length !== reader.remaining) throw new RangeError('Frame length does not match payload');
  return reader.bytes(length);
}

export function encodeCommand(command: number, payload: Uint8Array, noise: Uint8Array = randomBytes(2)): Buffer {
  checkInteger(command, 0, 0xffff);
  checkSize(payload.byteLength, MAX_FRAME_BYTES - 4);
  if (noise.byteLength !== 2) throw new RangeError('Command requires exactly two noise bytes');
  return new BinaryWriter(payload.byteLength + 4).bytes(noise).u16(command).bytes(payload).finish();
}

export interface CommandResponse {
  readonly status: number;
  readonly command: number;
  readonly payload: Buffer;
}

export function decodeResponse(plaintext: Uint8Array): CommandResponse {
  const reader = new BinaryReader(plaintext);
  reader.bytes(2);
  const command = reader.u16();
  const status = reader.u8();
  return Object.freeze({ command, status, payload: reader.bytes(reader.remaining) });
}
