import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateTarget, reloadBlocked, UpdatePrompt } from '../src/app/UpdatePrompt';
import { MANIFEST } from '../src/lib/manifest';
import {
  applyUpdate,
  isUpdateActivated,
  isUpdateReady,
  registerServiceWorker,
  resetUpdateState,
  type WorkboxLike,
} from '../src/lib/sw-update';
import {
  broadcast,
  type ClientsLike,
  isSkipWaiting,
  notificationFromPush,
  openFromNotification,
  PUSH_RESUBSCRIBE,
  parsePushData,
  RUN_SYNC,
  safeNavigate,
  type WindowClientLike,
} from '../src/sw/handlers';
import { ToastProvider } from '../src/ui';

const here = dirname(fileURLToPath(import.meta.url));
const ux = readFileSync(join(here, '../../../docs/specs/03-ux-design-system.md'), 'utf8');
const tech = readFileSync(join(here, '../../../docs/specs/02-tech-spec.md'), 'utf8');
const origin = 'https://oak.example.test';

function specJson(source: string, after: string): unknown {
  const from = source.indexOf(after);
  const match = /```json\n([\s\S]*?)```/.exec(source.slice(from));
  return JSON.parse(match?.[1] ?? 'null');
}

class FakeWorkbox implements WorkboxLike {
  listeners = new Map<string, () => void>();
  skipped = 0;
  constructor(private readonly fail = false) {}
  addEventListener(type: 'waiting' | 'controlling', listener: () => void) {
    this.listeners.set(type, listener);
  }
  register() {
    return this.fail ? Promise.reject(new Error('sem SW')) : Promise.resolve({});
  }
  messageSkipWaiting() {
    this.skipped += 1;
  }
  fire(type: 'waiting' | 'controlling') {
    this.listeners.get(type)?.();
  }
}

function fakeClient(url: string, extra: Partial<WindowClientLike> = {}): WindowClientLike {
  return {
    url,
    focus: vi.fn(() => Promise.resolve()),
    navigate: vi.fn(() => Promise.resolve()),
    postMessage: vi.fn(),
    ...extra,
  };
}

function fakeClients(
  windows: WindowClientLike[],
): ClientsLike & { openWindow: ReturnType<typeof vi.fn> } {
  return {
    matchAll: vi.fn(() => Promise.resolve(windows)),
    openWindow: vi.fn(() => Promise.resolve(null)),
  };
}

afterEach(() => {
  resetUpdateState();
});

describe('US-03: manifest (UX §4.8 e §4.11.5)', () => {
  it('igual ao trecho do manifest da UX §4.11.5, com id e scope', () => {
    const { id, scope, ...rest } = MANIFEST;
    expect(rest).toEqual(specJson(ux, 'Trecho do `manifest.webmanifest`'));
    expect(id).toBe('/');
    expect(scope).toBe('/');
  });

  it('name e short_name "OakFinance", standalone, ícones 192, 512 e maskable', () => {
    expect(MANIFEST.name).toBe('OakFinance');
    expect(MANIFEST.short_name).toBe('OakFinance');
    expect(MANIFEST.display).toBe('standalone');
    const sizes = MANIFEST.icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
    expect(sizes).toEqual(
      expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']),
    );
  });
});

