import { Outlet, useNavigation } from 'react-router';
import { AppBackdrop, ToastProvider } from '../ui';
import { UpdatePrompt } from './UpdatePrompt';
import { useCurrentScreen, useDocumentTitle } from './useScreen';

/** Moldura do onboarding (UX §2.3): fundo e conteúdo cheio, sem abas nem FAB. */
export function OnboardingLayout() {
  const { screen } = useCurrentScreen();
  useDocumentTitle(screen);
  const navigation = useNavigation();
  return (
    <ToastProvider>
      <UpdatePrompt />
      <AppBackdrop />
      <main id="conteudo" className="onboarding" aria-busy={navigation.state === 'loading'}>
        <Outlet />
      </main>
    </ToastProvider>
  );
}
