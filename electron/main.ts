import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell, type MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Account, AccountProfile, AccountSignIn, TerminalEvent, TerminalMethod, ConnectionSettings, JournalEntry } from '../shared/protocol';
import type { JournalingEvent, JournalingMethod } from '../shared/journaling';
import { loadSettings, saveSettings } from './settings';
import { migrateLegacyProfile } from './legacy-migration';
import { Mt5WebLink } from './mt5-web-link';
import { Mt5WebClient } from './mt5-web-client';
import { BotCheckError } from './bot-check';
import { browserFetch, openBrowserSocket, verifyBrokerAccess } from './browser-network';
import { loadAccounts, secretCipher } from './accounts';
import { SessionPool } from './session-pool';
import { handleTradingView } from './tradingview';
import { AutomationHost } from './automation-host';
import type { AutomationEvent, AutomationMethod } from '../shared/automation';
import { orderType } from '../shared/protocol';
import { parseSettings } from './connection-settings';
import { BrokerDirectory } from './broker-directory';
import { DeviceIdentity, navigatorPlatform } from './device-identity';
import type { AccountRegistry } from './account-registry';
import type { TerminalMethods } from '../shared/protocol';
import { JournalingService } from './journaling';
import { findConnectLink, protocolScheme } from './journaling-links';
import { accountKey } from './journaling-store';

migrateLegacyProfile();

const devUrl = process.env.OPENTERM_DEV_URL;
const device = new DeviceIdentity(path.join(app.getPath('userData'), 'device.json'), () => {
  const display = screen.getPrimaryDisplay();
  return { scale: display.scaleFactor, width: display.size.width, height: display.size.height, platform: navigatorPlatform(process.platform, process.arch), language: app.getLocale() };
});
const createLink = () => new Mt5WebLink((endpoint) => new Mt5WebClient(endpoint, openBrowserSocket, device.clientId));
const direct = createLink();
let automation: AutomationHost | undefined;
let journaling: JournalingService | undefined;
let isChanging = false;
let isWindowLoaded = false;
let uiAccount: Account | null = null;
let signIn: AccountSignIn | null = null;
const pendingLinks: string[] = [];
let activeAccount: string | null = null;
let accounts: AccountRegistry | undefined;
let window: BrowserWindow | undefined;
let settings: ConnectionSettings;

function send(event: TerminalEvent, data: unknown): void {
  window?.webContents.send('terminal:event', event, data);
}

function sendAutomation(event: AutomationEvent, data: unknown): void {
  window?.webContents.send('automation:event', event, data);
}

async function saveFile(name: string, contents: string): Promise<string | null> {
  const options = { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'JSON', extensions: ['json'] }] };
  const { canceled, filePath } = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, contents, { mode: 0o600 });
  return filePath;
}

function sendJournaling(event: JournalingEvent, data: unknown): void {
  window?.webContents.send('journaling:event', event, data);
}

// Protocol links can arrive before the service has loaded or the page can show a prompt.
function deliverLinks(): void {
  if (!journaling || !isWindowLoaded) return;
  for (const link of pendingLinks.splice(0)) void journaling.receiveLink(link);
}

function receiveLink(link: string): void {
  pendingLinks.push(link);
  if (window?.isMinimized()) window.restore();
  window?.focus();
  deliverLinks();
}

const pool = new SessionPool(direct, (accountId) => {
  if (!accounts) return undefined;
  try {
    const profile = accounts.get(accountId);
    const password = accounts.password(accountId);
    return password ? { login: profile.login, password, endpoint: profile.webEndpoint } : undefined;
  } catch { return undefined; }
}, createLink);

function leaveAccount(): void {
  const previous = activeAccount;
  activeAccount = null;
  uiAccount = null;
  journaling?.setActive(null);
  pool.afterUiChange(null, previous);
}

function journal(message: string, source = 'Terminal'): void {
  const entry: JournalEntry = { time: Date.now(), source, message };
  send('journal', entry);
}

