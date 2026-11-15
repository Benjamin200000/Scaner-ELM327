import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './ui/shell/App';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el nodo raíz');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Uso sin conexión. Solo en producción y donde el navegador lo permita: en
// desarrollo un service worker sirve archivos viejos y confunde.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Sin service worker la app funciona igual, solo que necesita red
      // para abrir.
    });
  });
}
