import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerServiceWorker } from './lib/sw-update';
import './styles/base.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Elemento #root ausente em index.html');
}

async function boot(container: HTMLElement) {
  let page = <App />;
  // /__styleguide só no build E2E: fora dele, o import some do bundle (constante substituída no build)
  if (import.meta.env.VITE_E2E === '1' && window.location.pathname === '/__styleguide') {
    const { Styleguide } = await import('./styleguide/Styleguide');
    page = <Styleguide />;
  }
  createRoot(container).render(<StrictMode>{page}</StrictMode>);
  // Depois do primeiro render: o SW não disputa a rede com o carregamento do shell
  void registerServiceWorker();
}

void boot(root);