async function applySettings(): Promise<void> {
  direct.disconnect();
  try { await direct.connect(settings.webEndpoint); }
  catch (error) { journal((error as Error).message, 'Network'); }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'OpenTerm5',
    show: false,
    // macOS takes the icon from the app bundle; Linux and Windows need it on the window.
    ...(process.platform === 'darwin' ? {} : { icon: path.join(app.getAppPath(), 'build', 'icon.png') }),
    // On macOS the window controls sit inside the 36px app bar, centred on it, and the bar doubles as the drag region.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 11 } } : {}),
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.on('did-finish-load', () => {
    isWindowLoaded = true;
    deliverLinks();
  });
  // macOS hides the window controls in full screen, so the app bar stops leaving room for them.
  const sendFullScreen = () => send('fullScreen', !!window?.isFullScreen());
  window.on('enter-full-screen', sendFullScreen);
  window.on('leave-full-screen', sendFullScreen);
  window.on('enter-html-full-screen', sendFullScreen);
  window.on('leave-html-full-screen', sendFullScreen);
  window.webContents.on('did-finish-load', sendFullScreen);
  // The renderer draws its own trading menus; text fields and selected text get the native edit menu.
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText.trim()) return;
    const template: MenuItemConstructorOptions[] = params.isEditable
      ? [{ role: 'undo', enabled: params.editFlags.canUndo }, { role: 'redo', enabled: params.editFlags.canRedo }, { type: 'separator' }, { role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' }]
      : [{ role: 'copy' }];
    Menu.buildFromTemplate(template).popup({ window });
  });
  window.on('closed', () => {
    window = undefined;
    if (process.platform !== 'darwin') app.quit();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window?.webContents.getURL()) {
      event.preventDefault();
    }
  });
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }
}

function installMenu(): void {
  // The terminal draws its own MT5-style menu bar; macOS still needs an app menu
  // for the standard clipboard and quit shortcuts.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

let brokerDirectory: BrokerDirectory | undefined;
function brokers(): BrokerDirectory { return brokerDirectory ??= new BrokerDirectory(app.getPath('userData'), browserFetch); }

function accountProfiles() { return (accounts?.list() ?? []).map((profile) => ({ ...profile, isActive: profile.id === activeAccount })); }

let changeSettled: Promise<void> = Promise.resolve();

async function changeConnection<T>(work: () => Promise<T>): Promise<T> {
  if (isChanging) throw new Error('Wait for the current account or connection change to finish.');
  isChanging = true;
  const run = work();
  changeSettled = run.then(() => undefined, () => undefined);
  try { return await run; }
  finally { isChanging = false; }
}

// Reads issued while an account is switching wait for the switch instead of failing, so the
// renderer's startup requests (symbols, charts) succeed once automatic login completes.
async function settledConnection(): Promise<void> {
  if (!isChanging) return;
  await Promise.race([changeSettled, new Promise((resolve) => setTimeout(resolve, 30_000))]);
  if (isChanging) throw new Error('Account connection is still changing. Try again after login completes.');
}

// Only requests the user just made open the check window; reconnects and background sessions report it.
async function clearingBotCheck<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) {
    if (!(error instanceof BotCheckError) || !await verifyBrokerAccess(error.host, window)) throw error;
    return work();
  }
}

type SignInTarget = Omit<AccountSignIn, 'state' | 'error'>;

function profileTarget(profile: AccountProfile): SignInTarget {
  return { id: profile.id, label: profile.label, server: profile.server, login: profile.login };
}

function setSignIn(next: AccountSignIn | null): void {
  signIn = next;
  send('signIn', next);
}

// Runs inside changeConnection, so a request refused because another change is running
// cannot replace the state of the login that is actually in progress.
async function signingIn<T>(target: SignInTarget, work: () => Promise<T>): Promise<T> {
  setSignIn({ ...target, state: 'signing-in' });
  try {
    const result = await work();
    setSignIn(null);
    return result;
  } catch (error) {
    setSignIn({ ...target, state: 'failed', error: (error as Error).message });
    throw error;
  }
}

function loginTarget(params: TerminalMethods['account.login'][0]): SignInTarget {
  const endpoint = params.webEndpoint ?? settings.webEndpoint;
  const known = accounts?.list().find((profile) => profile.login === params.login && profile.webEndpoint === endpoint);
  return { id: known?.id ?? null, label: params.label?.trim() || known?.label || '', server: String(params.server ?? known?.server ?? ''), login: params.login };
}

