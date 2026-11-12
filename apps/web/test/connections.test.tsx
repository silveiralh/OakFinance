// T-076: telas de conexão I01/I02 (US-45, US-46; RN-79, RN-80, RN-94). O aparelho só chama as Edge Functions e a
// RPC `map_external_account` (tech §6.1.3); aqui o cliente do Supabase é falso.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { applyMapping } from '../src/features/connections/api';
import { ConnectionBanner } from '../src/features/connections/ConnectionBanner';
import {
  BACKFILL_DAYS,
  bankName,
  cardMissing,
  connectionState,
  defaultChoice,
  type ExternalAccountDTO,
  errorText,
  linkTargets,
  mapArgs,
  normalizeItemId,
  refreshWait,
  syncSummary,
  updatedText,
} from '../src/features/connections/model';
import { ConnectBankScreen, ConnectionsScreen } from '../src/features/connections/screens';
import { SUMMARY_KEY_PREFIX } from '../src/features/connections/summary';
import { invokeFunction } from '../src/lib/functions';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

const NOW = Date.parse('2026-11-11T13:00:00Z'); // 10:00 em São Paulo

function external(over: Partial<ExternalAccountDTO> = {}): ExternalAccountDTO {
  return {
    id: 'ext-1',
    type: 'BANK',
    subtype: 'CHECKING_ACCOUNT',
    name: 'Conta Corrente',
    numberMasked: '1234',
    accountId: null,
    cardId: null,
    isIgnored: false,
    suggestion: null,
    ...over,
  };
}

function connectionRow(over: Partial<LocalRow<'bank_connections'>> = {}) {
  const iso = new Date(NOW).toISOString();
  return {
    id: 'conn-1',
    user_id: 'u',
    provider: 'pluggy',
    external_item_id: 'item-1',
    connector_id: 1,
    connector_name: 'MeuPluggy',
    institution: 'nubank',
    status: 'UPDATED',
    execution_status: null,
    consent_expires_at: null,
    last_synced_at: iso,
    last_success_at: '2026-11-11T10:40:00Z',
    provider_updated_at: null,
    last_error: null,
    is_active: true,
    last_manual_refresh_at: null,
    created_at: iso,
    updated_at: iso,
    client_updated_at: iso,
    deleted_at: null,
    server_version: 1,
    device_id: null,
    ...over,
  } as LocalRow<'bank_connections'>;
}

function tx(over: Partial<LocalRow<'transactions'>>): LocalRow<'transactions'> {
  return {
    id: crypto.randomUUID(),
    source: 'pluggy',
    account_id: 'acc-1',
    card_id: null,
    created_at: '2026-11-11T12:00:00Z',
    review_state: 'new',
    duplicate_of: null,
    deleted_at: null,
    ...over,
  } as LocalRow<'transactions'>;
}

const named = (id: string, name: string) => ({ id, name, deleted_at: null, archived_at: null });

