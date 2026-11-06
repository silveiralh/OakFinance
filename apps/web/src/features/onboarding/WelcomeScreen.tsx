import { ArrowUpRight, CreditCard, ShieldCheck, WifiOff, Zap } from 'lucide-react';
import { useNavigate } from 'react-router';
import { t } from '../../i18n/pt-BR';
import { isIOS, isStandalone } from '../../lib/platform';
import { Banner, BrandLogo, Button } from '../../ui';
import { useOnline } from './LoginScreen';

const FEATURES = [
  { icon: Zap, key: 'onb.welcome.f1' },
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
        <BrandLogo variant="mono" height={32} />
      </h1>
      <p className="welcome-lead">{t('onb.welcome.subtitle')}</p>
      <ul className="welcome-features">
        {FEATURES.map(({ icon: Glyph, key }) => (
          <li key={key}>
            <span className="welcome-feature-icon" aria-hidden="true">
              <Glyph size={20} />
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      {!online && <Banner tone="warning" icon={WifiOff} message={t('onb.welcome.offline')} />}
      <div className="welcome-actions">
        <Button variant="ghost" onClick={() => void navigate('/entrar')}>
          {t('onb.welcome.returning')}
        </Button>
        <Button
          size="lg"
          iconEnd={ArrowUpRight}
          disabled={!online}
          disabledReason={t('onb.welcome.offline')}
          onClick={() => void navigate(welcomeNext())}
        >
          {t('onb.welcome.cta')}
        </Button>
      </div>
    </section>
  );
}