async function loginAccount(params: TerminalMethods['account.login'][0]) {
  if (params.isPasswordSaved && !accounts?.canSavePasswords()) throw new Error('Secure password storage is unavailable. Leave Save password unchecked.');
  const next = parseSettings({ webEndpoint: params.webEndpoint ?? settings.webEndpoint });
  leaveAccount();
  send('accountChanged', { id: null });
  direct.disconnect();
  // Each connection creates its client from device.clientId, so a new ID applies to this login.
  if (params.isUniqueClientIdRequested && await device.ensureUnique()) journal('This computer now sends a unique client ID at login.', 'Accounts');
  await pool.beforeUiLogin(`${next.webEndpoint}|${params.login}`);
  await saveSettings(next);
  settings = next;
  await direct.connect(settings.webEndpoint);
  const account = await direct.request('account.login', { login: params.login, password: params.password, ...(params.otp ? { otp: params.otp } : {}) });
  pool.afterUiChange(`${settings.webEndpoint}|${account.login}`, null);
  void brokers().remember(account.server, settings.webEndpoint, account.company).catch(() => undefined);
  if (accounts) {
    try {
      const profile = await accounts.remember(account, settings.webEndpoint, params.password, params.label, params.isPasswordSaved);
      activeAccount = profile.id;
      send('accounts', accountProfiles());
    } catch { journal('Connected, but the account profile could not be saved.', 'Accounts'); }
  }
  send('accountChanged', { id: activeAccount });
  uiAccount = account;
  journaling?.setActive(account);
  return account;
}

ipcMain.handle('terminal:request', async (_event, method: TerminalMethod, params: unknown) => {
  try {
    if (method === 'accounts.list') return { result: accountProfiles() };
    if (method === 'accounts.signIn') return { result: signIn };
    if (method === 'accounts.storage') return { result: { canSavePasswords: !!accounts?.canSavePasswords() } };
    if (method === 'device.identity') return { result: { isUnique: !device.hasWeakSeed } };
    if (method === 'brokers.search') return { result: await brokers().search((params as TerminalMethods['brokers.search'][0]).query, accountProfiles().map((profile) => profile.server)) };
    if (method === 'brokers.resolve') {
      const { server, webUrl } = params as TerminalMethods['brokers.resolve'][0];
      return { result: await clearingBotCheck(() => webUrl ? brokers().inspect(server, webUrl) : brokers().resolve(server)) };
    }
    if (method === 'account.login') {
      const values = params as TerminalMethods['account.login'][0];
      return { result: await changeConnection(() => signingIn(loginTarget(values), () => clearingBotCheck(() => loginAccount(values)))) };
    }
    if (method === 'accounts.connect') return { result: await changeConnection(async () => {
      if (!accounts) throw new Error('Account storage is unavailable.');
      const values = params as TerminalMethods['accounts.connect'][0];
      const profile = accounts.get(values.id);
      return signingIn(profileTarget(profile), () => {
        const password = values.password ?? accounts!.password(values.id);
        if (!password) throw new Error('Enter the password for this saved account.');
        return clearingBotCheck(() => loginAccount({ login: profile.login, password, webEndpoint: profile.webEndpoint, label: profile.label, otp: values.otp, isPasswordSaved: values.isPasswordSaved ?? profile.isPasswordSaved }));
      });
    }) };
    if (method === 'accounts.remove') return { result: await changeConnection(async () => {
      if (!accounts) throw new Error('Account storage is unavailable.');
      const { id } = params as TerminalMethods['accounts.remove'][0];
      await accounts.remove(id);
      if (signIn?.id === id && signIn.state === 'failed') setSignIn(null);
      if (id === activeAccount) {
        leaveAccount();
        send('accountChanged', { id: null });
        await applySettings();
      }
      send('accounts', accountProfiles());
      return true;
    }) };
    if (method.startsWith('tradingview.')) return { result: await handleTradingView(method, params, window) };
    if (method === 'order.send' && isChanging) throw new Error('Account connection is changing. Send the order again after login completes.');
    await settledConnection();
    if (method === 'order.send') {
      const request = params as TerminalMethods['order.send'][0];
      const isOpening = request.action === 'pending' || request.action === 'deal' && !request.position && !!orderType(request.type ?? '');
      const blocked = isOpening ? await automation?.canOpen(activeAccount, request.symbol, request.volume) : null;
      if (blocked) throw new Error(blocked);
    }
    return { result: await direct.request(method, params as never) };
  } catch (error) {
    return { error: { code: 0, message: (error as Error).message } };
  }
});
ipcMain.handle('terminal:link', () => direct.state);
ipcMain.handle('automation:request', async (_event, method: AutomationMethod, params: unknown) => {
  try {
    if (!automation) throw new Error('Automation is still starting');
    return { result: await automation.handle(method, params) };
  } catch (error) {
    return { error: { code: 0, message: (error as Error).message } };
  }
});
ipcMain.handle('journaling:request', async (_event, method: JournalingMethod, params: unknown) => {
  try {
    if (!journaling) throw new Error('Journaling is still starting');
    return { result: await journaling.handle(method, params as never) };
  } catch (error) {
    return { error: { code: 0, message: (error as Error).message } };
  }
});
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:save', async (_event, next: ConnectionSettings) => changeConnection(async () => {
  await saveSettings(next);
  settings = await loadSettings();
  leaveAccount();
  if (signIn?.state === 'failed') setSignIn(null);
  send('accountChanged', { id: null });
  await applySettings();
  return direct.state;
}));