describe('T-076: regras das telas de conexão', () => {
  it('US-45: Item ID colado passa pela limpeza; texto com espaço ou curto é recusado sem chamar a função', () => {
    expect(normalizeItemId('  7a1c2b3d-0000-4e5f-9a8b-1c2d3e4f5a6b ')).toBe(
      '7a1c2b3d-0000-4e5f-9a8b-1c2d3e4f5a6b',
    );
    expect(normalizeItemId('abc')).toBeNull();
    expect(normalizeItemId('item com espaço')).toBeNull();
  });

  it('US-45: Item ID inexistente mostra "Não encontramos essa conexão no Meu Pluggy. Confira o código."', () => {
    expect(errorText({ reason: 'failed', code: 'ITEM_NOT_FOUND' }, 'Nubank')).toBe(
      'Não encontramos essa conexão no Meu Pluggy. Confira o código.',
    );
    expect(errorText({ reason: 'offline' }, 'Nubank')).toBe('Precisa de internet');
    expect(errorText({ reason: 'timeout' }, 'Nubank')).toBe(
      'O serviço demorou para responder. Tente novamente.',
    );
    expect(errorText({ reason: 'failed', code: 'UPSTREAM_UNAVAILABLE' }, 'Nubank')).toBe(
      'O Nubank está indisponível agora. Tente novamente mais tarde.',
    );
  });

  it('RN-94: expira em breve com 7 dias ou menos; expirada no dia; erro com LOGIN_ERROR', () => {
    const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
    expect(connectionState({ status: 'UPDATED', consent_expires_at: null }, NOW)).toBe('active');
    expect(connectionState({ status: 'UPDATED', consent_expires_at: at(12) }, NOW)).toBe('active');
    expect(connectionState({ status: 'UPDATED', consent_expires_at: at(7) }, NOW)).toBe('expiring');
    expect(connectionState({ status: 'UPDATED', consent_expires_at: at(0) }, NOW)).toBe('expired');
    expect(connectionState({ status: 'LOGIN_ERROR', consent_expires_at: null }, NOW)).toBe(
      'reconnect',
    );
    expect(connectionState({ status: 'UPDATING', consent_expires_at: null }, NOW)).toBe('updating');
  });

  it('RN-80: "Atualizar agora" no máximo 1 vez por hora ("Atualizado há {n} min. Tente de novo em {m} min.")', () => {
    expect(refreshWait(null, NOW)).toBeNull();
    expect(refreshWait(new Date(NOW - 20 * 60_000).toISOString(), NOW)).toEqual({
      ago: 20,
      wait: 40,
    });
    expect(refreshWait(new Date(NOW - 60 * 60_000).toISOString(), NOW)).toBeNull();
  });

  it('UX I01: "Atualizado hoje às 07:40" no fuso de São Paulo, e com a data em outro dia', () => {
    expect(updatedText('2026-11-11T10:40:00Z', NOW)).toBe('Atualizado hoje às 07:40');
    expect(updatedText('2026-11-10T22:40:00Z', NOW)).toBe('Atualizado em 10/11 às 19:40');
    expect(updatedText(null, NOW)).toBeNull();
  });

  it('RN-79: cartão do banco vincula a cartões; conta, a contas', () => {
    const accounts = [named('a1', 'Nubank')];
    const cards = [named('c1', 'Roxinho'), { ...named('c2', 'Velho'), archived_at: 'x' }];
    expect(linkTargets(external(), accounts, cards)).toEqual([
      { value: 'account:a1', label: 'Nubank' },
    ]);
    expect(
      linkTargets(external({ type: 'CREDIT', subtype: 'CREDIT_CARD' }), accounts, cards),
    ).toEqual([{ value: 'card:c1', label: 'Roxinho' }]);
  });

  it('RN-79: escolha inicial — mapeamento gravado, mesmo nome do banco, senão criar pré-preenchido', () => {
    const targets = [{ value: 'account:a1', label: 'Nubank' }];
    expect(defaultChoice(external({ accountId: 'a1' }), targets, 'Nubank')).toEqual({
      kind: 'link',
      target: 'account:a1',
    });
    expect(defaultChoice(external({ name: 'NUBANK' }), targets, 'Banco do Brasil')).toEqual({
      kind: 'link',
      target: 'account:a1',
    });
    expect(defaultChoice(external({ isIgnored: true }), targets, 'Nubank')).toEqual({
      kind: 'ignore',
    });
    expect(
      defaultChoice(
        external({
          type: 'CREDIT',
          subtype: 'CREDIT_CARD',
          name: 'Ultravioleta',
          suggestion: { closingDay: 3, dueDay: 10, limitCents: 500_000 },
        }),
        [],
        'Nubank',
      ),
    ).toEqual({ kind: 'create', name: 'Ultravioleta', closingDay: '3', dueDay: '10' });
  });

  it('RN-79: argumentos da map_external_account (conta, cartão ou ignorar)', () => {
    expect(mapArgs('e', { kind: 'account', id: 'a' })).toEqual({
      p_id: 'e',
      p_account_id: 'a',
      p_card_id: null,
      p_is_ignored: false,
    });
    expect(mapArgs('e', { kind: 'card', id: 'c' })).toMatchObject({ p_card_id: 'c' });
    expect(mapArgs('e', null)).toEqual({
      p_id: 'e',
      p_account_id: null,
      p_card_id: null,
      p_is_ignored: true,
    });
  });

  it('UX I02: Nubank sem o cartão avisa para importar a fatura em CSV', () => {
    expect(cardMissing([external()], 'nubank')).toBe(true);
    expect(cardMissing([external(), external({ type: 'CREDIT' })], 'nubank')).toBe(false);
    expect(cardMissing([external()], 'bb')).toBe(false);
    expect(bankName({ institution: 'bb', connector_name: 'MeuPluggy' })).toBe('Banco do Brasil');
    expect(bankName(null)).toBe('banco');
  });

  it('US-46: resumo "{n} novas · {m} vinculadas · {k} para conferir" só da conexão e desde a sincronização', () => {
    const rows = [
      tx({}),
      tx({ review_state: 'suggested' }),
      tx({ review_state: 'merged' }),
      tx({ account_id: 'outra' }),
      tx({ created_at: '2026-11-10T00:00:00Z' }),
      tx({ source: 'manual' }),
      tx({ account_id: null, card_id: 'card-1' }),
    ];
    expect(
      syncSummary(rows, '2026-11-11T11:00:00Z', {
        accounts: new Set(['acc-1']),
        cards: new Set(['card-1']),
      }),
    ).toEqual({ fresh: 2, linked: 1, review: 1 });
  });

  it('tech §6.0: invokeFunction devolve o código estável do erro da função', async () => {
    const client = {
      functions: {
        invoke: () =>
          Promise.resolve({
            data: null,
            error: {
              context: new Response(JSON.stringify({ error: { code: 'ITEM_NOT_FOUND' } }), {
                status: 404,
              }),
            },
          }),
      },
    };
    await expect(
      invokeFunction(client as never, 'pluggy-link-item', {}, { isOnline: () => true }),
    ).resolves.toEqual({ ok: false, reason: 'failed', code: 'ITEM_NOT_FOUND' });
  });
});

