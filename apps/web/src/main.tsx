import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initStorage, requestPersistence } from './data/storage';
import { captureInstallEvents } from './lib/platform';
import { registerServiceWorker } from './lib/sw-update';
import './styles/base.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Elemento #root ausente em index.html');
}

// O Chrome dispara `beforeinstallprompt` cedo: captura antes do primeiro render. Instalou → persist() (UX §2.3)
captureInstallEvents(window, () => void requestPersistence());

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
  // IndexedDB utilizável? Sem ele, modo só online com o G12 (US-64)
  void initStorage();
}

void boot(root);
