import { LockKeyhole, LogIn, WifiOff } from 'lucide-react';
import { type ComponentType, lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../app/auth';
import { shellText, t } from '../../i18n/pt-BR';
import { Banner, BrandLogo, Button, EmptyState } from '../../ui';

// Formulário de login de teste: só no build E2E (tech §8.4); o check-build garante a ausência no de produção
const E2eLogin: ComponentType | null =
  import.meta.env.VITE_E2E === '1'
    ? lazy(() => import('../../app/e2e/E2eLogin').then((m) => ({ default: m.E2eLogin })))
    : null;

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** ON03 Entrar com Google (UX §3 ON03) e G14 (e-mail fora da allowlist, RN-101). */
export function LoginScreen() {
  const { signInWithGoogle } = useAuth();
  const [params] = useSearchParams();
  const online = useOnline();
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(
    params.get('erro') === 'falha' ? 'error' : 'idle',
  );
  const denied = params.get('erro') === 'privado';

  const start = async (selectAccount = false) => {
    setState('loading');
    const ok = await signInWithGoogle({ selectAccount });
    if (!ok) {
      setState('error');
    }
  };

  if (denied) {
    return (
      <section className="screen screen-login" data-screen="ON03" data-testid="screen-G14">
        <EmptyState
          variant="error"
          icon={LockKeyhole}
          title={shellText.privateTitle}
          description={shellText.privateDescription}
          primaryAction={{ label: shellText.otherAccount, onPress: () => void start(true) }}
        />
      </section>
    );
  }

  return (
    <section className="screen screen-login" data-screen="ON03" data-testid="screen-ON03">
      <BrandLogo variant="wordmark" height={28} />
      <h1 className="screen-title">{t('onb.login.title')}</h1>
      <p>{t('onb.login.body')}</p>
      {state === 'error' && (
        <div role="alert" className="screen-login-error">
          <p>{shellText.loginFailed}</p>
          <Button variant="secondary" onClick={() => void start()}>
            {shellText.retry}
          </Button>
        </div>
      )}
      {!online && <Banner tone="warning" icon={WifiOff} message={shellText.firstAccessOffline} />}
      <Button
        variant="secondary"
        iconStart={LogIn}
        fullWidth
        loading={state === 'loading'}
        disabled={!online}
        disabledReason={shellText.firstAccessOffline}
        onClick={() => void start()}
      >
        {state === 'loading' ? shellText.signingIn : t('onb.login.cta')}
      </Button>
      {E2eLogin && (
        <Suspense fallback={null}>
          <E2eLogin />
        </Suspense>
      )}
    </section>
  );
}
