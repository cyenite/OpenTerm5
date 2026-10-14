import './lib/legacy-storage';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSession } from './lib/session';
import { startBrokerSymbols } from './lib/broker-symbols';
import { startAutomation } from './lib/automation';
import './styles.css';

document.body.classList.add(`platform-${window.terminal.platform}`);
startSession();
startBrokerSymbols();
startAutomation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
