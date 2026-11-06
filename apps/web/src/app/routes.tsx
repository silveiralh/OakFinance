import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { RedirectIfSignedIn, RequireSession } from './guards';
import { OnboardingLayout } from './OnboardingLayout';
import { ScreenError } from './ScreenError';
import { Splash } from './Splash';
import {
  ONBOARDING_SCREENS,
  PLAN_INDEX,
  PUBLIC_SCREENS,
  type ScreenRoute,
  SHELL_SCREENS,
} from './screens';

function toRoute({ path, handle, load }: ScreenRoute): RouteObject {
  return {
    path,
    handle,
    lazy: async () => ({ Component: await load() }),
  };
}

/** Rotas só do build E2E (a constante é substituída no build e o ramo some do bundle de produção). */
function e2eRoutes(): RouteObject[] {
  if (import.meta.env.VITE_E2E !== '1') {
    return [];
  }
  return [
    {
      path: '/__erro',
      handle: { screen: 'H01' },
      lazy: async () => ({ Component: (await import('./e2e/Boom')).Boom }),
    },
  ];
}

/**
 * Árvore de rotas (UX §2.1–§2.2): telas do app só com sessão (AppShell e onboarding pós-login), boas-vindas e
 * entrada só sem sessão, e qualquer caminho desconhecido volta ao Início. O G09 fica em duas camadas: dentro do AppShell (a moldura continua) e na raiz.
 */
export function appRoutes(): RouteObject[] {
  return [
    {
      id: 'root',
      HydrateFallback: Splash,
      ErrorBoundary: ScreenError,
      children: [
        {
          Component: RequireSession,
          children: [
            {
              Component: AppShell,
              children: [
                {
                  ErrorBoundary: ScreenError,
                  children: [
                    ...SHELL_SCREENS.map(toRoute),
                    { path: '/planejar', element: <Navigate to={PLAN_INDEX} replace /> },
                    ...e2eRoutes(),
                  ],
                },
              ],
            },
            {
              Component: OnboardingLayout,
              children: [{ ErrorBoundary: ScreenError, children: ONBOARDING_SCREENS.map(toRoute) }],
            },
          ],
        },
        {
          Component: RedirectIfSignedIn,
          children: [
            {
              Component: OnboardingLayout,
              children: [{ ErrorBoundary: ScreenError, children: PUBLIC_SCREENS.map(toRoute) }],
            },
          ],
        },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ];
}

export function createAppRouter() {
  return createBrowserRouter(appRoutes());
}
