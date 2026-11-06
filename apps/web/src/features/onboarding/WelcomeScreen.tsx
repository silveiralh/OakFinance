import { CreditCard, Lightning, ShieldCheck, WifiSlash } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { t } from '../../i18n/pt-BR';
import { isIOS, isStandalone } from '../../lib/platform';
import { Banner, BrandLogo, Button, GlassCard } from '../../ui';
import { useOnline } from './LoginScreen';

const FEATURES = [
  { icon: Lightning, key: 'onb.welcome.f1' },
  { icon: CreditCard, key: 'onb.welcome.f2' },
  { icon: ShieldCheck, key: 'onb.welcome.f3' },
] as const;

/** Para onde o "Começar" leva: no iPhone fora do app instalado, o guia vem antes do login (UX §2.3). */
export function welcomeNext(nav: Navigator = navigator): string {
  return isIOS(nav) && !isStandalone(nav) ? '/instalar?p=ios' : '/entrar';
}

/** ON01 Boas-vindas (UX §3 ON01). */
export function WelcomeScreen() {
  const navigate = useNavigate();
  const online = useOnline();
  return (
    <section className="screen screen-welcome" data-screen="ON01" data-testid="screen-ON01">
      <h1 className="screen-title">
        <BrandLogo variant="wordmark" height={40} />
      </h1>
      <p>{t('onb.welcome.subtitle')}</p>
      <GlassCard level={2}>
        <ul className="welcome-features">
          {FEATURES.map(({ icon: Glyph, key }) => (
            <li key={key}>
              <Glyph size={24} aria-hidden="true" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </GlassCard>
      {!online && <Banner tone="warning" icon={WifiSlash} message={t('onb.welcome.offline')} />}
      <Button
        size="lg"
        fullWidth
        disabled={!online}
        disabledReason={t('onb.welcome.offline')}
        onClick={() => void navigate(welcomeNext())}
      >
        {t('onb.welcome.cta')}
      </Button>
      <Button variant="ghost" onClick={() => void navigate('/entrar')}>
        {t('onb.welcome.returning')}
      </Button>
    </section>
  );
}
