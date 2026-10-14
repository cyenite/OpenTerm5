import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { BotCheckError } from './bot-check';
import type { TransportSocket } from './mt5-web-transport';

export interface RelayPort extends EventEmitter {
  start(): void;
  close(): void;
  postMessage(message: unknown): void;
}

export type RelayMessage =
  | { type: 'open' }
  | { type: 'close'; code: number }
  | { type: 'message'; data: ArrayBuffer | string };

const connecting = 0;
const open = 1;
const closed = 3;

export function chromeUserAgent(agent: string, appName: string): string {
  const product = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return agent.replace(new RegExp(` (?:Electron|${product})/\\S+`, 'g'), '');
}

// A WebSocket owned by a page in Chromium and relayed over a MessagePort. Chromium does not say
// why an upgrade failed, so a socket that closes before opening asks whether the host now answers
// with a bot check.
export class BrowserSocket extends EventEmitter implements TransportSocket {
  readyState = connecting;

  constructor(
    private readonly host: string,
    private readonly maxPayload: number,
    private readonly port: RelayPort,
    private readonly onEnd: () => void,
    private readonly isChallenged: () => Promise<boolean>,
  ) {
    super();
    port.on('message', ({ data }: { data: RelayMessage }) => this.receive(data));
    port.on('close', () => void this.finish(1006));
    port.start();
  }

  send(data: Buffer, callback: (error?: Error) => void): void {
    if (this.readyState !== open) {
      queueMicrotask(() => callback(new Error('WebSocket is not open')));
      return;
    }
    this.port.postMessage({ type: 'send', data: new Uint8Array(data) });
    queueMicrotask(() => callback());
  }

  terminate(): void {
    if (this.readyState === closed) return;
    this.readyState = closed;
    this.port.postMessage({ type: 'close' });
    this.port.close();
    this.onEnd();
  }

  private receive(message: RelayMessage): void {
    if (this.readyState === closed) return;
    if (message.type === 'open') {
      this.readyState = open;
      this.emit('open');
    } else if (message.type === 'close') {
      void this.finish(message.code);
    } else {
      const isBinary = typeof message.data !== 'string';
      const frame = typeof message.data === 'string' ? Buffer.from(message.data) : Buffer.from(message.data);
      if (frame.length <= this.maxPayload) {
        this.emit('message', frame, isBinary);
        return;
      }
      this.port.postMessage({ type: 'close' });
      this.emit('error', new Error('MT5 web server sent a frame larger than the supported size'));
      void this.finish(1009);
    }
  }

  private async finish(code: number): Promise<void> {
    if (this.readyState === closed) return;
    const wasOpen = this.readyState === open;
    this.readyState = closed;
    this.port.close();
    this.onEnd();
    if (!wasOpen) {
      const isChallenged = await this.isChallenged().catch(() => false);
      this.emit('error', isChallenged ? new BotCheckError(this.host) : new Error(`Could not open a connection to ${this.host} (${code})`));
    }
    this.emit('close', code);
  }
}
