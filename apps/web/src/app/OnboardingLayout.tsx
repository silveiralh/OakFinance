import { Outlet, useNavigation } from 'react-router';
import { AppBackdrop } from '../ui';
import { useCurrentScreen, useDocumentTitle } from './useScreen';

/** Moldura do onboarding (UX §2.3): fundo e conteúdo cheio, sem abas nem FAB. */
export function OnboardingLayout() {
  const { screen } = useCurrentScreen();
  useDocumentTitle(screen);
  const navigation = useNavigation();
  return (
    <>
      <AppBackdrop />
      <main id="conteudo" className="onboarding" aria-busy={navigation.state === 'loading'}>
        <Outlet />
      </main>
    </>
  );
}
