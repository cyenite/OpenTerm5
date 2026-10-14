import path from 'node:path';
import { app, BrowserWindow, MessageChannelMain, session, type MessagePortMain, type Session } from 'electron';
import { isBotCheck } from './bot-check';
import { BrowserSocket, chromeUserAgent } from './browser-socket';
import type { SocketOpener } from './mt5-web-transport';

const maxPayload = 104_857_600;

const relayPage = `<!doctype html><meta charset="utf-8"><script>
window.addEventListener('message', (event) => {
  if (event.data?.type !== 'openterm-socket' || !event.ports[0]) return;
  const port = event.ports[0];
  const socket = new WebSocket(event.data.url);
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => port.postMessage({ type: 'open' });
  socket.onmessage = (message) => port.postMessage({ type: 'message', data: message.data });
  socket.onclose = (closed) => { port.postMessage({ type: 'close', code: closed.code }); port.close(); };
  port.onmessage = ({ data }) => data.type === 'send' ? socket.send(data.data) : socket.close();
  port.start();
});
</script>`;

let brokers: Session | undefined;

const relays = new Map<string, RelayHost>();

export function brokerSession(): Session {
  if (brokers) return brokers;
  brokers = session.fromPartition('persist:brokers');
  brokers.setUserAgent(chromeUserAgent(brokers.getUserAgent(), app.getName()));
  return brokers;
}

export const browserFetch = ((input: string | URL | Request, init?: RequestInit) =>
  brokerSession().fetch(input instanceof URL ? input.href : input, init)) as typeof fetch;

async function isChallenged(url: string): Promise<boolean> {
  const response = await brokerSession().fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8_000), headers: { Accept: 'text/html' } });
  await response.body?.cancel();
  return isBotCheck(response.status, response.headers);
}

// One hidden page per broker origin owns that origin's sockets. Loading it as data with the broker
// as base URL gives the page the broker's origin, so its WebSocket carries the same Origin header
// and cookies the broker's own web terminal would.
class RelayHost {
  private users = 0;
  private readonly window: BrowserWindow;
  private readonly loaded: Promise<void>;

  constructor(private readonly origin: string) {
    this.window = new BrowserWindow({
      show: false,
      webPreferences: { session: brokerSession(), preload: path.join(__dirname, 'relay-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', (event) => event.preventDefault());
    this.window.webContents.on('render-process-gone', () => this.destroy());
    this.loaded = this.window.loadURL(`data:text/html;base64,${Buffer.from(relayPage).toString('base64')}`, { baseURLForDataURL: `${origin}/` });
  }

  open(url: string, port: MessagePortMain): void {
    this.users++;
    this.loaded.then(() => {
      if (this.window.isDestroyed()) throw new Error('Relay page closed');
      this.window.webContents.postMessage('relay:socket', url, [port]);
    }).catch(() => port.emit('close'));
  }

  release(): void {
    if (--this.users <= 0) this.destroy();
  }

  private destroy(): void {
    if (relays.get(this.origin) === this) relays.delete(this.origin);
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}

export const openBrowserSocket: SocketOpener = (url) => {
  const endpoint = new URL(url);
  const origin = `https://${endpoint.host}`;
  const relay = relays.get(origin) ?? new RelayHost(origin);
  relays.set(origin, relay);
  const { port1, port2 } = new MessageChannelMain();
  const page = new URL(endpoint.pathname, origin).href;
  const socket = new BrowserSocket(endpoint.hostname, maxPayload, port1, () => relay.release(), () => isChallenged(page));
  relay.open(url, port2);
  return socket;
};

// The user completes the broker's bot check in a real window. Cloudflare then stores its clearance
// in the broker session, which every request above shares, and the window closes itself.
export function verifyBrokerAccess(host: string, parent?: BrowserWindow): Promise<boolean> {
  const url = `https://${host}/terminal`;
  return new Promise((resolve) => {
    let isDone = false;
    const window = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 560,
      height: 680,
      title: `Verify access to ${host}`,
      autoHideMenuBar: true,
      webPreferences: { session: brokerSession(), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const finish = (isCleared: boolean) => {
      if (isDone) return;
      isDone = true;
      resolve(isCleared);
      if (!window.isDestroyed()) window.destroy();
    };
    window.on('page-title-updated', (event) => event.preventDefault());
    window.on('closed', () => finish(false));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => { if (new URL(target).host !== host) event.preventDefault(); });
    window.webContents.on('did-finish-load', () => {
      void isChallenged(url).then((challenged) => { if (!challenged) finish(true); }).catch(() => undefined);
    });
    void window.loadURL(url).catch(() => undefined);
  });
}
