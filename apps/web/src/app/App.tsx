import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { createAppRouter } from './routes';

/** Raiz do app: roteador do navegador (SPA). Guarda de auth e provedores de dados chegam na T-031/T-034. */
export function App({ router: injected }: { router?: ReturnType<typeof createAppRouter> } = {}) {
  const [router] = useState(() => injected ?? createAppRouter());
  return <RouterProvider router={router} />;
}
