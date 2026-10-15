import './lib/legacy-storage';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSession } from './lib/session';
import { startBrokerSymbols } from './lib/broker-symbols';
import { startWatchlists } from './lib/watchlists';
import { startAutomation } from './lib/automation';
import { startTickBars } from './lib/mt5-provider';
import { registerMt5Studies } from './lib/mt5-studies';
import { startTheming } from './lib/theme';
import { startImportedThemes } from './lib/custom-themes';
import { startSymbolDrawings } from './lib/symbol-drawings';
import { startDrawingTemplates } from './lib/drawing-templates';
import './styles.css';

document.body.classList.add(`platform-${window.terminal.platform}`);
window.terminal.on('fullScreen', (isFullScreen) => document.body.classList.toggle('is-full-screen', isFullScreen));
startTheming();
registerMt5Studies();
startTickBars();
startSession();
startBrokerSymbols();
startWatchlists();
startSymbolDrawings();
startDrawingTemplates();
startImportedThemes();
startAutomation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
