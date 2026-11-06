// T-062: H02 Central de avisos e sino (US-37, RN-86).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { NoticesBell } from '../src/app/NoticesBell';
import type { LocalRow } from '../src/data/db';
import { unreadCount, visibleNotices } from '../src/features/notices/model';
import { NoticesScreen, noticeWhen } from '../src/features/notices/NoticesScreen';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

const NOW = new Date('2026-11-15T15:00:00.000Z'); // 12:00 em São Paulo

function notice(id: string, over: Partial<LocalRow<'notices'>> = {}): LocalRow<'notices'> {
  return makeRow('notices', {
    id,
    kind: 'bill_due',
    dedupe_key: `k-${id}`,
    title: `Título ${id}`,
    body: `Texto ${id}`,
    navigate: '/planejar/futuro',
    read_at: null,
    deleted_at: null,
    created_at: '2026-11-15T12:00:00.000Z',
    ...over,
  });
}

async function mount(rows: LocalRow<'notices'>[]) {
  const auth: AuthValue = fakeAuth();
  await auth.user?.db.notices.bulkPut(rows);
  const router = createMemoryRouter(
    [
      {
        path: '/avisos',
        element: (
          <>
            <NoticesBell />
            <NoticesScreen now={NOW} />
          </>
        ),
      },
      { path: '*', element: <p data-testid="destino">destino</p> },
    ],
    { initialEntries: ['/avisos'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return { auth, router };
}

describe('H02 — Central de avisos (US-37)', () => {
  it('US-37: o sino mostra "Avisos, 2 não lidos" e a lista vem do mais recente ao mais antigo', async () => {
    await mount([
      notice('a', { created_at: '2026-11-14T12:00:00.000Z' }),
      notice('b'),
      notice('c', { created_at: '2026-11-01T12:00:00.000Z', read_at: '2026-11-02T12:00:00.000Z' }),
    ]);
    const bell = await screen.findByRole('link', { name: 'Avisos, 2 não lidos' });
    expect(bell).toHaveAttribute('href', '/avisos');
    expect(within(bell).getByTestId('notices-count')).toHaveTextContent('2');
    const items = await screen.findAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-testid'))).toEqual([
      'notice-b',
      'notice-a',
      'notice-c',
    ]);
    const first = items[0] as HTMLElement;
    expect(first).toHaveTextContent('Título b');
    expect(first).toHaveTextContent('Texto b');
    expect(first).toHaveTextContent('Hoje');
    expect(first).toHaveTextContent('Não lido');
    expect(items[1]).toHaveTextContent('Ontem');
    expect(items[2]).toHaveTextContent('01/11/2026');
    expect(items[2]).not.toHaveTextContent('Não lido');
  });

  it('US-37: tocar abre a tela certa e marca como lido', async () => {
    const { auth, router } = await mount([notice('a')]);
    fireEvent.click(await screen.findByRole('button', { name: /Título a/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/planejar/futuro'));
    expect((await auth.user?.db.notices.get('a'))?.read_at).not.toBeNull();
  });

  it('US-37: "Marcar todos como lidos" zera o contador', async () => {
    const { auth } = await mount([notice('a'), notice('b')]);
    fireEvent.click(await screen.findByTestId('notices-read-all'));
    await waitFor(async () =>
      expect(unreadCount((await auth.user?.db.notices.toArray()) ?? [], NOW)).toBe(0),
    );
    expect(await screen.findByRole('link', { name: 'Avisos, 0 não lidos' })).toBeInTheDocument();
    expect(screen.queryByTestId('notices-count')).toBeNull();
  });

  it('US-37: lidos há mais de 60 dias somem; não lidos antigos continuam', () => {
    const rows = [
      notice('velho-lido', {
        created_at: '2026-08-01T12:00:00.000Z',
        read_at: '2026-09-15T12:00:00.000Z',
      }),
      notice('lido-60', {
        created_at: '2026-09-01T12:00:00.000Z',
        read_at: '2026-09-16T12:00:00.000Z',
      }),
      notice('velho-nao-lido', { created_at: '2026-07-01T12:00:00.000Z' }),
      notice('excluido', { deleted_at: '2026-11-10T12:00:00.000Z' }),
    ];
    expect(visibleNotices(rows, NOW).map((n) => n.id)).toEqual(['lido-60', 'velho-nao-lido']);
  });

  it('vazio: "Nenhum aviso" e "Vencimentos, limites e conexões aparecem aqui."', async () => {
    await mount([]);
    expect(await screen.findByText('Nenhum aviso')).toBeInTheDocument();
    expect(screen.getByText('Vencimentos, limites e conexões aparecem aqui.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Avisos, 0 não lidos' })).toBeInTheDocument();
  });

  it('data relativa no fuso de São Paulo (02:00 UTC ainda é o dia anterior)', () => {
    expect(noticeWhen(notice('x', { created_at: '2026-11-15T02:00:00.000Z' }), NOW)).toBe('Ontem');
  });
});