describe('Service Worker: push declarativo (tech §6.4.3)', () => {
  it('payload do contrato vira a notificação, com navigate relativo ao app', () => {
    const payload = specJson(tech, '#### 6.4.3 Payload');
    const spec = notificationFromPush(
      JSON.parse(JSON.stringify(payload).replace('https://<APP_ORIGIN>', origin)),
      origin,
    );
    expect(spec.title).toBe('Fatura do Nubank vence em 3 dias');
    expect(spec.options).toEqual({
      body: 'Toque para ver o resumo.',
      lang: 'pt-BR',
      tag: 'invoice_due:<invoiceId>',
      silent: false,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { navigate: '/faturas/%3CinvoiceId%3E' },
    });
    expect(spec.badgeCount).toBe(1);
  });

  it('sempre mostra uma notificação, mesmo com payload vazio ou inválido (Safari)', () => {
    for (const payload of [
      null,
      {},
      { notification: 'x' },
      [],
      { notification: { title: '  ' } },
    ]) {
      const spec = notificationFromPush(payload, origin);
      expect(spec.title).toBe('OakFinance');
      expect(spec.options.data.navigate).toBe('/');
      expect(spec.badgeCount).toBeNull();
    }
    expect(notificationFromPush({ notification: { app_badge: -1 } }, origin).badgeCount).toBeNull();
    expect(notificationFromPush({ notification: { silent: true } }, origin).options.silent).toBe(
      true,
    );
  });

  it('parsePushData: JSON, texto solto e vazio', () => {
    expect(parsePushData('{"a":1}')).toEqual({ a: 1 });
    expect(parsePushData('olá')).toEqual({ notification: { body: 'olá' } });
    expect(parsePushData('')).toBeNull();
    expect(parsePushData(null)).toBeNull();
  });

  it('navigate de outra origem ou inválido vira o Início', () => {
    expect(safeNavigate('https://outro.example.test/x', origin)).toBe('/');
    expect(safeNavigate('/cartoes?mes=2026-11#a', origin)).toBe('/cartoes?mes=2026-11#a');
    expect(safeNavigate('http://[', origin)).toBe('/');
    expect(safeNavigate(42, origin)).toBe('/');
  });
});

