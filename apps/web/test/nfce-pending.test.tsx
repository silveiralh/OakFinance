// T-089: nota lida sem rede (US-55) é relida quando a rede volta; na T02, selo "Aguardando nota" e "Tentar ler a
// nota de novo" por 7 dias (RN-84).
import { accessKeyCheckDigit, type ISODate, todayIn } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { OakDb } from '../src/data/db';
import { processNfce } from '../src/features/nfce/flow';
import { NfceRetryKeeper, NfceTxStatus } from '../src/features/nfce/NfcePending';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

function key(): string {
  const first = `412611${'12345678000100'}65001000000123100000001`;
  return `${first}${accessKeyCheckDigit(first)}`;
}
const LINK = `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${key()}|2|1|1|ABCDEF0123456789`;
const TODAY = todayIn('America/Sao_Paulo', new Date()) as ISODate;

const FULL = {
  status: 'full',
  qr: {},
  receipt: {
    issuerName: 'SUPERMERCADO EXEMPLO',
    issuerCnpj: '12345678000100',
    issuedAt: `${TODAY}T10:00:00`,
    items: [
      {
        description: 'ARROZ',
        code: null,
        quantityMilli: 1000,
        unit: 'UN',
        unitCents: 2590,
        totalCents: 2590,
      },
    ],
    discountCents: 0,
    totalCents: 2590,
  },
};

function online(response: unknown): AuthValue {
  const client = {
    functions: { invoke: () => Promise.resolve({ data: response, error: null }) },
  };
  return { ...fakeAuth(), client: client as unknown as AuthValue['client'] };
}

async function pendingTx(db: OakDb, userId: string, status: 'pending' | 'fallback' = 'pending') {
  const outcome = await processNfce(LINK, {
    db,
    userId,
    today: TODAY,
    read: () =>
      Promise.resolve(
        status === 'pending' ? { status } : { status, errorCode: 'NFCE_LAYOUT' as const },
      ),
  });
  if (outcome.kind !== 'prefill') {
    throw new Error('esperava prefill');
  }
  const row = tx('nota', {
    amount_cents: 2590,
    occurred_on: TODAY,
    description: outcome.draft.description,
    nfce_receipt_id: outcome.receipt.id,
    source: 'nfce',
    deleted_at: null,
  });
  await db.transactions.put(row);
  return { row, receiptId: outcome.receipt.id };
}

describe('US-55: nota pendente', () => {
  it('US-55: ao abrir com rede, a nota pendente é lida e o lançamento recebe a loja', async () => {
    const auth = online(FULL);
    const db = auth.user?.db as OakDb;
    const { receiptId } = await pendingTx(db, auth.user?.userId ?? '');
    render(
      <AuthContext.Provider value={auth}>
        <NfceRetryKeeper />
      </AuthContext.Provider>,
    );
    await waitFor(async () =>
      expect((await db.nfce_receipts.get(receiptId))?.parse_status).toBe('full'),
    );
    expect((await db.transactions.get('nota'))?.description).toBe('SUPERMERCADO EXEMPLO');
  });

  it('US-55/RN-84: T02 mostra "Aguardando nota" e relê pelo botão', async () => {
    const auth = online(FULL);
    const db = auth.user?.db as OakDb;
    const { row, receiptId } = await pendingTx(db, auth.user?.userId ?? '');
    render(
      <AuthContext.Provider value={auth}>
        <NfceTxStatus tx={row} />
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Aguardando nota')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar ler a nota de novo' }));
    await waitFor(async () =>
      expect((await db.nfce_receipts.get(receiptId))?.parse_status).toBe('full'),
    );
    await waitFor(() => expect(screen.queryByTestId('nfce-status')).toBeNull());
  });

  it('RN-84: nota parcial (fallback) mostra só o "Tentar ler a nota de novo"', async () => {
    const auth = online(FULL);
    const db = auth.user?.db as OakDb;
    const { row } = await pendingTx(db, auth.user?.userId ?? '', 'fallback');
    render(
      <AuthContext.Provider value={auth}>
        <NfceTxStatus tx={row} />
      </AuthContext.Provider>,
    );
    expect(await screen.findByRole('button', { name: 'Tentar ler a nota de novo' })).toBeDefined();
    expect(screen.queryByText('Aguardando nota')).toBeNull();
  });
});

describe('US-55: sem o cliente', () => {
  it('US-55: enquanto o cliente do Supabase não carregou, a nota pendente não vira parcial', async () => {
    const auth = fakeAuth();
    const db = auth.user?.db as OakDb;
    const { row, receiptId } = await pendingTx(db, auth.user?.userId ?? '');
    render(
      <AuthContext.Provider value={auth}>
        <NfceRetryKeeper />
        <NfceTxStatus tx={row} />
      </AuthContext.Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar ler a nota de novo' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await db.nfce_receipts.get(receiptId))?.parse_status).toBe('pending');
    expect(screen.getByText('Aguardando nota')).toBeDefined();
  });
});
