import { app, BrowserWindow, session, type Session } from 'electron';
import type { TerminalMethods } from '../shared/protocol';
import type { TradingViewAccount } from '../shared/tradingview';
import { chromeUserAgent } from './browser-socket';
import { TradingViewClient, tradingViewSite, type Fetcher } from './tradingview-client';

// The TradingView sign-in lives in its own partition: its cookies never reach the trading
// terminal's pages or the broker session, and the renderer only ever sees what the client parses.

let partition: Session | undefined;

function tradingViewSession(): Session {
  if (partition) return partition;
  partition = session.fromPartition('persist:tradingview');
  partition.setUserAgent(chromeUserAgent(partition.getUserAgent(), app.getName()));
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  return partition;
}

const client = () => new TradingViewClient((url, init) => tradingViewSession().fetch(url, init));

// Script reads go one at a time, at least this far apart: importing the popular list is about a
// thousand of them, and TradingView answers bursts with 429.
const SCRIPT_GAP_MS = 1000;

let scriptQueue: Promise<unknown> = Promise.resolve();

const pacedFetch: Fetcher = (url, init) => {
  const turn = scriptQueue.then(() => tradingViewSession().fetch(url, init));
  scriptQueue = turn.catch(() => undefined).then(() => new Promise((resolve) => setTimeout(resolve, SCRIPT_GAP_MS)));
  return turn;
};

const scriptClient = () => new TradingViewClient(pacedFetch);

// The user signs in on TradingView's own page (email, Google, Apple and so on); the window closes
// once the session cookie TradingView sets makes its chart page report a signed-in user.
function signIn(parent?: BrowserWindow): Promise<TradingViewAccount | null> {
  const ses = tradingViewSession();
  return new Promise((resolve) => {
    let isDone = false;
    let pending: NodeJS.Timeout | undefined;
    const window = new BrowserWindow({
      parent,
      modal: !!parent,
      width: 520,
      height: 720,
      title: 'Sign in to TradingView',
      autoHideMenuBar: true,
      webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const finish = (account: TradingViewAccount | null) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(pending);
      ses.cookies.off('changed', onCookie);
      resolve(account);
      if (!window.isDestroyed()) window.destroy();
    };
    const check = () => {
      clearTimeout(pending);
      pending = setTimeout(() => void client().account().then((account) => account && finish(account)).catch(() => undefined), 800);
    };
    const onCookie = (_event: Electron.Event, cookie: Electron.Cookie) => { if (cookie.domain?.endsWith('tradingview.com')) check(); };
    ses.cookies.on('changed', onCookie);
    window.on('page-title-updated', (event) => event.preventDefault());
    window.on('closed', () => finish(null));
    window.webContents.on('will-navigate', (event, target) => { if (!target.startsWith('https://')) event.preventDefault(); });
    // Google, Apple and other providers sign in through a popup that must share the session.
    window.webContents.setWindowOpenHandler(({ url }) => url.startsWith('https://')
      ? { action: 'allow', overrideBrowserWindowOptions: { parent: window, autoHideMenuBar: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false } } }
      : { action: 'deny' });
    window.webContents.on('did-finish-load', check);
    void window.loadURL(`${tradingViewSite}/accounts/signin/`).catch(() => undefined);
  });
}

async function signOut(): Promise<boolean> {
  await tradingViewSession().clearStorageData();
  await tradingViewSession().clearCache();
  return true;
}

export async function handleTradingView(method: string, params: unknown, parent?: BrowserWindow): Promise<unknown> {
  switch (method) {
    case 'tradingview.account': return client().account();
    case 'tradingview.signIn': return signIn(parent);
    case 'tradingview.signOut': return signOut();
    case 'tradingview.symbols': return client().symbols();
    case 'tradingview.drawings': return client().drawings((params as TerminalMethods['tradingview.drawings'][0]).symbols);
    case 'tradingview.drawingTemplates': return client().drawingTemplates((params as TerminalMethods['tradingview.drawingTemplates'][0]).types);
    case 'tradingview.themes': return client().themes();
    case 'tradingview.theme': return client().theme((params as TerminalMethods['tradingview.theme'][0]).name);
    case 'tradingview.chartSettings': return client().chartSettings();
    case 'tradingview.script': return scriptClient().script((params as TerminalMethods['tradingview.script'][0]).url);
    case 'tradingview.scriptList': return scriptClient().scriptList((params as TerminalMethods['tradingview.scriptList'][0]).page);
    case 'tradingview.scriptSource': {
      const { scriptId, version } = params as TerminalMethods['tradingview.scriptSource'][0];
      return scriptClient().scriptSource(scriptId, version);
    }
    default: throw new Error(`Unknown TradingView request ${method}.`);
  }
}
