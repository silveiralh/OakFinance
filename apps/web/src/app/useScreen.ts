import { useEffect } from 'react';
import { useLocation, useMatches } from 'react-router';
import { documentTitle, type ScreenId } from '../i18n/pt-BR';
import { type NavKey, resolveScreen, type ScreenHandle } from './screens';

function isScreenHandle(handle: unknown): handle is ScreenHandle {
  return typeof handle === 'object' && handle !== null && 'screen' in handle;
}

export interface CurrentScreen {
  screen: ScreenId | null;
  nav: NavKey | null;
}

/** Tela da rota mais interna com `handle` (tabela de `screens.ts`). */
export function useCurrentScreen(): CurrentScreen {
  const matches = useMatches();
  const location = useLocation();
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const handle = matches[i]?.handle;
    if (isScreenHandle(handle)) {
      return {
        screen: resolveScreen(handle, new URLSearchParams(location.search)),
        nav: handle.nav ?? null,
      };
    }
  }
  return { screen: null, nav: null };
}

/** `<title>` "{Tela} · OakFinance" (UX §4.11.1). */
export function useDocumentTitle(screen: ScreenId | null) {
  useEffect(() => {
    if (screen) {
      document.title = documentTitle(screen);
    }
  }, [screen]);
}
