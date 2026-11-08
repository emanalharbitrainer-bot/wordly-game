import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { applySavedPerfTier, measurePerfTier } from './utils/perf-tier';
import './styles/global.css';
import './styles/game.css';
import './styles/assistant.css';
import './styles/social.css';
import './styles/v3.css';

applySavedPerfTier();
measurePerfTier();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
