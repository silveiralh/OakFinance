import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { InstallCard } from '../src/features/dashboard/InstallCard';
import { InstallScreen } from '../src/features/onboarding/InstallScreen';
import { WelcomeScreen, welcomeNext } from '../src/features/onboarding/WelcomeScreen';
import {
  captureInstallEvents,
  installTarget,
  iosVersion,
  isIOS,
  isOldIosWithoutPush,
  isStandalone,
  markInstallDismissed,
  markInstallSkipped,
  promptInstall,
  readInstallChoices,
  resetInstallState,
  showInstallCard,
} from '../src/lib/platform';
import { fakeAuth } from './auth-fixture';

const IPHONE_17 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_16_3 = IPHONE_17.replace('17_5', '16_3');
const IPHONE_CHROME = IPHONE_17.replace('Version/17.5', 'CriOS/131.0');
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';

function asUserAgent(ua: string, extra: Record<string, unknown> = {}) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  for (const [key, value] of Object.entries(extra)) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
}

function mount(
  element: React.ReactNode,
  path: string,
  status: 'signedIn' | 'signedOut' = 'signedOut',
) {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: [path] });
  render(
    <AuthContext.Provider value={fakeAuth(status)}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

afterEach(() => {
  resetInstallState();
  localStorage.clear();
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
});

describe('plataforma (UX §3 ON01)', () => {
  it('isIOS inclui o iPad que se apresenta como Mac; standalone por display-mode ou navigator.standalone', () => {
    expect(isIOS({ userAgent: IPHONE_17 })).toBe(true);
    expect(isIOS({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(false);
    expect(isIOS({ userAgent: ANDROID })).toBe(false);
    expect(
      isStandalone({ userAgent: IPHONE_17, standalone: true }, () => ({ matches: false })),
    ).toBe(true);
    expect(isStandalone({ userAgent: ANDROID }, () => ({ matches: true }))).toBe(true);
    expect(isStandalone({ userAgent: ANDROID }, () => ({ matches: false }))).toBe(false);
    expect(isStandalone({ userAgent: ANDROID }, undefined)).toBe(false);
    expect(installTarget({ userAgent: ANDROID })).toBe('android');
    expect(installTarget({ userAgent: IPHONE_17 })).toBe('ios');
    expect(installTarget({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('desktop');
  });

  it('US-06: iOS anterior à 16.4 não tem push', () => {
    expect(iosVersion(IPHONE_17)).toEqual([17, 5]);
    expect(iosVersion(ANDROID)).toBeNull();
    expect(isOldIosWithoutPush(IPHONE_16_3)).toBe(true);
    expect(isOldIosWithoutPush(IPHONE_17.replace('17_5', '16_4'))).toBe(false);
    expect(isOldIosWithoutPush(IPHONE_17.replace('17_5', '15_8'))).toBe(true);
    expect(isOldIosWithoutPush(IPHONE_17)).toBe(false);
    expect(isOldIosWithoutPush(ANDROID)).toBe(false);
  });

  it('"Agora não" devolve o card depois de 3 dias, no máximo 2 vezes; "Continuar no navegador" mantém o card', () => {
    const t0 = Date.UTC(2026, 10, 6);
    expect(showInstallCard(readInstallChoices(), false, t0)).toBe(false);
    markInstallDismissed(t0);
    expect(showInstallCard(readInstallChoices(), false, t0 + 86_400_000)).toBe(false);
    expect(showInstallCard(readInstallChoices(), false, t0 + 3 * 86_400_000)).toBe(true);
    markInstallDismissed(t0);
    markInstallDismissed(t0);
    expect(readInstallChoices().dismissCount).toBe(3);
    expect(showInstallCard(readInstallChoices(), false, t0 + 9 * 86_400_000)).toBe(false);
    markInstallSkipped();
    expect(showInstallCard(readInstallChoices(), false, t0)).toBe(true);
    expect(showInstallCard(readInstallChoices(), true, t0)).toBe(false);
    localStorage.setItem('oak.install', '{quebrado');
    expect(readInstallChoices()).toEqual({ skipped: false, dismissedAt: null, dismissCount: 0 });
  });

  it('US-07: beforeinstallprompt é capturado; o "Instalar app" abre o diálogo nativo; appinstalled pede persist()', async () => {
    const target = new EventTarget();
    const onInstalled = vi.fn();
    captureInstallEvents(target as unknown as Window, onInstalled);
    expect(await promptInstall()).toBe(false);
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(await promptInstall()).toBe(true);
    expect(prompt).toHaveBeenCalled();
    target.dispatchEvent(new Event('appinstalled'));
    expect(onInstalled).toHaveBeenCalled();
  });
});

describe('ON01 Boas-vindas', () => {
  it('US-06: no iPhone fora do app instalado, "Começar" leva ao guia antes do login; nos demais, ao login', async () => {
    asUserAgent(IPHONE_17);
    expect(welcomeNext()).toBe('/instalar?p=ios');
    const router = mount(<WelcomeScreen />, '/boas-vindas');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('OakFinance');
    expect(screen.getByText('Lançamento rápido, também sem internet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Começar' }));
    await waitFor(() => expect(router.state.location.search).toBe('?p=ios'));
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(welcomeNext()).toBe('/entrar');
    asUserAgent(ANDROID);
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
    expect(welcomeNext()).toBe('/entrar');
  });

  it('"Já uso em outro aparelho" vai direto ao login; sem rede, o botão fica desativado com o motivo', async () => {
    const router = mount(<WelcomeScreen />, '/boas-vindas');
    fireEvent.click(screen.getByRole('button', { name: 'Já uso em outro aparelho' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('button', { name: /Começar/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('ON02 Instalar (US-06, US-07)', () => {
  it('US-06: guia do Safari em 3 passos e "Continuar no navegador" marca o card e vai ao login', async () => {
    asUserAgent(IPHONE_17);
    const router = mount(<InstallScreen />, '/instalar?p=ios');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Instale o OakFinance no iPhone',
    );
    expect(
      screen.getByText(
        'No iPhone, os lembretes só funcionam com o app na Tela de Início. Leva cerca de 20 segundos.',
      ),
    ).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual([
      'Toque em Compartilhar (quadrado com seta para cima) na barra inferior.',
      'Role e toque em Adicionar à Tela de Início.',
      'Toque em Adicionar.',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar no navegador por enquanto' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(readInstallChoices().skipped).toBe(true);
  });

  it('US-06: fora do Safari, "Abra este link no Safari" com "Copiar link"; iOS antigo avisa sobre os lembretes', () => {
    asUserAgent(IPHONE_CHROME.replace('17_5', '16_3'));
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(<InstallScreen />, '/instalar?p=ios');
    expect(screen.getByText('Para instalar, abra este link no Safari.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(
      screen.getByText(
        'Neste iOS os lembretes não chegam como notificação; você os verá dentro do app',
      ),
    ).toBeInTheDocument();
  });

  it('US-06/US-07: aberto pelo ícone (standalone), nenhum convite de instalação', async () => {
    asUserAgent(IPHONE_17, { standalone: true });
    const router = mount(<InstallScreen />, '/instalar?p=ios');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
  });

  it('US-07: Android com prompt: "Instalar app"; depois do appinstalled, "Continuar" vai ao ON04', async () => {
    asUserAgent(ANDROID);
    const target = new EventTarget();
    captureInstallEvents(target as unknown as Window);
    const prompt = vi.fn(() => Promise.resolve());
    target.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt,
        userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      }),
    );
    const router = mount(<InstallScreen />, '/instalar?p=android', 'signedIn');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Instale o OakFinance no Android',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Instalar app' }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    act(() => {
      target.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.getByText('App instalado. Abra pelo ícone na tela inicial.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/boas-vindas/lembretes'));
  });

  it('US-07: sem o prompt, instruções manuais do menu ⋮; "Agora não" registra e segue', async () => {
    asUserAgent(ANDROID);
    const router = mount(<InstallScreen />, '/instalar?p=android', 'signedIn');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      'Toque no menu ⋮ no canto superior.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/boas-vindas/lembretes'));
    expect(readInstallChoices().dismissCount).toBe(1);
  });

  it('computador: texto do ON02c e instrução da barra de endereço', () => {
    asUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36');
    mount(<InstallScreen />, '/instalar?p=desktop');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Instalar no computador');
    expect(
      screen.getByText('Instale no computador para analisar o mês em uma tela maior.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Clique no ícone de instalação na barra de endereço.'),
    ).toBeInTheDocument();
  });
});

describe('card de instalação no Início', () => {
  it('aparece depois de "Continuar no navegador" e leva ao guia da plataforma', async () => {
    asUserAgent(IPHONE_17);
    mount(<InstallCard />, '/');
    expect(screen.queryByTestId('install-card')).not.toBeInTheDocument();
  });

  it('com a escolha de pular, mostra "Instale o app para receber lembretes"', async () => {
    asUserAgent(IPHONE_17);
    markInstallSkipped();
    const router = mount(<InstallCard />, '/');
    expect(screen.getByTestId('install-card')).toHaveTextContent(
      'Instale o app para receber lembretes',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Instalar app' }));
    await waitFor(() => expect(router.state.location.search).toBe('?p=ios'));
  });
});
