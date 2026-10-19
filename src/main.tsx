import './lib/legacy-storage';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSession } from './lib/session';
import { startBrokerSymbols } from './lib/broker-symbols';
import { startWatchlists } from './lib/watchlists';
import { startAutomation } from './lib/automation';
import { startJournaling } from './lib/journaling';
import { startTickBars } from './lib/mt5-provider';
import { registerMt5Studies } from './lib/mt5-studies';
import { startTheming } from './lib/theme';
import { startAppZoom } from './lib/app-zoom';
import { startImportedThemes } from './lib/custom-themes';
import { startSymbolDrawings } from './lib/symbol-drawings';
import { startDrawingTemplates } from './lib/drawing-templates';
import { startPineScripts } from './lib/pine/pine-scripts';
import { startIndicatorFavorites } from './lib/indicator-favorites';
import './styles.css';

document.body.classList.add(`platform-${window.terminal.platform}`);
window.terminal.on('fullScreen', (isFullScreen) => document.body.classList.toggle('is-full-screen', isFullScreen));
startAppZoom();
startTheming();
registerMt5Studies();
startTickBars();
startSession();
startBrokerSymbols();
startWatchlists();
startSymbolDrawings();
startDrawingTemplates();
startImportedThemes();
startPineScripts();
startIndicatorFavorites();
startAutomation();
startJournaling();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
