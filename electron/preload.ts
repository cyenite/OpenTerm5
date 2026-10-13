import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { TerminalEvent, TerminalMethod, ConnectionSettings, TerminalApi } from '../shared/protocol';
import type { AutomationApi, AutomationEvent, AutomationMethod } from '../shared/automation';

class RequestError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

// One IPC listener per channel fans out to every subscriber, instead of one IPC
// listener per subscription (which trips Node's max-listener warning).
function channel(name: string) {
  const listeners = new Map<string, Set<(data: never) => void>>();
  ipcRenderer.on(name, (_: IpcRendererEvent, event: string, data: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(data as never);
  });
  return (event: string, listener: (data: never) => void) => {
    const set = listeners.get(event) ?? new Set();
    set.add(listener);
    listeners.set(event, set);
    return () => { set.delete(listener); };
  };
}

async function invoke(name: string, method: string, params: unknown) {
  const reply = await ipcRenderer.invoke(name, method, params);
  if (reply.error) throw new RequestError(reply.error.code, reply.error.message);
  return reply.result;
}

const onTerminal = channel('terminal:event');
const onAutomation = channel('automation:event');

const api: TerminalApi = {
  request: (method: TerminalMethod, params: unknown) => invoke('terminal:request', method, params),
  on: (event: TerminalEvent, listener: (data: never) => void) => onTerminal(event, listener),
  link: () => ipcRenderer.invoke('terminal:link'),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: ConnectionSettings) => ipcRenderer.invoke('settings:save', settings),
  platform: process.platform,
} as TerminalApi;

const automation: AutomationApi = {
  request: (method: AutomationMethod, params: unknown) => invoke('automation:request', method, params),
  on: (event: AutomationEvent, listener: (data: never) => void) => onAutomation(event, listener),
} as AutomationApi;

contextBridge.exposeInMainWorld('terminal', api);
contextBridge.exposeInMainWorld('automation', automation);
