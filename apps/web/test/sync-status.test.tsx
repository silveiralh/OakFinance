import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import {
  badgeState,
  isStalePending,
  OFFLINE_BANNER_MS,
  RejectedBanner,
  rejectedText,
  ShellSyncBadge,
  STALE_PENDING_MS,
  SyncBanners,
  syncFailedText,
  WipedDialog,
} from '../src/app/SyncStatus';
import type { SyncSnapshot } from '../src/data/sync/engine';
import { clearLocalData, hadLocalData, markLocalData } from '../src/lib/local-marker';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

const BASE: SyncSnapshot = {
  phase: 'done',
  pending: 0,
  rejected: 0,
  consecutiveFailures: 0,
  showErrorBanner: false,
  lastSyncAt: null,
  oldestPendingAt: null,
  recovering: false,
  remoteEdits: 0,
  remoteEditsSeq: 0,
};

/** Motor do fixture com o snapshot controlado pelo teste. */
function controlled(auth: AuthValue, initial: Partial<SyncSnapshot> = {}) {
  const engine = auth.user?.engine;
  if (!engine) {
    throw new Error('sem motor');
  }
  let snapshot: SyncSnapshot = { ...BASE, ...initial };
  const listeners = new Set<() => void>();
  vi.spyOn(engine, 'getSnapshot').mockImplementation(() => snapshot);
  vi.spyOn(engine, 'subscribe').mockImplementation((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  const syncNow = vi
    .spyOn(engine, 'syncNow')
    .mockResolvedValue({ ran: true, ok: true, failure: null });
  return {
    syncNow,
    emit(patch: Partial<SyncSnapshot>) {
      snapshot = { ...snapshot, ...patch };
      act(() => {
        for (const listener of listeners) {
          listener();
        }
      });
    },
  };
}

function mount(auth: AuthValue, ui: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: '/', element: ui },
      { path: '/ajustes', element: <p>ajustes</p> },
      { path: '/ajustes/diagnostico', element: <p>diagnóstico</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  return router;
}

const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
function setOnline(value: boolean) {
  Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}
afterEach(() => {
  vi.useRealTimers();
  if (online) {
    Object.defineProperty(Navigator.prototype, 'onLine', online);
  }
  localStorage.clear();
});

describe('estados do SyncBadge (UX §2.6)', () => {
  it('US-04: sem rede → offline; 3 falhas → erro; ciclo → sincronizando; fila → pendente; vazia → sincronizado', () => {
    expect(badgeState(BASE, false)).toBe('offline');
    expect(badgeState({ ...BASE, phase: 'offline' }, true)).toBe('offline');
    expect(badgeState(null, true)).toBe('synced');
    expect(badgeState({ ...BASE, showErrorBanner: true, pending: 3 }, true)).toBe('error');
    expect(badgeState({ ...BASE, phase: 'syncing', pending: 2 }, true)).toBe('syncing');
    expect(badgeState({ ...BASE, phase: 'error', pending: 2 }, true)).toBe('pending');
    expect(badgeState({ ...BASE, pending: 0 }, true)).toBe('synced');
  });

  it('US-04: o topo mostra "Offline" com os lançamentos salvos e tocar sincroniza', () => {
    const auth = fakeAuth('signedIn');
    const { syncNow } = controlled(auth, { phase: 'offline', pending: 3 });
    mount(auth, <ShellSyncBadge />);
    const badge = screen.getByRole('button', {
      name: 'Offline, 3 lançamentos salvos neste aparelho',
    });
    fireEvent.click(badge);
    expect(syncNow).toHaveBeenCalled();
  });

  it('sem sessão não há SyncBadge nem banners', () => {
    const auth = fakeAuth('signedOut');
    mount(
      auth,
      <>
        <ShellSyncBadge />
        <SyncBanners />
        <WipedDialog />
      </>,
    );
    expect(screen.queryByTestId('sync-badge')).toBeNull();
    expect(screen.queryByTestId('sync-banners')).toBeNull();
  });
});

describe('banners de sync (UX §3 G, US-64)', () => {
  it('US-64: G01 aparece sem rede e some depois de 4 s; fica o SyncBadge', () => {
    vi.useFakeTimers();
    const auth = fakeAuth('signedIn');
    controlled(auth);
    mount(auth, <SyncBanners />);
    expect(screen.queryByTestId('g01')).toBeNull();
    act(() => setOnline(false));
    expect(screen.getByTestId('g01')).toHaveTextContent(
      'Sem conexão. Você pode continuar lançando; tudo fica salvo no aparelho.',
    );
    act(() => {
      vi.advanceTimersByTime(OFFLINE_BANNER_MS);
    });
    expect(screen.queryByTestId('g01')).toBeNull();
    act(() => setOnline(true));
    expect(screen.queryByTestId('g01')).toBeNull();
  });

  it('US-04: G04 depois da 3ª falha seguida, com "Tentar novamente"', () => {
    const auth = fakeAuth('signedIn');
    const { emit, syncNow } = controlled(auth, { pending: 3, consecutiveFailures: 2 });
    mount(auth, <SyncBanners />);
    expect(screen.queryByTestId('g04')).toBeNull();
    emit({ consecutiveFailures: 3, showErrorBanner: true, phase: 'error' });
    expect(screen.getByTestId('g04')).toHaveTextContent(
      '3 lançamentos não foram sincronizados. Eles continuam salvos no aparelho.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(syncNow).toHaveBeenCalled();
    expect(syncFailedText(1)).toBe(
      '1 lançamento não foi sincronizado. Ele continua salvo no aparelho.',
    );
  });

  it('G18: pendência há mais de 24 h pede para abrir com internet', () => {
    const now = Date.UTC(2026, 10, 6, 12);
    const old = new Date(now - STALE_PENDING_MS - 1).toISOString();
    expect(isStalePending({ ...BASE, oldestPendingAt: old }, now)).toBe(true);
    expect(
      isStalePending({ ...BASE, oldestPendingAt: new Date(now - 1000).toISOString() }, now),
    ).toBe(false);
    expect(isStalePending({ ...BASE, oldestPendingAt: 'x' }, now)).toBe(false);
    expect(isStalePending(null, now)).toBe(false);
    const auth = fakeAuth('signedIn');
    controlled(auth, { pending: 1, oldestPendingAt: old });
    mount(auth, <SyncBanners now={() => now} />);
    expect(screen.getByTestId('g18')).toHaveTextContent(
      'Abra com internet para guardar suas alterações na nuvem.',
    );
  });

  it('US-05: pull do zero mostra "Recuperando seus dados…"', () => {
    const auth = fakeAuth('signedIn');
    const { emit } = controlled(auth);
    mount(auth, <SyncBanners />);
    emit({ recovering: true });
    expect(screen.getByTestId('g08-recovering')).toHaveTextContent('Recuperando seus dados…');
    emit({ recovering: false });
    expect(screen.queryByTestId('g08-recovering')).toBeNull();
  });

  it('G15: rejeitadas no Início com "Ver detalhes" levando ao Diagnóstico (S11)', async () => {
    expect(rejectedText(1)).toBe('1 alteração não sincronizou.');
    expect(rejectedText(2)).toBe('2 alterações não sincronizaram.');
    const auth = fakeAuth('signedIn');
    const { emit } = controlled(auth);
    const router = mount(auth, <RejectedBanner />);
    expect(screen.queryByTestId('g15')).toBeNull();
    emit({ rejected: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes/diagnostico'));
  });
});

describe('G08 — cópia local apagada pelo sistema (US-05, RN-100)', () => {
  it('marca local: grava, lê e apaga por usuário', () => {
    expect(hadLocalData('u')).toBe(false);
    markLocalData('u');
    markLocalData('u');
    markLocalData('v');
    expect(hadLocalData('u')).toBe(true);
    clearLocalData('u');
    expect(hadLocalData('u')).toBe(false);
    expect(hadLocalData('v')).toBe(true);
    localStorage.setItem('oak.localData', '{');
    expect(hadLocalData('v')).toBe(false);
  });

  it('US-05: banco vazio num aparelho que já teve a cópia → diálogo com "Baixar agora"', async () => {
    const auth = fakeAuth('signedIn');
    const userId = auth.user?.userId ?? '';
    markLocalData(userId);
    const { syncNow } = controlled(auth, { phase: 'idle' });
    mount(auth, <WipedDialog />);
    expect(
      await screen.findByText('O sistema liberou espaço e apagou a cópia local.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Baixar agora' }));
    expect(syncNow).toHaveBeenCalled();
  });

  it('primeiro acesso no aparelho não mostra o G08; depois do sync a marca é gravada', async () => {
    const auth = fakeAuth('signedIn');
    const userId = auth.user?.userId ?? '';
    const { emit } = controlled(auth, { phase: 'idle' });
    mount(auth, <WipedDialog />);
    emit({ phase: 'done' });
    await waitFor(() => expect(hadLocalData(userId)).toBe(true));
    expect(screen.queryByText('O sistema liberou espaço e apagou a cópia local.')).toBeNull();
  });
});