describe('Service Worker: notificationclick, sync e mensagens (tech §4.8)', () => {
  it('foca a janela já focada e navega para data.navigate', async () => {
    const other = fakeClient(`${origin}/`);
    const focused = fakeClient(`${origin}/lancamentos`, { focused: true });
    const clients = fakeClients([other, focused]);
    await openFromNotification(clients, { navigate: '/cartoes' }, origin);
    expect(focused.focus).toHaveBeenCalled();
    expect(focused.navigate).toHaveBeenCalledWith(`${origin}/cartoes`);
    expect(other.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('sem janela aberta, abre uma nova', async () => {
    const clients = fakeClients([]);
    await openFromNotification(clients, { navigate: '/avisos' }, origin);
    expect(clients.openWindow).toHaveBeenCalledWith(`${origin}/avisos`);
  });

  it('janela já na rota só ganha foco; navigate que falha cai na mensagem NAVIGATE', async () => {
    const same = fakeClient(`${origin}/avisos`);
    await openFromNotification(fakeClients([same]), { navigate: '/avisos' }, origin);
    expect(same.navigate).not.toHaveBeenCalled();
    const broken = fakeClient(`${origin}/`, {
      navigate: vi.fn(() => Promise.reject(new Error('não controlada'))),
    });
    await openFromNotification(fakeClients([broken]), null, origin);
    expect(broken.postMessage).not.toHaveBeenCalled();
    await openFromNotification(fakeClients([broken]), { navigate: '/cartoes' }, origin);
    expect(broken.postMessage).toHaveBeenCalledWith({ type: 'NAVIGATE', url: '/cartoes' });
    const { navigate: _omit, ...noNavigate } = fakeClient(`${origin}/`);
    await openFromNotification(fakeClients([noNavigate]), { navigate: '/nota' }, origin);
    expect(noNavigate.postMessage).toHaveBeenCalledWith({ type: 'NAVIGATE', url: '/nota' });
  });

  it('sync e pushsubscriptionchange avisam todas as janelas abertas', async () => {
    const a = fakeClient(`${origin}/`);
    const b = fakeClient(`${origin}/cartoes`);
    expect(await broadcast(fakeClients([a, b]), { type: RUN_SYNC })).toBe(2);
    expect(a.postMessage).toHaveBeenCalledWith({ type: 'RUN_SYNC' });
    expect(b.postMessage).toHaveBeenCalledWith({ type: 'RUN_SYNC' });
    expect(await broadcast(fakeClients([]), { type: PUSH_RESUBSCRIBE })).toBe(0);
  });

  it('só SKIP_WAITING ativa a versão em espera', () => {
    expect(isSkipWaiting({ type: 'SKIP_WAITING' })).toBe(true);
    expect(isSkipWaiting({ type: 'RUN_SYNC' })).toBe(false);
    expect(isSkipWaiting('SKIP_WAITING')).toBe(false);
  });
});

describe('US-03: registro e atualização do SW', () => {
  it('sem Service Worker ou fora do build, não registra', async () => {
    expect(await registerServiceWorker({ serviceWorker: undefined, enabled: true })).toBe(false);
    expect(await registerServiceWorker({ serviceWorker: {}, enabled: false })).toBe(false);
  });

  it('versão nova espera o "Atualizar"; só então pede SKIP_WAITING e marca a ativação', async () => {
    const wb = new FakeWorkbox();
    expect(
      await registerServiceWorker({ serviceWorker: {}, enabled: true, create: () => wb }),
    ).toBe(true);
    expect(
      await registerServiceWorker({ serviceWorker: {}, enabled: true, create: () => wb }),
    ).toBe(false);
    applyUpdate();
    expect(wb.skipped).toBe(0);
    wb.fire('controlling');
    expect(isUpdateActivated()).toBe(false);
    wb.fire('waiting');
    expect(isUpdateReady()).toBe(true);
    applyUpdate();
    expect(wb.skipped).toBe(1);
    wb.fire('controlling');
    expect(isUpdateActivated()).toBe(true);
  });

  it('falha no registro não derruba o app', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wb = new FakeWorkbox(true);
    expect(
      await registerServiceWorker({ serviceWorker: {}, enabled: true, create: () => wb }),
    ).toBe(false);
    expect(error).toHaveBeenCalled();
  });
});

describe('G07: "Nova versão disponível." (US-03)', () => {
  function mount(path: string, reload: () => void) {
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <UpdatePrompt reload={reload} />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: [path] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it('toast persistente com "Atualizar"; recarrega quando a versão nova assume', async () => {
    const wb = new FakeWorkbox();
    await registerServiceWorker({ serviceWorker: {}, enabled: true, create: () => wb });
    const reload = vi.fn();
    mount('/lancamentos', reload);
    expect(screen.queryByText('Nova versão disponível.')).not.toBeInTheDocument();
    act(() => wb.fire('waiting'));
    expect(screen.getByText('Nova versão disponível.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(wb.skipped).toBe(1);
    expect(reload).not.toHaveBeenCalled();
    act(() => wb.fire('controlling'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('US-03: nunca recarrega com o lançamento aberto; recarrega quando o sheet fecha', async () => {
    const wb = new FakeWorkbox();
    await registerServiceWorker({ serviceWorker: {}, enabled: true, create: () => wb });
    const reload = vi.fn();
    const router = mount('/lancamentos?novo=despesa', reload);
    act(() => wb.fire('waiting'));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    act(() => wb.fire('controlling'));
    expect(reload).not.toHaveBeenCalled();
    await act(() => router.navigate('/lancamentos'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('mensagem NAVIGATE do SW navega dentro do app; outras são ignoradas', async () => {
    const sw = new EventTarget();
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <UpdatePrompt reload={vi.fn()} serviceWorker={sw} />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    await act(async () => {
      sw.dispatchEvent(new MessageEvent('message', { data: { type: 'NAVIGATE', url: '/avisos' } }));
    });
    expect(router.state.location.pathname).toBe('/avisos');
    expect(navigateTarget({ type: 'NAVIGATE', url: '//outro.example.test' })).toBeNull();
    expect(navigateTarget({ type: 'RUN_SYNC' })).toBeNull();
    expect(navigateTarget(null)).toBeNull();
  });

  it('reloadBlocked olha o parâmetro do Q01', () => {
    expect(reloadBlocked('?novo=receita')).toBe(true);
    expect(reloadBlocked('?mes=2026-11')).toBe(false);
    expect(reloadBlocked('')).toBe(false);
  });
});
