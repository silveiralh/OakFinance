import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth';
import { Splash } from './Splash';

/** Telas do app: sem sessão, vai para as boas-vindas (UX §2.2, S00 → ON01). */
export function RequireSession() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return <Splash />;
  }
  if (status !== 'signedIn') {
    return <Navigate to="/boas-vindas" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Boas-vindas, instalação e entrada: com sessão, vai direto ao Início (sem tela de login offline, US-01). */
export function RedirectIfSignedIn() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <Splash />;
  }
  if (status === 'signedIn') {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
