import { ipcRenderer } from 'electron';

ipcRenderer.on('relay:socket', (event, url: string) => {
  window.postMessage({ type: 'openterm-socket', url }, '*', event.ports);
});