type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<unknown>;

function withClient(
  invoke: Invoke,
  rpc = vi.fn(() => Promise.resolve({ data: null, error: null })),
) {
  const auth = fakeAuth('signedIn', {
    client: { functions: { invoke: vi.fn(invoke) }, rpc } as unknown as AuthValue['client'],
  });
  return { auth, rpc };
}

function mount(auth: AuthValue, path: string) {
  const router = createMemoryRouter(
    [
      { path: '/ajustes/conexoes', element: <ConnectionsScreen /> },
      { path: '/ajustes/conexoes/novo', element: <ConnectBankScreen /> },
      { path: '/conferir', element: <p>conferir</p> },
      { path: '/importar', element: <p>importar</p> },
    ],
    { initialEntries: [path] },
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

function online(value: boolean) {
  vi.stubGlobal('navigator', { ...navigator, onLine: value });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ACCOUNTS: ExternalAccountDTO[] = [
  external({ id: 'ext-bank', name: 'Nubank' }),
  external({ id: 'ext-card', type: 'CREDIT', subtype: 'CREDIT_CARD', name: 'Cartão' }),
];

describe('US-45: conectar banco', () => {
  it('US-45: sem rede, "Conectar banco" fica indisponível com "Precisa de internet"', async () => {
    online(false);
    const { auth } = withClient(() => Promise.resolve({ data: null, error: null }));
    const router = mount(auth, '/ajustes/conexoes');
    const button = await screen.findByRole('button', { name: /Conectar banco/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Precisa de internet').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(router.state.location.pathname).toBe('/ajustes/conexoes');
    // importar extrato funciona sem rede (lido no aparelho)
    // UXD-008: o botão abre o seletor; o arquivo escolhido leva à I03
    expect(screen.getByRole('button', { name: 'Escolher arquivo' })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('connections-import-file'), {
      target: { files: [new File(['OFXHEADER:100'], 'extrato.ofx')] },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/importar'));
  });

  it('US-46: o card mostra o banco, a última atualização e o resumo da sincronização', async () => {
    online(true);
    const { auth } = withClient(() => Promise.resolve({ data: null, error: null }));
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem db');
    }
    await db.bank_connections.put(
      connectionRow({ last_success_at: new Date(Date.now() - 60_000).toISOString() }),
    );
    await db.kv.put({
      key: `${SUMMARY_KEY_PREFIX}conn-1`,
      value: { fresh: 12, linked: 3, review: 2 },
    });
    mount(auth, '/ajustes/conexoes');
    const card = await screen.findByTestId('bank-connection-conn-1');
    expect(within(card).getByText('Nubank')).toBeDefined();
    expect(within(card).getByText(/^Atualizado (hoje|em)/)).toBeDefined();
    expect(
      await within(card).findByText('12 novas · 3 vinculadas · 2 para conferir'),
    ).toBeDefined();
    expect(within(card).getByRole('button', { name: /Atualizar agora/ })).toBeDefined();
  });

  it('RN-80: "Atualizar agora" antes de 1 hora não chama a função e diz quando tentar', async () => {
    online(true);
    const invoke = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const { auth } = withClient(invoke);
    await auth.user?.db.bank_connections.put(
      connectionRow({ last_manual_refresh_at: new Date(Date.now() - 15 * 60_000).toISOString() }),
    );
    mount(auth, '/ajustes/conexoes');
    fireEvent.click(await screen.findByRole('button', { name: /Atualizar agora/ }));
    expect(
      await screen.findByText(/^Atualizado há 1[45] min\. Tente de novo em 4[56] min\.$/),
    ).toBeDefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('US-45: Item ID inexistente mostra o aviso e nada é salvo', async () => {
    online(true);
    const { auth, rpc } = withClient(() =>
      Promise.resolve({
        data: null,
        error: {
          context: new Response(JSON.stringify({ error: { code: 'ITEM_NOT_FOUND' } }), {
            status: 404,
          }),
        },
      }),
    );
    mount(auth, '/ajustes/conexoes/novo');
    expect(
      await screen.findByText(
        'A autorização é feita no Meu Pluggy. Suas credenciais bancárias não passam pelo OakFinance; o app recebe apenas os lançamentos.',
      ),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText('Item ID'), {
      target: { value: '7a1c2b3d-0000-4e5f-9a8b-1c2d3e4f5a6b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    expect(
      await screen.findByText('Não encontramos essa conexão no Meu Pluggy. Confira o código.'),
    ).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
    expect(await auth.user?.db.accounts.count()).toBe(0);
  });

  it('US-45: com Item ID, valida, mapeia (vincular e ignorar) e busca os últimos 90 dias', async () => {
    online(true);
    const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
    const { auth, rpc } = withClient((name, { body }) => {
      calls.push({ name, body });
      if (name === 'pluggy-link-item') {
        return Promise.resolve({
          data: { connectionId: 'conn-1', status: 'UPDATED', accounts: ACCOUNTS },
          error: null,
        });
      }
      return Promise.resolve({
        data: {
          jobRunId: '1',
          stats: { accounts: 2, inserted: 48, updated: 0, deleted: 0, bills: 1 },
        },
        error: null,
      });
    });
    const user = auth.user;
    if (!user) {
      throw new Error('sem sessão');
    }
    vi.spyOn(user.engine, 'syncNow').mockResolvedValue({ ok: true } as never);
    await user.db.accounts.put({
      id: 'acc-nu',
      name: 'Nubank',
      deleted_at: null,
      archived_at: null,
    } as LocalRow<'accounts'>);
    const router = mount(auth, '/ajustes/conexoes/novo');
    fireEvent.change(await screen.findByLabelText('Item ID'), {
      target: { value: '7a1c2b3d-0000-4e5f-9a8b-1c2d3e4f5a6b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    const mapping = await screen.findByTestId('connect-mapping');
    // a conta corrente vinculou sozinha à conta de mesmo nome; o cartão vem para criar e é ignorado aqui
    const bank = within(mapping).getByLabelText(/^Nubank · 1234/) as HTMLSelectElement;
    expect(bank.value).toBe('account:acc-nu');
    const card = within(mapping).getByLabelText(/^Cartão · 1234/) as HTMLSelectElement;
    expect(card.value).toBe('create');
    fireEvent.change(card, { target: { value: 'ignore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e importar' }));
    expect(
      await screen.findByText('48 lançamentos importados. 0 precisam de conferência.'),
    ).toBeDefined();
    expect(rpc).toHaveBeenCalledWith('map_external_account', {
      p_id: 'ext-bank',
      p_account_id: 'acc-nu',
      p_card_id: null,
      p_is_ignored: false,
    });
    expect(rpc).toHaveBeenCalledWith('map_external_account', {
      p_id: 'ext-card',
      p_account_id: null,
      p_card_id: null,
      p_is_ignored: true,
    });
    expect(calls.map((c) => c.name)).toEqual(['pluggy-link-item', 'pluggy-sync']);
    expect(calls[0]?.body).toEqual({ itemId: '7a1c2b3d-0000-4e5f-9a8b-1c2d3e4f5a6b' });
    expect(calls[1]?.body).toEqual({
      connectionId: 'conn-1',
      mode: 'backfill',
      days: BACKFILL_DAYS,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Conferir agora' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/conferir'));
  });

  it('RN-79: "Criar nova" cria o cartão pré-preenchido no aparelho, envia e só então mapeia', async () => {
    const auth = fakeAuth();
    const user = auth.user;
    if (!user) {
      throw new Error('sem sessão');
    }
    const order: string[] = [];
    const rpc = vi.fn((_fn: string, args: { p_card_id: string | null }) => {
      order.push(`rpc:${args.p_card_id ? 'card' : 'other'}`);
      return Promise.resolve({ data: null, error: null });
    });
    const account = external({
      id: 'ext-card',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      suggestion: { closingDay: 3, dueDay: 10, limitCents: 500_000 },
    });
    const result = await applyMapping(
      [account],
      { 'ext-card': { kind: 'create', name: 'Ultravioleta', closingDay: '3', dueDay: '10' } },
      {
        db: user.db,
        userId: user.userId,
        client: { rpc },
        today: '2026-11-11',
        institution: 'nubank',
        flush: () => {
          order.push('flush');
          return Promise.resolve(true);
        },
        notifyWrite: () => undefined,
      },
    );
    expect(result).toEqual({ ok: true });
    expect(order).toEqual(['flush', 'rpc:card']);
    const cards = await user.db.cards.toArray();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      name: 'Ultravioleta',
      closing_day: 3,
      due_day: 10,
      limit_cents: 500_000,
    });
  });

  it('RN-79: dia inválido no cartão novo não grava nada', async () => {
    const auth = fakeAuth();
    const user = auth.user;
    if (!user) {
      throw new Error('sem sessão');
    }
    const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const result = await applyMapping(
      [external({ id: 'x', type: 'CREDIT', subtype: 'CREDIT_CARD' })],
      { x: { kind: 'create', name: 'Novo', closingDay: '', dueDay: '40' } },
      {
        db: user.db,
        userId: user.userId,
        client: { rpc },
        today: '2026-11-11',
        institution: null,
        flush: () => Promise.resolve(true),
        notifyWrite: () => undefined,
      },
    );
    expect(result).toEqual({ ok: false, accountId: 'x', message: 'Escolha um dia entre 1 e 31.' });
    expect(rpc).not.toHaveBeenCalled();
    expect(await user.db.cards.count()).toBe(0);
  });
});

describe('US-47: estado da conexão e reconexão', () => {
  it('RN-81: erro temporário não avisa nas 3 novas tentativas; depois vira "Erro do banco"', () => {
    const base = { status: 'UPDATED', consent_expires_at: null };
    expect(connectionState({ ...base, last_error: 'UPSTREAM_UNAVAILABLE' }, NOW)).toBe('active');
    expect(connectionState({ ...base, last_error: 'UPSTREAM_TIMEOUT:3' }, NOW)).toBe('active');
    expect(connectionState({ ...base, last_error: 'UPSTREAM_UNAVAILABLE:4' }, NOW)).toBe('error');
    expect(connectionState({ ...base, execution_status: 'USER_AUTHORIZATION_REVOKED' }, NOW)).toBe(
      'reconnect',
    );
  });

  it('US-47: última atualização "Atualizado em dd/mm às hh:mm"', () => {
    expect(updatedText('2026-11-09T22:40:00Z', NOW)).toBe('Atualizado em 09/11 às 19:40');
  });

  it('US-47: erro de login mostra "Precisa reconectar" com o passo a passo, Renovar e o atalho de importar', async () => {
    online(true);
    const { auth } = withClient(() => Promise.resolve({ data: null, error: null }));
    await auth.user?.db.bank_connections.put(connectionRow({ status: 'LOGIN_ERROR' }));
    const router = mount(auth, '/ajustes/conexoes');
    const card = await screen.findByTestId('bank-connection-conn-1');
    expect(within(card).getAllByText(/Precisa reconectar/).length).toBeGreaterThan(0);
    expect(within(card).getByText(/abra o Meu Pluggy, autorize o Nubank de novo/)).toBeDefined();
    fireEvent.click(within(card).getByRole('button', { name: 'Importar extrato (OFX/CSV)' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/importar'));
  });

  it('US-47: consentimento vencido mostra o texto de expirada e Renovar leva à I02', async () => {
    online(true);
    const { auth } = withClient(() => Promise.resolve({ data: null, error: null }));
    await auth.user?.db.bank_connections.put(
      connectionRow({ consent_expires_at: new Date(Date.now() - 86_400_000).toISOString() }),
    );
    const router = mount(auth, '/ajustes/conexoes');
    expect(
      await screen.findByText(
        'A conexão com o Nubank expirou. Renove para continuar recebendo lançamentos.',
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes/conexoes/novo'));
  });

  it('US-47: erro do banco depois das 3 tentativas mostra "O {banco} não respondeu…"', async () => {
    online(true);
    const { auth } = withClient(() => Promise.resolve({ data: null, error: null }));
    await auth.user?.db.bank_connections.put(
      connectionRow({ institution: 'bb', last_error: 'UPSTREAM_UNAVAILABLE:4' }),
    );
    mount(auth, '/ajustes/conexoes');
    expect(
      await screen.findByText(
        'O Banco do Brasil não respondeu. Uma nova tentativa será feita amanhã cedo, ou tente agora.',
      ),
    ).toBeDefined();
  });

  it('RN-94: o Início avisa "Sua conexão com o Nubank precisa ser renovada" e Renovar abre a I01', async () => {
    const auth = fakeAuth();
    await auth.user?.db.bank_connections.put(connectionRow({ status: 'OUTDATED' }));
    const router = createMemoryRouter(
      [
        { path: '/', element: <ConnectionBanner /> },
        { path: '/ajustes/conexoes', element: <p>conexoes</p> },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Sua conexão com o Nubank precisa ser renovada')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Renovar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes/conexoes'));
  });

  it('RN-94: conexão ativa não mostra aviso no Início', async () => {
    const auth = fakeAuth();
    await auth.user?.db.bank_connections.put(connectionRow());
    const router = createMemoryRouter([{ path: '/', element: <ConnectionBanner /> }]);
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });
});
