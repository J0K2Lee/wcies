import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/providers';
import { App } from './app/App';
import './app/global.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container not found');
}

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
