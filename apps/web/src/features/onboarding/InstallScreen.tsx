import { Info } from '@phosphor-icons/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../app/auth';
import { installScreen } from '../../app/screens';
import { shellText, t } from '../../i18n/pt-BR';
import {
  hasInstallPrompt,
  isOldIosWithoutPush,
  isStandalone,
  markInstallDismissed,
  markInstallSkipped,
  promptInstall,
  subscribeInstall,
  wasInstalled,
} from '../../lib/platform';
import { Banner, Button, detectInstallVariant, InstallGuide } from '../../ui';

/** ON02a/b/c (UX §3): prompt nativo quando existe; senão, o passo a passo da variante do navegador. */
export function InstallScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { status } = useAuth();
  const screen = installScreen(params);
  const prompt = useSyncExternalStore(subscribeInstall, hasInstallPrompt, () => false);
  const installedNow = useSyncExternalStore(subscribeInstall, wasInstalled, () => false);
  const [standalone] = useState(() => isStandalone(navigator));
  const ua = navigator.userAgent;
  const { platform, variant } = detectInstallVariant(ua, prompt);
  const next = status === 'signedIn' ? '/boas-vindas/lembretes' : '/entrar';

  useEffect(() => {
    if (installedNow && platform === 'ios') {
      void navigate('/entrar', { replace: true });
    }
  }, [installedNow, platform, navigate]);

  // já instalado (aberto pelo ícone): nenhum convite de instalação (US-06, US-07)
  if (standalone) {
    return <Navigate to={next} replace />;
  }

  const title =
    screen === 'ON02b'
      ? t('onb.install.ios.title')
      : screen === 'ON02a'
        ? t('onb.install.android.title')
        : shellText.screens.ON02c;
  const body =
    screen === 'ON02b'
      ? t('onb.install.ios.body')
      : screen === 'ON02a'
        ? t('onb.install.android.body')
        : shellText.installDesktopBody;

  const skip = () => {
    if (screen === 'ON02b') {
      markInstallSkipped();
    } else {
      markInstallDismissed();
    }
    void navigate(next);
  };

  return (
    <section
      className="screen screen-install"
      data-screen={screen}
      data-testid={`screen-${screen}`}
    >
      <h1 className="screen-title">{title}</h1>
      <p>{body}</p>
      {screen === 'ON02b' && isOldIosWithoutPush(ua) && (
        <Banner icon={Info} message={shellText.oldIosNoPush} />
      )}
      <InstallGuide
        platform={platform}
        variant={variant}
        state={installedNow ? 'installed' : 'guide'}
        onInstall={() => void promptInstall()}
        onCopyLink={() => void navigator.clipboard?.writeText(window.location.href)}
      />
      {installedNow ? (
        <Button fullWidth onClick={() => void navigate(next)}>
          {t('common.continue')}
        </Button>
      ) : (
        <Button variant="ghost" onClick={skip}>
          {screen === 'ON02b' ? t('onb.install.skip') : t('onb.install.later')}
        </Button>
      )}
    </section>
  );
}
