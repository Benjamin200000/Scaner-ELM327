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