direct.on('event', (event: TerminalEvent, data: unknown) => {
  send(event, data);
  pool.forwardUi(event, data);
  // Mid-switch snapshots can still describe the account being left; login reports the new one.
  if (!isChanging) journaling?.onTerminal(event, data);
});

// macOS delivers protocol links as an event, possibly before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveLink(url);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (app.isPackaged) app.setAsDefaultProtocolClient(protocolScheme);
  else if (process.argv[1]) app.setAsDefaultProtocolClient(protocolScheme, process.execPath, [path.resolve(process.argv[1])]);
  const startupLink = findConnectLink(process.argv);
  if (startupLink) pendingLinks.push(startupLink);
  app.on('second-instance', (_event, argv) => {
    window?.isMinimized() && window.restore();
    window?.focus();
    const link = findConnectLink(argv);
    if (link) receiveLink(link);
  });
  app.whenReady().then(async () => {
    installMenu();
    settings = await loadSettings();
    await device.load();
    try { accounts = await loadAccounts(); }
    catch { journal('Saved accounts could not be loaded. Log in manually.', 'Accounts'); }
    const journalingSession = session.fromPartition('journaling');
    journaling = new JournalingService({
      file: path.join(app.getPath('userData'), 'journaling.json'),
      cipher: secretCipher,
      fetch: (url, init) => journalingSession.fetch(url, init),
      deviceName: os.hostname(),
      send: sendJournaling,
      journal: (message) => journal(message, 'Journaling'),
      openExternal: (url) => shell.openExternal(url),
      history: async (key, from, to) => {
        await settledConnection();
        if (!uiAccount || accountKey(uiAccount.login, uiAccount.server) !== key) throw new Error('The account changed during the sync.');
        return direct.request('history.get', { from, to });
      },
    });
    await journaling.init();
    const recent = accounts?.list()[0];
    const automatic = recent?.isPasswordSaved && recent.hasPassword && recent.webEndpoint === settings.webEndpoint ? recent : undefined;
    // Announced before the window loads and before the endpoint connects, so the window never looks logged out meanwhile.
    if (automatic) setSignIn({ ...profileTarget(automatic), state: 'signing-in' });
    const announced = signIn;
    createWindow();
    await applySettings();
    if (automatic) {
      try {
        await changeConnection(() => signingIn(profileTarget(automatic), () => {
          const password = accounts!.password(automatic.id);
          if (!password) throw new Error('The saved password is unavailable');
          return loginAccount({ login: automatic.login, password, webEndpoint: automatic.webEndpoint, label: automatic.label, isPasswordSaved: true });
        }));
        send('status', await direct.request('terminal.status', {}));
        send('trade', await direct.request('trade.snapshot', {}));
      } catch (error) {
        // A change the user started while the endpoint was connecting refuses this one before it begins.
        if (signIn === announced) setSignIn({ ...profileTarget(automatic), state: 'failed', error: (error as Error).message });
        journal(`Automatic login failed: ${(error as Error).message}. Log in manually.`, 'Accounts');
      }
    }
    automation = new AutomationHost({
      pool, userData: app.getPath('userData'), cipher: secretCipher, appVersion: app.getVersion(), accounts: () => accounts, send: sendAutomation, journal, saveFile,
      clientId: () => device.clientId.toString('hex'),
    });
    await automation.init();
    app.on('activate', () => !window && createWindow());
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void automation?.shutdown();
  journaling?.shutdown();
  pool.shutdown();
  direct.disconnect();
});
