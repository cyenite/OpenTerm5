import { app, BrowserWindow, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import type { TerminalEvent, TerminalMethod, ConnectionSettings, JournalEntry } from '../shared/protocol';
import { loadSettings, saveSettings } from './settings';
import { Mt5WebLink } from './mt5-web-link';
import { loadAccounts, secretCipher } from './accounts';
import { SessionPool } from './session-pool';
import { AutomationHost } from './automation-host';
import type { AutomationEvent, AutomationMethod } from '../shared/automation';
import { orderType } from '../shared/protocol';
import { parseSettings } from './connection-settings';
import { BrokerDirectory } from './broker-directory';
import type { AccountRegistry } from './account-registry';
import type { TerminalMethods } from '../shared/protocol';

const devUrl = process.env.TERMINAL5_DEV_URL;
const direct = new Mt5WebLink();
let automation: AutomationHost | undefined;
let isChanging = false;
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

const pool = new SessionPool(direct, (accountId) => {
  if (!accounts) return undefined;
  try {
    const profile = accounts.get(accountId);
    const password = accounts.password(accountId);
    return password ? { login: profile.login, password, endpoint: profile.webEndpoint } : undefined;
  } catch { return undefined; }
}, () => new Mt5WebLink());

function leaveAccount(): void {
  const previous = activeAccount;
  activeAccount = null;
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
    title: 'Terminal5',
    show: false,
    // On macOS the window controls sit inside the menu bar, which doubles as the drag region.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 8 } } : {}),
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window?.show());
  // The renderer draws its own trading menus; text fields and selected text get the native edit menu.
  window.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && !params.selectionText.trim()) return;
    const template: MenuItemConstructorOptions[] = params.isEditable
      ? [{ role: 'undo', enabled: params.editFlags.canUndo }, { role: 'redo', enabled: params.editFlags.canRedo }, { type: 'separator' }, { role: 'cut', enabled: params.editFlags.canCut }, { role: 'copy', enabled: params.editFlags.canCopy }, { role: 'paste', enabled: params.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' }]
      : [{ role: 'copy' }];
    Menu.buildFromTemplate(template).popup({ window });
  });
  window.on('closed', () => (window = undefined));
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
function brokers(): BrokerDirectory { return brokerDirectory ??= new BrokerDirectory(app.getPath('userData')); }

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

async function loginAccount(params: TerminalMethods['account.login'][0]) {
  if (params.isPasswordSaved && !accounts?.canSavePasswords()) throw new Error('Secure password storage is unavailable. Leave Save password unchecked.');
  const next = parseSettings({ webEndpoint: params.webEndpoint ?? settings.webEndpoint });
  leaveAccount();
  send('accountChanged', { id: null });
  direct.disconnect();
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
  return account;
}

ipcMain.handle('terminal:request', async (_event, method: TerminalMethod, params: unknown) => {
  try {
    if (method === 'accounts.list') return { result: accountProfiles() };
    if (method === 'accounts.storage') return { result: { canSavePasswords: !!accounts?.canSavePasswords() } };
    if (method === 'brokers.search') return { result: await brokers().search((params as TerminalMethods['brokers.search'][0]).query, accountProfiles().map((profile) => profile.server)) };
    if (method === 'brokers.resolve') {
      const { server, webUrl } = params as TerminalMethods['brokers.resolve'][0];
      return { result: webUrl ? await brokers().inspect(server, webUrl) : await brokers().resolve(server) };
    }
    if (method === 'account.login') return { result: await changeConnection(() => loginAccount(params as TerminalMethods['account.login'][0])) };
    if (method === 'accounts.connect') return { result: await changeConnection(async () => {
      if (!accounts) throw new Error('Account storage is unavailable.');
      const values = params as TerminalMethods['accounts.connect'][0];
      const profile = accounts.get(values.id);
      const password = values.password ?? accounts.password(values.id);
      if (!password) throw new Error('Enter the password for this saved account.');
      return loginAccount({ login: profile.login, password, webEndpoint: profile.webEndpoint, label: profile.label, otp: values.otp, isPasswordSaved: values.isPasswordSaved ?? profile.isPasswordSaved });
    }) };
    if (method === 'accounts.remove') return { result: await changeConnection(async () => {
      if (!accounts) throw new Error('Account storage is unavailable.');
      const { id } = params as TerminalMethods['accounts.remove'][0];
      await accounts.remove(id);
      if (id === activeAccount) {
        leaveAccount();
        send('accountChanged', { id: null });
        await applySettings();
      }
      send('accounts', accountProfiles());
      return true;
    }) };
    if (method === 'order.send' && isChanging) throw new Error('Account connection is changing. Send the order again after login completes.');
    await settledConnection();
    if (method === 'order.send') {
      const request = params as TerminalMethods['order.send'][0];
      const isOpening = request.action === 'pending' || request.action === 'deal' && !request.position && !!orderType(request.type ?? '');
      const blocked = isOpening ? automation?.canOpen(activeAccount, request.symbol, request.volume) : null;
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
ipcMain.handle('settings:get', () => settings);
ipcMain.handle('settings:save', async (_event, next: ConnectionSettings) => changeConnection(async () => {
  await saveSettings(next);
  settings = await loadSettings();
  leaveAccount();
  send('accountChanged', { id: null });
  await applySettings();
  return direct.state;
}));

direct.on('event', (event: TerminalEvent, data: unknown) => {
  send(event, data);
  pool.forwardUi(event, data);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    window?.isMinimized() && window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    installMenu();
    settings = await loadSettings();
    try { accounts = await loadAccounts(); }
    catch { journal('Saved accounts could not be loaded. Log in manually.', 'Accounts'); }
    createWindow();
    await applySettings();
    const recent = accounts?.list()[0];
    if (recent?.isPasswordSaved && recent.hasPassword && recent.webEndpoint === settings.webEndpoint) {
      try {
        const password = accounts!.password(recent.id);
        if (password) await changeConnection(() => loginAccount({ login: recent.login, password, webEndpoint: recent.webEndpoint, label: recent.label, isPasswordSaved: true }));
        send('status', await direct.request('terminal.status', {}));
        send('trade', await direct.request('trade.snapshot', {}));
      } catch (error) { journal(`Automatic login failed: ${(error as Error).message}. Log in manually.`, 'Accounts'); }
    }
    automation = new AutomationHost({ pool, userData: app.getPath('userData'), cipher: secretCipher, accounts: () => accounts, send: sendAutomation, journal });
    await automation.init();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void automation?.shutdown();
  pool.shutdown();
  direct.disconnect();
});
