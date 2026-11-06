import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { Splash } from '../../app/Splash';

/** Motivo do erro devolvido pelo Supabase no retorno do OAuth. `privado`: o hook de cadastro recusou (RN-101). */
export function callbackError(params: URLSearchParams): 'privado' | 'falha' | null {
  const error = params.get('error') ?? params.get('error_code');
  const description = params.get('error_description') ?? '';
  if (!error && !description) {
    return null;
  }
  return /privado/i.test(description) ? 'privado' : 'falha';
}

/** `/auth/callback` (PKCE): troca o código pela sessão e segue para o Início; erro volta ao ON03. */
export function AuthCallback() {
  const { client } = useAuth();
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) {
      return;
    }
    done.current = true;
    const params = new URLSearchParams(window.location.search);
    const error = callbackError(params);
    const code = params.get('code');
    if (error || !code || !client) {
      void navigate(`/entrar?erro=${error ?? 'falha'}`, { replace: true });
      return;
    }
    void client.auth.exchangeCodeForSession(code).then(({ error: exchange }) => {
      void navigate(exchange ? '/entrar?erro=falha' : '/', { replace: true });
    });
  }, [client, navigate]);

  return <Splash />;
}
