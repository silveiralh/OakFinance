// Só no build E2E (VITE_E2E=1, tech §8.4): o Google OAuth não é automatizável, então o Supabase local aceita
// e-mail e senha e este formulário entra (ou cria o usuário da allowlist de teste, `@example.test`).
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth';

export const E2E_PASSWORD = 'senha-local-de-teste-123';

export function E2eLogin() {
  const { client } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('e2e-a@example.test');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!client) {
      setError('sem Supabase');
      return;
    }
    let result = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
    if (result.error) {
      const signUp = await client.auth.signUp({ email, password: E2E_PASSWORD });
      if (signUp.error && !/registered/i.test(signUp.error.message)) {
        setError(signUp.error.message);
        return;
      }
      result = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
    }
    if (result.error) {
      setError(result.error.message);
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <form data-e2e-login="" onSubmit={(event) => void submit(event)} className="e2e-login">
      <label>
        E-mail de teste
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <button type="submit">Entrar (teste)</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
