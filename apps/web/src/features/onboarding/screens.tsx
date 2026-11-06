import { useSearchParams } from 'react-router';
import { ScreenStub } from '../../app/ScreenStub';
import { installScreen } from '../../app/screens';
import { t } from '../../i18n/pt-BR';

/** ON01: marca tipográfica e proposta (UX §3 ON01); o fluxo completo chega na T-037. */
export function WelcomeScreen() {
  return (
    <section className="screen screen-welcome" data-screen="ON01" data-testid="screen-ON01">
      <h1 className="screen-title">{t('onb.welcome.title')}</h1>
      <p>{t('onb.welcome.subtitle')}</p>
    </section>
  );
}

/** ON02a/b/c pelo parâmetro `p` (android, ios, desktop). */
export function InstallScreen() {
  const [params] = useSearchParams();
  return <ScreenStub screen={installScreen(params)} standalone />;
}

export function OnbRemindersScreen() {
  return <ScreenStub screen="ON04" standalone />;
}

export function OnbIncomeScreen() {
  return <ScreenStub screen="ON05" standalone />;
}

export function OnbAccountsScreen() {
  return <ScreenStub screen="ON06" standalone />;
}

export function OnbCardsScreen() {
  return <ScreenStub screen="ON07" standalone />;
}

export function OnbReserveScreen() {
  return <ScreenStub screen="ON07b" standalone />;
}

export function OnbDoneScreen() {
  return <ScreenStub screen="ON08" standalone />;
}

export { AuthCallback } from './AuthCallback';
export { LoginScreen } from './LoginScreen';
