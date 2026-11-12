// T-119: Q01 e folhas (UXA-003 teclado e Lançar no rodapé fixo, UXA-008 foco no valor, UXA-027 "Mais" como chip e
// grupo "Categoria", G5 seleção que não depende só da cor, UXA-010 cabeçalho fixo da folha).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { resetDrafts, saveDraft } from '../src/data/drafts';
import { createAccount } from '../src/data/repositories/accounts';
import { ensureSeeds } from '../src/data/seeds';
import { DRAFT_KEY } from '../src/features/quick-entry/model';
import { QuickEntrySheet } from '../src/features/quick-entry/QuickEntrySheet';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

const TODAY = '2026-11-05';
const here = dirname(fileURLToPath(import.meta.url));
const css = (rel: string) =>
  readFileSync(join(here, '../src', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

async function setup() {
  const auth = fakeAuth('signedIn');
  const user = auth.user;
  if (!user) {
    throw new Error('sem usuário');
  }
  await ensureSeeds(user.db, user.userId);
  await createAccount(
    user.db,
    user.userId,
    { name: 'BB', type: 'checking', initialBalanceOn: TODAY },
    { id: 'bb' },
  );
  return auth;
}

function mount(auth: ReturnType<typeof fakeAuth>) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ToastProvider>
            <QuickEntrySheet onClose={vi.fn()} today={TODAY} />
          </ToastProvider>
        ),
      },
    ],
    { initialEntries: ['/?novo=despesa'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}

function coarsePointer() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('coarse'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  resetDrafts();
  vi.unstubAllGlobals();
});

describe('T-119: Q01 no celular', () => {
  it('UXA-008: o Q01 abre com o foco no valor, não no seletor Despesa', async () => {
    mount(await setup());
    const amount = await screen.findByLabelText('Valor');
    await waitFor(() => expect(document.activeElement).toBe(amount));
  });

  it('UXA-003: com ponteiro grosso, teclado e Lançar ficam juntos no rodapé fixo, depois das categorias', async () => {
    coarsePointer();
    mount(await setup());
    const footer = await screen.findByTestId('quick-footer');
    expect(within(footer).getByTestId('quick-submit')).toBeInTheDocument();
    fireEvent.click(within(footer).getByRole('button', { name: '4' }));
    fireEvent.click(within(footer).getByRole('button', { name: '5' }));
    fireEvent.click(within(footer).getByRole('button', { name: '9' }));
    fireEvent.click(within(footer).getByRole('button', { name: '0' }));
    expect(screen.getByLabelText('Valor')).toHaveValue('R$\u00A045,90');
    // o teclado não fica mais colado ao valor: as categorias vêm antes dele na folha
    const chips = screen.getByRole('radiogroup', { name: 'Categoria' });
    expect(chips.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '4' })).toHaveLength(1);
  });

  it('UXA-027: "Mais" é um chip e o grupo de categorias se chama "Categoria"', async () => {
    mount(await setup());
    const group = await screen.findByRole('radiogroup', { name: 'Categoria' });
    const more = within(group).getByRole('button', { name: 'Mais' });
    expect(more.classList.contains('chip')).toBe(true);
  });
});

describe('T-119: CSS das folhas e da seleção', () => {
  it('UXA-003/UXA-010: rodapé do Q01 e cabeçalho da folha fixos', () => {
    expect(css('app/shell.css')).toMatch(/\.quick-footer\s*\{[^}]*position:\s*sticky/);
    expect(css('ui/ui.css')).toMatch(/\.sheet-head\s*\{[^}]*position:\s*sticky/);
  });

  it('G5 (UXA-009, UXA-011, UXB-023): seleção com contorno pelo token, também em aria-pressed e no escuro', () => {
    const ui = css('ui/ui.css');
    expect(ui).toMatch(
      /\.segmented label\[data-checked="true"\]\s*\{[^}]*inset 0 0 0 2px var\(--selection-outline\)/,
    );
    expect(ui).toMatch(/\.chip\[data-selected="true"\],\s*\.chip\[aria-pressed="true"\]\s*\{/);
    expect(css('app/shell.css')).toMatch(
      /\.list-chip\[data-selected="true"\]\s*\{[^}]*var\(--selection-outline\)/,
    );
    const tokens = css('styles/tokens.css');
    expect(tokens).toMatch(/--selection-outline:\s*var\(--ink-950\)/);
    expect(tokens).toMatch(/--selection-outline:\s*var\(--mist-50\)/);
  });

  it('UXA-027: valor centrado; UXC-008: trilho do segmentado rebaixado', () => {
    const ui = css('ui/ui.css');
    expect(ui).toMatch(/\.amount-input\s*\{[^}]*text-align:\s*center/);
    expect(ui).toMatch(/\.segmented\s*\{[^}]*background:\s*var\(--surface-inset\)/);
  });
});

describe('T-132: Q01 no celular pequeno (auditoria 12/11)', () => {
  it('US-12 (UX2A-001): com ponteiro grosso, o valor fica no rodapé fixo, logo acima do teclado, e "Ler nota" na linha do tipo', async () => {
    coarsePointer();
    mount(await setup());
    const footer = await screen.findByTestId('quick-footer');
    const amount = within(footer).getByLabelText('Valor');
    const keypad = within(footer).getByRole('group', { name: 'Teclado numérico' });
    expect(amount.compareDocumentPosition(keypad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByLabelText('Valor')).toHaveLength(1);
    const readNote = screen.getByTestId('quick-read-note');
    expect(readNote.closest('.quick-head')).not.toBeNull();
    expect(readNote).toHaveAccessibleName('Ler nota');
    // a folha usa quase a tela toda para tudo caber a 360×640
    expect(css('app/shell.css')).toMatch(
      /@media \(max-height: 720px\)[\s\S]*\.quick-chips[\s\S]*repeat\(3/,
    );
  });

  it('US-12 (UX2A-008): com a descrição em foco, o teclado numérico sai da frente e volta ao sair', async () => {
    coarsePointer();
    mount(await setup());
    fireEvent.click(await screen.findByRole('button', { name: /Mais detalhes/ }));
    const description = await screen.findByLabelText('Descrição');
    fireEvent.focus(description);
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Teclado numérico' })).toBeNull(),
    );
    fireEvent.blur(description);
    expect(await screen.findByRole('group', { name: 'Teclado numérico' })).toBeInTheDocument();
  });

  it('US-13 (UX2A-002): "?novo=receita" abre a receita mesmo com um rascunho de despesa guardado', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await saveDraft(db, DRAFT_KEY, {
      savedAt: Date.now(),
      mode: 'expense',
      amount: 4590,
      categoryId: null,
      description: '',
      notes: '',
      date: TODAY,
    });
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <QuickEntrySheet onClose={vi.fn()} today={TODAY} mode="income" />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/?novo=receita'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const income = await screen.findByRole('radio', { name: 'Receita' });
    await new Promise((r) => setTimeout(r, 50));
    expect(income).toBeChecked();
    expect(screen.getByLabelText('Valor')).toHaveValue('R$\u00A00,00');
  });
});
