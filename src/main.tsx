import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Silently swallow intentional AbortController cancellations (e.g., rapid video switch / cache race)
// while keeping all real application errors visible.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const isBenignAbort =
    (reason instanceof DOMException && reason.name === 'AbortError') ||
    (reason instanceof Error && (reason.name === 'AbortError' || reason.message === 'Aborted')) ||
    (typeof reason === 'object' &&
      reason !== null &&
      'name' in reason &&
      (reason as { name?: string }).name === 'AbortError') ||
    reason === 'Aborted';
  if (isBenignAbort) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(<App />);
