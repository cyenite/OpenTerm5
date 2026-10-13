import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { decodeFrame, decodeResponse, encodeCommand, encodeFrame, MAX_FRAME_BYTES } from './mt5-web-codec';

const bootstrapKey = Buffer.from(
  [...'13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75']
    .map((character) => String.fromCharCode(character.charCodeAt(0) - 1)).join(''),
  'hex',
);

export enum WebCommand {
  handshake = 0,
  login = 28,
  configuration = 29,
  traderParameters = 41,
  ping = 51,
}

interface PendingResponse {
  readonly sentAt: number;
  readonly timer: NodeJS.Timeout;
  readonly reject: (error: Error) => void;
  readonly resolve: (payload: Buffer) => void;
}

export interface WebSession {
  readonly version: number;
  readonly endpoint: string;
}

export class WebProtocolError extends Error {
  constructor(readonly command: number, readonly status: number) {
    super(`MT5 web command ${command} returned status ${status}`);
  }
}

export function encryptPayload(payload: Uint8Array, key: Uint8Array): Buffer {
  const cipher = createCipheriv('aes-256-cbc', key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(payload), cipher.final()]);
}

export function decryptPayload(payload: Uint8Array, key: Uint8Array): Buffer {
  const cipher = createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
  return Buffer.concat([cipher.update(payload), cipher.final()]);
}

export class Mt5WebTransport extends EventEmitter {
  private key = Buffer.from(bootstrapKey);
  private isReady = false;
  private socket?: WebSocket;
  private readonly pending = new Map<number, PendingResponse>();

  constructor(
    readonly endpoint: string,
    readonly timeoutMs = 15_000,
    private readonly openSocket = (url: string, options: WebSocket.ClientOptions) => new WebSocket(url, options),
  ) {
    super();
    const url = new URL(endpoint);
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash) {
      throw new Error('MT5 web endpoint must be a WSS URL without credentials or fragments');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error('Request timeout must be a positive integer');
    }
  }

  async connect(): Promise<WebSession> {
    if (this.socket) throw new Error('Transport already has a connection');
    this.key = Buffer.from(bootstrapKey);
    const url = new URL(this.endpoint);
    const socket = this.openSocket(this.endpoint, {
      origin: `https://${url.host}`,
      maxPayload: MAX_FRAME_BYTES,
      handshakeTimeout: this.timeoutMs,
    });
    this.socket = socket;
    socket.on('message', (raw, isBinary) => {
      if (socket !== this.socket) return;
      try {
        if (!isBinary) throw new Error('MT5 web server sent an unexpected text frame');
        const frame = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer);
        const response = decodeResponse(decryptPayload(decodeFrame(frame), this.key));
        const pending = this.pending.get(response.command);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(response.command);
          this.emit('latency', Math.max(0, Date.now() - pending.sentAt));
          if (response.status) pending.reject(new WebProtocolError(response.command, response.status));
          else pending.resolve(response.payload);
        } else {
          this.emit('notification', response);
        }
      } catch (error) {
        this.close(error instanceof Error ? error : new Error('Invalid server frame'));
      }
    });
    socket.on('error', (error) => { if (socket === this.socket) this.close(error); });
    socket.on('close', (code) => { if (socket === this.socket) this.close(new Error(`MT5 web connection closed (${code})`)); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('MT5 WebSocket opening timed out')), this.timeoutMs);
        const opened = () => { clearTimeout(timer); socket.off('error', failed); socket.off('close', closed); resolve(); };
        const failed = (error: Error) => { clearTimeout(timer); socket.off('open', opened); socket.off('close', closed); reject(error); };
        const closed = () => failed(new Error('MT5 WebSocket closed before opening'));
        socket.once('open', opened);
        socket.once('error', failed);
        socket.once('close', closed);
      });
      const hello = await this.request(WebCommand.handshake, Buffer.alloc(64));
      if (hello.length !== 98) throw new Error(`Unexpected MT5 handshake body length: ${hello.length}`);
      this.key = Buffer.from(hello.subarray(66));
      this.isReady = true;
      return { endpoint: this.endpoint, version: hello.readUInt16LE() };
    } catch (error) {
      this.close(error instanceof Error ? error : new Error('MT5 connection failed'));
      throw error;
    }
  }

  request(command: number, payload: Uint8Array = Buffer.alloc(0)): Promise<Buffer> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || (!this.isReady && command !== WebCommand.handshake)) {
      return Promise.reject(new Error('MT5 web transport is not ready'));
    }
    if (this.pending.has(command)) return Promise.reject(new Error(`MT5 command ${command} is already pending`));
    const frame = encodeFrame(encryptPayload(encodeCommand(command, payload, randomBytes(2)), this.key));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close(new Error(`MT5 web command ${command} timed out; connection discarded`));
      }, this.timeoutMs);
      this.pending.set(command, { timer, reject, resolve, sentAt: Date.now() });
      socket.send(frame, (error) => { if (error) this.close(error); });
    });
  }

  close(error?: Error): void {
    const reason = error ?? new Error('MT5 web transport closed');
    const socket = this.socket;
    this.socket = undefined;
    this.isReady = false;
    this.key.fill(0);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
    socket?.terminate();
    if (socket && error) this.emit('disconnected', error);
  }
}
