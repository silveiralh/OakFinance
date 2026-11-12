// T-089 (parte 1): I04 pelo caminho da câmera negada — colar o link ou digitar a chave (US-54, US-55; RN-85).
import { accessKeyCheckDigit } from '@oakfinance/domain';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { NfceScreen } from '../src/features/nfce/screens';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

function key(): string {
  const first = `412611${'12345678000100'}65001000000123100000001`;
  return `${first}${accessKeyCheckDigit(first)}`;
}

function renderScreen(auth: AuthValue) {
  const router = createMemoryRouter([{ path: '/', element: <NfceScreen /> }], {
    initialEntries: ['/'],
  });
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

function type(text: string) {
  if (!screen.queryByLabelText('Digitar chave')) {
    fireEvent.click(screen.getByRole('button', { name: 'Digitar chave' }));
  }
  const input = screen.getByLabelText('Digitar chave');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

describe('I04 — digitar a chave (US-54)', () => {
  it('US-54: chave inválida mostra o aviso de QR que não é de NFC-e', async () => {
    renderScreen(fakeAuth());
    type('1234');
    expect(
      await screen.findByText(
        'Este QR code não é de uma nota fiscal (NFC-e). Digite a chave de acesso ou tente outra nota.',
      ),
    ).toBeDefined();
  });

  it('US-55: sem o serviço, a chave válida cai no fallback com o aviso da SEFAZ', async () => {
    const auth = { ...fakeAuth(), client: null };
    renderScreen(auth);
    type(key());
    expect(
      await screen.findByText(
        'Não foi possível carregar os detalhes da nota. Complete o valor para continuar.',
      ),
    ).toBeDefined();
    expect(await auth.user?.db.nfce_receipts.count()).toBe(1);
  });
});

const FULL_RESPONSE = {
  status: 'full',
  qr: {},
  receipt: {
    issuerName: 'SUPERMERCADO EXEMPLO',
    issuerCnpj: '12345678000100',
    issuedAt: '2026-11-06T18:42:07',
    items: [
      {
        description: 'ARROZ',
        code: null,
        quantityMilli: 1000,
        unit: 'UN',
        unitCents: 18745,
        totalCents: 18745,
      },
    ],
    discountCents: 0,
    totalCents: 18745,
  },
};

function withClient(response: unknown): AuthValue {
  const client = {
    functions: { invoke: () => Promise.resolve({ data: response, error: null }) },
  };
  return { ...fakeAuth(), client: client as unknown as AuthValue['client'] };
}

describe('I04 — câmera e foto (US-54, UX §5.31)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('US-54: explicação antes da permissão; Escolher foto e Digitar chave sempre visíveis', () => {
    renderScreen(fakeAuth());
    expect(
      screen.getByText('A câmera é usada só para ler o QR code da nota. Nenhuma foto é guardada.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Abrir câmera' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Escolher foto' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Digitar chave' })).toBeDefined();
  });

  it('US-54: câmera negada mostra o aviso com Escolher foto', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      onLine: true,
      mediaDevices: {
        getUserMedia: () => Promise.reject(new DOMException('negado', 'NotAllowedError')),
      },
    });
    renderScreen(fakeAuth());
    fireEvent.click(screen.getByRole('button', { name: 'Abrir câmera' }));
    expect(
      await screen.findByText(
        'Sem acesso à câmera. Escolha uma foto da nota ou digite a chave de acesso.',
      ),
    ).toBeDefined();
  });

  it('US-54: foto sem QR mostra o aviso de nota não reconhecida', async () => {
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        detect() {
          return Promise.resolve([]);
        }
      },
    );
    renderScreen(fakeAuth());
    fireEvent.change(screen.getByTestId('nfce-photo'), {
      target: { files: [new File(['x'], 'nota.png', { type: 'image/png' })] },
    });
    expect(
      await screen.findByText(
        'Este QR code não é de uma nota fiscal (NFC-e). Digite a chave de acesso ou tente outra nota.',
      ),
    ).toBeDefined();
  });

  it('US-54: foto com QR lida completa mostra loja, valor e itens; Usar estes dados abre o Q01 pré-preenchido', async () => {
    const link = `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${key()}|2|1|1|ABCDEF0123456789`;
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        detect() {
          return Promise.resolve([{ rawValue: link }]);
        }
      },
    );
    renderScreen(withClient(FULL_RESPONSE));
    fireEvent.change(screen.getByTestId('nfce-photo'), {
      target: { files: [new File(['x'], 'nota.png', { type: 'image/png' })] },
    });
    expect(
      await screen.findByText('Nota encontrada: SUPERMERCADO EXEMPLO, R$ 187,45'),
    ).toBeDefined();
    expect(await screen.findByText('Itens da nota (1)')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Usar estes dados' }));
    expect(await screen.findByText('Dados da nota fiscal')).toBeDefined();
    expect(screen.getByDisplayValue('SUPERMERCADO EXEMPLO')).toBeDefined();
  });
});

describe('T-126: nota sem internet (D-096)', () => {
  it('US-55 (D-096): sem internet, a I04 avisa antes da câmera que a nota fica guardada', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    renderScreen(fakeAuth());
    expect(screen.getByTestId('nfce-offline-before').textContent).toContain(
      'Sem internet. A nota fica guardada e os itens entram no lançamento quando a conexão voltar.',
    );
    expect(screen.getByRole('button', { name: 'Abrir câmera' })).toBeDefined();
  });

  it('US-54 (D-096): com internet, sem o aviso', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    renderScreen(fakeAuth());
    expect(screen.queryByTestId('nfce-offline-before')).toBeNull();
  });
});
