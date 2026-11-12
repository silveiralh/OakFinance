import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { deleteAccount } from '../src/data/repositories/accounts';
import { AccountsScreen, methodsLabel } from '../src/features/accounts/AccountsScreen';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

function mount() {
  const auth = fakeAuth('signedIn');
  const router = createMemoryRouter([{ path: '*', element: <AccountsScreen /> }], {
    initialEntries: ['/ajustes/contas'],
  });
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return auth;
}

/** UXC-007: "Adicionar conta" abre a folha com o formulário. */
async function openAdd() {
  fireEvent.click(await screen.findByTestId('account-add'));
  return screen.findByTestId('account-add-sheet');
}

async function add(name: string, typeLabel?: string) {
  const sheet = await openAdd();
  fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: name } });
  if (typeLabel) {
    fireEvent.change(within(sheet).getByLabelText('Tipo'), { target: { value: typeLabel } });
  }
  fireEvent.click(within(sheet).getByRole('button', { name: 'Adicionar conta' }));
}

describe('S03 contas (US-09)', () => {
  it('US-09: cria "BB" corrente e mostra as formas; nome repetido mostra o aviso', async () => {
    mount();
    expect(await screen.findByText('Nenhuma conta cadastrada')).toBeInTheDocument();
    await add('BB');
    expect(await screen.findByText('BB', { selector: '.account-name' })).toBeInTheDocument();
    expect(screen.getByText('Meios: Pix, Débito, Boleto, TED/DOC, Outro')).toBeInTheDocument();
    await add('bb');
    expect(await screen.findByText('Você já tem uma conta com esse nome')).toBeInTheDocument();
  });

  it('US-09: VR aparece como meio imediato sem formas', async () => {
    mount();
    await add('VR', 'meal_voucher');
    expect(await screen.findByText('Meio imediato, sem formas')).toBeInTheDocument();
    expect(methodsLabel('cash')).toBe('Meios: Dinheiro');
  });

  it('RN-07: com lançamentos, excluir orienta a arquivar; arquivar e desarquivar', async () => {
    const auth = mount();
    await add('Nubank');
    const row = (await screen.findByText('Nubank', { selector: '.account-name' })).closest(
      'li',
    ) as HTMLElement;
    const id = row.dataset.testid?.replace('account-', '') ?? '';
    expect(within(row).getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    await auth.user?.db.transactions.put(tx('t1', { account_id: id }));
    // US-11: com uso, só "Arquivar"; o repositório também recusa a exclusão
    await waitFor(() => expect(within(row).queryByRole('button', { name: 'Excluir' })).toBeNull());
    const refused = await deleteAccount(auth.user?.db as never, id);
    expect(refused.ok ? null : refused.error.code).toBe('ACCOUNT_HAS_TRANSACTIONS');
    fireEvent.click(within(row).getByRole('button', { name: 'Arquivar' }));
    expect(await screen.findByText('Contas arquivadas')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Desarquivar' }));
    await waitFor(() => expect(screen.queryByText('Contas arquivadas')).not.toBeInTheDocument());
  });

  it('nome vazio pede o nome', async () => {
    mount();
    await screen.findByText('Nenhuma conta cadastrada');
    const sheet = await openAdd();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Adicionar conta' }));
    expect(await within(sheet).findByText('Informe o nome da conta.')).toBeInTheDocument();
  });
});

describe('T-125: S03 (UXC-015, UXC-017)', () => {
  it('US-09 (UXC-015/UXC-017): listas com título, vazio de contas com texto próprio e sem aviso de dia antes de digitar', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Contas', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cartões', level: 2 })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Cadastre a conta corrente, a carteira ou o VR para lançar despesas e receitas.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Onde está o seu dinheiro?')).toBeNull();
    // com os dias vazios, "Adicionar cartão" fica desativado sem a mensagem de erro
    expect(screen.queryByText('Escolha um dia entre 1 e 31.')).toBeNull();
  });
});

describe('T-125: formulários em folhas (UXC-007)', () => {
  it('US-09 (UXC-007): a S03 abre sem formulário nem teclado; "Adicionar conta" abre a folha, que fecha ao salvar', async () => {
    mount();
    await screen.findByText('Nenhuma conta cadastrada');
    expect(screen.queryByLabelText('Saldo atual')).toBeNull();
    expect(screen.queryByTestId('card-form')).toBeNull();
    expect(document.querySelector('fieldset.keypad')).toBeNull();
    const sheet = await openAdd();
    expect(within(sheet).getByLabelText('Saldo atual')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: 'BB' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Adicionar conta' }));
    expect(await screen.findByText('BB', { selector: '.account-name' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('account-add-sheet')).toBeNull());
  });

  it('US-12 (UXC-007): "?adicionar=conta" (vindo do Q01) abre a folha de conta', async () => {
    const auth = fakeAuth('signedIn');
    const router = createMemoryRouter([{ path: '*', element: <AccountsScreen /> }], {
      initialEntries: ['/ajustes/contas?adicionar=conta'],
    });
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const sheet = await screen.findByTestId('account-add-sheet');
    expect(within(sheet).getByLabelText('Nome')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });
});

describe('T-125: editar conta (UXC-010)', () => {
  it('US-09 (UXC-010, RN-07): "Editar" muda nome e banco da conta; nome repetido mostra o aviso', async () => {
    mount();
    await add('BB');
    await add('Nubank');
    const bb = (await screen.findByText('BB', { selector: '.account-name' })).closest('li');
    if (!bb) {
      throw new Error('sem linha');
    }
    fireEvent.click(within(bb).getByRole('button', { name: 'Editar' }));
    const sheet = await screen.findByTestId('account-edit-sheet');
    fireEvent.change(within(sheet).getByLabelText('Nome'), { target: { value: 'nubank' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar alterações' }));
    expect(
      await within(sheet).findByText('Você já tem uma conta com esse nome'),
    ).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('Nome'), {
      target: { value: 'Banco do Brasil' },
    });
    fireEvent.change(within(sheet).getByLabelText('Banco'), { target: { value: 'BB S.A.' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar alterações' }));
    expect(
      await screen.findByText('Banco do Brasil', { selector: '.account-name' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('account-edit-sheet')).toBeNull());
  });
});
