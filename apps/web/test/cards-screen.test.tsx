import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { CardsSection, previewText } from '../src/features/accounts/CardsSection';
import { fakeAuth } from './auth-fixture';

const TODAY = '2026-11-05';

function mount() {
  const auth = fakeAuth('signedIn');
  const router = createMemoryRouter([{ path: '*', element: <CardsSection today={TODAY} /> }], {
    initialEntries: ['/ajustes/contas'],
  });
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return auth;
}

/** UXC-007: o formulário fica na folha aberta por "Adicionar cartão". */
async function openAdd() {
  fireEvent.click(await screen.findByTestId('card-add'));
  return screen.findByTestId('card-add-sheet');
}

function fill(label: string, value: string) {
  fireEvent.change(within(screen.getByTestId('card-add-sheet')).getByLabelText(label), {
    target: { value },
  });
}

function submit() {
  fireEvent.click(
    within(screen.getByTestId('card-add-sheet')).getByRole('button', { name: 'Adicionar cartão' }),
  );
}

describe('S03 cartões (US-10, relógio em 05/11/2026)', () => {
  it('US-10: criar cartão com prévia e a regra do dia do fechamento marcada, com explicação', async () => {
    const auth = mount();
    expect(await screen.findByText('Nenhum cartão cadastrado')).toBeInTheDocument();
    await openAdd();
    fill('Nome do cartão', 'Nubank');
    fill('Dia de fechamento', '3');
    fill('Dia de vencimento', '10');
    expect(screen.getByTestId('card-preview')).toHaveTextContent(
      'Compras de hoje vão para a fatura de dez/2026, que vence em 10/12/2026',
    );
    const rule = screen.getByRole('switch', {
      name: /Compra no dia do fechamento vai para a próxima fatura/,
    });
    expect(rule).toBeChecked();
    expect(
      screen.getByText(
        'Desligado, a compra feita no dia do fechamento entra na fatura que está fechando.',
      ),
    ).toBeInTheDocument();
    submit();
    expect(await screen.findByText('Nubank', { selector: '.account-name' })).toBeInTheDocument();
    expect(screen.getByText('Fecha dia 3 · vence dia 10')).toBeInTheDocument();
    expect(await auth.user?.db.cards.count()).toBe(1);
    // UXC-007: salvar fecha a folha
    await waitFor(() => expect(screen.queryByTestId('card-add-sheet')).toBeNull());
  });

  it('US-10: fechamento 0 ou 32 mostra "Escolha um dia entre 1 e 31" e não salva', async () => {
    const auth = mount();
    await openAdd();
    fill('Nome do cartão', 'Nubank');
    fill('Dia de fechamento', '0');
    fill('Dia de vencimento', '10');
    expect(screen.getAllByText('Escolha um dia entre 1 e 31.').length).toBeGreaterThan(0);
    fill('Dia de fechamento', '32');
    expect(screen.getAllByText('Escolha um dia entre 1 e 31.').length).toBeGreaterThan(0);
    submit();
    await waitFor(async () => expect(await auth.user?.db.cards.count()).toBe(0));
  });

  it('US-10: fechamento dia 31 mostra a nota dos meses curtos; fechamento = vencimento avisa sem bloquear', async () => {
    mount();
    await openAdd();
    fill('Dia de fechamento', '31');
    expect(
      screen.getByText('Em meses mais curtos, o fechamento será no último dia do mês.'),
    ).toBeInTheDocument();
    fill('Dia de fechamento', '10');
    fill('Dia de vencimento', '10');
    expect(
      screen.getByText('Fechamento e vencimento no mesmo dia. Confira na sua fatura.'),
    ).toBeInTheDocument();
  });

  it('US-10 (UXC-007): "?adicionar=cartao" (vindo da C01) abre a folha do cartão', async () => {
    const auth = fakeAuth('signedIn');
    const router = createMemoryRouter([{ path: '*', element: <CardsSection today={TODAY} /> }], {
      initialEntries: ['/ajustes/contas?adicionar=cartao'],
    });
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const sheet = await screen.findByTestId('card-add-sheet');
    expect(within(sheet).getByLabelText('Dia de fechamento')).toBeInTheDocument();
  });

  it('RN-09: desligar a regra muda a prévia da compra no dia do fechamento', () => {
    expect(previewText(5, 12, true, TODAY)).toBe(
      'Compras de hoje vão para a fatura de dez/2026, que vence em 12/12/2026',
    );
    expect(previewText(5, 12, false, TODAY)).toBe(
      'Compras de hoje vão para a fatura de nov/2026, que vence em 12/11/2026',
    );
  });
});
