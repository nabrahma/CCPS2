import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { backend } from './backend';
import './styles.css';
import './workspace.css';

window.addEventListener('error', (e) => backend.log('error', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => backend.log('error', `unhandled rejection: ${String(e.reason)}`));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
