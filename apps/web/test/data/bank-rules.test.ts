// T-080: parcelas, contas fixas e pagamentos vindos do banco no conciliador (US-50; RN-19, RN-69, RN-70, RN-71).
import { installmentTxId, invoiceId } from '@oakfinance/domain';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { type LocalRow, OakDb } from '../../src/data/db';
import { importedSeriesId } from '../../src/data/sync/bank-rules';
import { runReconcile } from '../../src/data/sync/reconcile-runner';
import { decideSame } from '../../src/features/inbox/model';
import { makeRow, tx } from './rows';

const CARD = 'card-nubank';
const BB = 'conta-bb';
const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`bank-rules-${opened.length}-${Math.random()}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

let version = 0;
function imported(id: string, extra: Partial<LocalRow<'transactions'>>): LocalRow<'transactions'> {
  version += 1;
  return tx(id, {
    source: 'pluggy',
    external_id: `ext-${id}`,
    review_state: 'new',
    server_version: version,
    category_id: 'cat-compras',
    ...extra,
  });
}

async function withCard(db: OakDb) {
  await db.cards.put(
    makeRow('cards', {
      id: CARD,
      name: 'Nubank',
      closing_day: 3,
      due_day: 10,
      closing_day_rule: 'next',
      deleted_at: null,
      limit_cents: null,
      payment_account_id: null,
    }),
  );
}

describe('US-50 / RN-69: parcelas vindas do banco', () => {
  it('US-50: "LOJA X 02/10" concilia com a parcela 2/10 da série lançada à mão', async () => {
    const db = open();
    await withCard(db);
    const series = 'serie-x';
    await db.installment_plans.put(
      makeRow('installment_plans', {
        id: series,
        card_id: CARD,
        account_id: null,
        installments_count: 10,
        total_cents: 100000,
        purchase_date: '2026-11-20',
        start_installment: 1,
        first_installment_cents: null,
        deleted_at: null,
      }),
    );
    await db.transactions.bulkPut(
      Array.from({ length: 10 }, (_, i) =>
        tx(installmentTxId(series, i + 1), {
          card_id: CARD,
          account_id: null,
          payment_method: 'credit',
          amount_cents: 10000,
          occurred_on: '2026-11-20',
          series_id: series,
          installment_number: i + 1,
          installment_count: 10,
          source: 'manual',
          invoice_id: invoiceId(CARD, '2026-12'),
        }),
      ),
    );
    await db.transactions.put(
      imported('T', {
        card_id: CARD,
        account_id: null,
        payment_method: 'credit',
        amount_cents: 10000,
        occurred_on: '2026-11-20',
        description: 'LOJA X 02/10',
        invoice_id: invoiceId(CARD, '2027-01'),
        invoice_pinned: true,
      }),
    );
    const summary = await runReconcile(db, { nowMs: Date.parse('2027-01-05T12:00:00Z') });
    expect(summary.installments).toBe(1);
    const t = await db.transactions.get('T');
    expect([t?.review_state, t?.duplicate_of]).toEqual(['merged', installmentTxId(series, 2)]);
    const parcel = await db.transactions.get(installmentTxId(series, 2));
    // RN-19: a fatura informada pelo banco (jan/2027) fica na parcela, fixada
    expect([parcel?.matched_external, parcel?.invoice_id, parcel?.invoice_pinned]).toEqual([
      true,
      invoiceId(CARD, '2027-01'),
      true,
    ]);
  });

  it('US-50: "LOJA Y 01/06" sem série cria as 6 parcelas de R$ 50,00 nas faturas seguintes', async () => {
    const db = open();
    await withCard(db);
    await db.transactions.put(
      imported('T', {
        card_id: CARD,
        account_id: null,
        payment_method: 'credit',
        amount_cents: 5000,
        occurred_on: '2026-11-15',
        description: 'LOJA Y 01/06',
        invoice_id: invoiceId(CARD, '2026-12'),
      }),
    );
    const summary = await runReconcile(db, { nowMs: Date.parse('2026-11-16T12:00:00Z') });
    expect(summary.installments).toBe(1);
    const series = importedSeriesId('T');
    const plan = await db.installment_plans.get(series);
    expect([
      plan?.installments_count,
      plan?.total_cents,
      plan?.start_installment,
      plan?.description,
    ]).toEqual([6, 30000, 1, 'LOJA Y']);
    const parcels = (await db.transactions.where('series_id').equals(series).toArray()).sort(
      (a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0),
    );
    expect(parcels.map((p) => [p.installment_number, p.amount_cents])).toEqual(
      Array.from({ length: 6 }, (_, i) => [i + 1, 5000]),
    );
    expect(parcels.map((p) => p.invoice_id)).toEqual(
      ['2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05'].map((m) =>
        invoiceId(CARD, m as never),
      ),
    );
    expect((await db.invoices.toArray()).length).toBe(6);
    const t = await db.transactions.get('T');
    expect([t?.review_state, t?.duplicate_of]).toEqual(['merged', installmentTxId(series, 1)]);
    // não duplica numa segunda rodada (outro aparelho chegaria às mesmas linhas)
    await runReconcile(db, { nowMs: Date.parse('2026-11-16T12:00:00Z') });
    expect(await db.transactions.where('series_id').equals(series).count()).toBe(6);
  });

  it('US-50: "LOJA Z 04/10" sem série cria só as parcelas 4/10 a 10/10, "importada parcialmente"', async () => {
    const db = open();
    await withCard(db);
    await db.transactions.put(
      imported('T', {
        card_id: CARD,
        account_id: null,
        payment_method: 'credit',
        amount_cents: 8000,
        occurred_on: '2026-11-15',
        description: 'LOJA Z 04/10',
        invoice_id: invoiceId(CARD, '2026-12'),
      }),
    );
    await runReconcile(db, { nowMs: Date.parse('2026-11-16T12:00:00Z') });
    const series = importedSeriesId('T');
    const plan = await db.installment_plans.get(series);
    expect([plan?.start_installment, plan?.installments_count, plan?.total_cents]).toEqual([
      4, 10, 80000,
    ]);
    const numbers = (await db.transactions.where('series_id').equals(series).toArray())
      .map((p) => p.installment_number)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(numbers).toEqual([4, 5, 6, 7, 8, 9, 10]);
    // a parcela 4 cai na fatura da transação
    expect((await db.transactions.get(installmentTxId(series, 4)))?.invoice_id).toBe(
      invoiceId(CARD, '2026-12'),
    );
  });
});

describe('US-50 / RN-70: conta fixa com valor variável', () => {
  it('US-50: "COPEL DIST 112233" de R$ 203,45 efetiva a ocorrência "Luz ≈ R$ 180,00" e concilia', async () => {
    const db = open();
    await db.recurrences.put(
      makeRow('recurrences', {
        id: 'luz',
        is_variable_amount: true,
        match_pattern: 'COPEL',
        deleted_at: null,
      }),
    );
    await db.transactions.bulkPut([
      tx('ocorrencia', {
        account_id: BB,
        payment_method: 'boleto',
        amount_cents: 18000,
        occurred_on: '2026-11-20',
        source: 'recurrence',
        recurrence_id: 'luz',
        recurrence_date: '2026-11-20',
        description: 'Luz',
        status: 'pending',
      }),
      imported('T', {
        account_id: BB,
        payment_method: 'boleto',
        amount_cents: 20345,
        occurred_on: '2026-11-22',
        description: 'COPEL DIST 112233',
      }),
    ]);
    await runReconcile(db, { nowMs: Date.parse('2026-11-22T15:00:00Z') });
    const o = await db.transactions.get('ocorrencia');
    expect([o?.amount_cents, o?.status, o?.matched_external, o?.description]).toEqual([
      20345,
      'posted',
      true,
      'Luz',
    ]);
    expect((await db.transactions.get('T'))?.duplicate_of).toBe('ocorrencia');
  });

  it('RN-70: a 1ª conciliação manual grava o termo de conciliação da conta fixa variável', async () => {
    const db = open();
    await db.recurrences.put(
      makeRow('recurrences', {
        id: 'agua',
        is_variable_amount: true,
        match_pattern: null,
        deleted_at: null,
      }),
    );
    const occurrence = tx('o', {
      account_id: BB,
      amount_cents: 9000,
      occurred_on: '2026-11-10',
      source: 'recurrence',
      recurrence_id: 'agua',
    });
    const bank = imported('T', {
      account_id: BB,
      amount_cents: 9500,
      occurred_on: '2026-11-11',
      description: 'SANEPAR AGUA 123',
      review_state: 'suggested',
    });
    await db.transactions.bulkPut([occurrence, bank]);
    await decideSame(db, bank, occurrence);
    expect((await db.recurrences.get('agua'))?.match_pattern).toBe('SANEPAR AGUA');
    expect((await db.transactions.get('o'))?.amount_cents).toBe(9500);
  });
});

describe('US-50 / RN-71: pagamento de fatura', () => {
  it('US-50: saída "PAGTO FATURA NUBANK" de R$ 980,00 paga a fatura dez/2026; "Pagamento recebido" é ignorado', async () => {
    const db = open();
    await withCard(db);
    const dec = invoiceId(CARD, '2026-12');
    await db.invoices.put(
      makeRow('invoices', {
        id: dec,
        card_id: CARD,
        reference_month: '2026-12-01',
        closing_date: '2026-12-03',
        due_date: '2026-12-10',
        is_manual_dates: false,
        deleted_at: null,
      }),
    );
    await db.transactions.bulkPut([
      tx('compra', {
        card_id: CARD,
        account_id: null,
        payment_method: 'credit',
        amount_cents: 98000,
        occurred_on: '2026-11-20',
        invoice_id: dec,
      }),
      imported('pagto', {
        account_id: BB,
        amount_cents: 98000,
        occurred_on: '2026-12-09',
        description: 'PAGTO FATURA NUBANK',
        payment_method: 'pix',
      }),
      imported('recebido', {
        card_id: CARD,
        account_id: null,
        payment_method: 'credit',
        kind: 'refund',
        amount_cents: 98000,
        occurred_on: '2026-12-09',
        description: 'Pagamento recebido',
        invoice_id: invoiceId(CARD, '2027-01'),
      }),
    ]);
    const summary = await runReconcile(db, { nowMs: Date.parse('2026-12-09T15:00:00Z') });
    expect(summary).toMatchObject({ payments: 1, ignored: 1 });
    const pagto = await db.transactions.get('pagto');
    expect([
      pagto?.kind,
      pagto?.counterpart_card_id,
      pagto?.invoice_id,
      pagto?.category_id,
      pagto?.review_state,
    ]).toEqual(['transfer', CARD, dec, null, 'ok']);
    expect((await db.transactions.get('recebido'))?.review_state).toBe('ignored');
  });
});
