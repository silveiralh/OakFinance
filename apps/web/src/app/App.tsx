import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { AuthContext, AuthProvider, type AuthValue } from './auth';
import { createAppRouter } from './routes';

export interface AppProps {
  router?: ReturnType<typeof createAppRouter>;
  /** Sessão fixa (testes de componente); padrão: a do Supabase. */
  auth?: AuthValue;
}

/** Raiz do app: sessão (Supabase) e roteador do navegador (SPA). */
export function App({ router: injected, auth }: AppProps = {}) {
  const [router] = useState(() => injected ?? createAppRouter());
  const routes = <RouterProvider router={router} />;
  return auth ? (
    <AuthContext.Provider value={auth}>{routes}</AuthContext.Provider>
  ) : (
    <AuthProvider>{routes}</AuthProvider>
  );
}
