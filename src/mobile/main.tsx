import './bridge';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startTickBars } from '../lib/mt5-provider';
import { registerMt5Studies } from '../lib/mt5-studies';
import { startSession } from '../lib/session';
import { onReady, startBridge } from './bridge';
import { MobileApp } from './components/MobileApp';
import { startQuotes } from './quotes';
import { startMobileTheme } from './theme';
import './mobile.css';

startMobileTheme();
registerMt5Studies();
startTickBars();
// The session store asks for accounts and the broker link as it starts, so it waits for the computer.
let hasStarted = false;
onReady(() => {
  if (hasStarted) return;
  hasStarted = true;
  startSession();
  startQuotes();
});
startBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
