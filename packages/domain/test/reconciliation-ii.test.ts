import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import { installmentTxId } from '../src/ids.ts';
import { buildInstallments } from '../src/installments.ts';
import {
  countsForTotals,
  invoiceForPurchase,
  invoicePeriod,
  invoiceStatus,
  invoiceTotals,
} from '../src/invoices.ts';
import {
  DEFAULT_RECON_OPTIONS,
  detectIgnoredCardCredits,
  detectInternalTransfers,
  detectInvoicePayments,
  type ImportedSeriesCandidate,
  importedInstallmentPlan,
  installmentMarkerOf,
  invoiceForImported,
  invoicePaymentPatch,
  linkImportedInstallment,
  matchPatternFor,
  type PayableInvoice,
  planMerge,
  type ReconItem,
  reconcile,
} from '../src/reconciliation.ts';
import type { Card, Tx } from '../src/types.ts';

let seq = 0;

function item(over: Partial<ReconItem>): ReconItem {
  seq += 1;
  return {
    id: `r-${seq}`,
    kind: 'expense',
    amountCents: 1000,
    occurredOn: '2026-11-05',
    accountId: null,
    cardId: null,
    description: null,
    source: 'pluggy',
    externalId: null,
    installmentNumber: null,
    installmentCount: null,
    matchedExternal: false,
    reviewState: 'new',
    ...over,
  };
}

function tx(over: Partial<Tx>): Tx {
  seq += 1;
  return {
    id: `t-${seq}`,
    kind: 'expense',
    status: 'posted',
    countBeforeReceived: false,
    invoicePinned: false,
    amountCents: 1000,
    occurredOn: '2026-11-05',
    description: null,
    categoryId: null,
    paymentMethod: 'debit',
    accountId: null,
    cardId: null,
    invoiceId: null,
    counterpartAccountId: null,
    counterpartCardId: null,
    seriesId: null,
    installmentNumber: null,
    installmentCount: null,
    recurrenceId: null,
    recurrenceDate: null,
    goalId: null,
    incomeExpected: false,
    source: 'pluggy',
    externalId: null,
    reviewState: 'new',
    duplicateOf: null,
    merchantCnpj: null,
    deletedAt: null,
    ...over,
  };
}

// Cartão fictício: fecha dia 2, vence dia 9 → fatura dez/2026 = compras de 02/11 a 01/12, vence 09/12.
const NU: Card = {
  id: 'card-nu',
  closingDay: 2,
  dueDay: 9,
  closingDayRule: 'next',
  limitCents: null,
  paymentAccountId: 'acc-bb',
};

function series(over: Partial<ImportedSeriesCandidate>): ImportedSeriesCandidate {
  return {
    id: 'serie-x',
    cardId: NU.id,
    count: 10,
    totalCents: 100_000,
    purchaseDate: '2026-11-20',
    ...over,
  };
}

describe('RN-69: marcador de parcela k/n', () => {
  it.each([
    ['LOJA X 02/10', { number: 2, count: 10 }],
    ['LOJA Y 1 / 6', { number: 1, count: 6 }],
    ['PARC 48/48 LOJA', { number: 48, count: 48 }],
    ['05/11 LOJA X 02/10', { number: 2, count: 10 }],
    ['LOJA 11/10', null],
    ['LOJA 0/10', null],
    ['LOJA 2/49', null],
    ['LOJA 1/1', null],
    ['LOJA 102/10', null],
    ['SEM PARCELA', null],
  ] as const)('RN-69: "%s" → %o', (description, expected) => {
    expect(
      installmentMarkerOf({ description, installmentNumber: null, installmentCount: null }),
    ).toEqual(expected);
  });

  it('RN-69: o metadado do agregador vence o padrão da descrição', () => {
    expect(
      installmentMarkerOf({
        description: 'LOJA 02/10',
        installmentNumber: 3,
        installmentCount: 12,
      }),
    ).toEqual({ number: 3, count: 12 });
    expect(
      installmentMarkerOf({ description: null, installmentNumber: 3, installmentCount: 60 }),
    ).toBeNull();
  });
});

describe('linkImportedInstallment (US-50, RN-69)', () => {
  it('US-50: parcela de série existente — "LOJA X 02/10" de R$ 100,00 na fatura de jan/2027 concilia com a 2/10', () => {
    const plan = series({ firstInvoiceMonth: '2026-12' });
    const bank = item({
      cardId: NU.id,
      amountCents: 10_000,
      occurredOn: '2026-12-20',
      description: 'LOJA X 02/10',
      invoiceMonth: '2027-01',
    });
    const link = linkImportedInstallment(bank, [plan]);
    expect(link).toEqual({ seriesId: 'serie-x' });
    const drafts = buildInstallments(
      {
        seriesId: plan.id,
        cardId: NU.id,
        accountId: null,
        purchaseDate: plan.purchaseDate,
        totalCents: plan.totalCents,
        count: plan.count,
        description: 'LOJA X',
        categoryId: null,
      },
      NU,
    );
    const second = drafts.find((d) => d.installmentNumber === 2);
    expect(second?.id).toBe(installmentTxId('serie-x', 2));
    expect(second?.invoiceReferenceMonth).toBe('2027-01');
  });

  it('RN-69: aceita fatura ±1 e recusa a 2 meses de distância', () => {
    const plan = series({ firstInvoiceMonth: '2026-12' });
    const at = (invoiceMonth: string) =>
      linkImportedInstallment(
        item({
          cardId: NU.id,
          amountCents: 10_000,
          occurredOn: '2026-12-20',
          description: 'LOJA X 02/10',
          invoiceMonth,
        }),
        [plan],
      );
    expect(at('2026-12')).not.toBeNull();
    expect(at('2027-02')).not.toBeNull();
    expect(at('2027-03')).toBeNull();
    expect(at('2026-11')).toBeNull();
  });

  it('RN-69: valor com tolerância de R$ 0,01; outro cartão, outro n ou outro valor não casam', () => {
    const plan = series({ firstInvoiceMonth: '2026-12' });
    const base = {
      cardId: NU.id,
      occurredOn: '2026-12-20',
      description: 'LOJA X 02/10',
      invoiceMonth: '2027-01',
    };
    expect(linkImportedInstallment(item({ ...base, amountCents: 10_001 }), [plan])).not.toBeNull();
    expect(linkImportedInstallment(item({ ...base, amountCents: 9_999 }), [plan])).not.toBeNull();
    expect(linkImportedInstallment(item({ ...base, amountCents: 10_002 }), [plan])).toBeNull();
    expect(
      linkImportedInstallment(item({ ...base, amountCents: 10_000, cardId: 'outro' }), [plan]),
    ).toBeNull();
    expect(
      linkImportedInstallment(item({ ...base, amountCents: 10_000, description: 'LOJA X 02/12' }), [
        plan,
      ]),
    ).toBeNull();
    expect(
      linkImportedInstallment(item({ ...base, amountCents: 10_000, description: 'LOJA X' }), [
        plan,
      ]),
    ).toBeNull();
  });

  it('RN-69/RN-21: a 1ª parcela leva o resto; a 1ª informada pelo banco é respeitada', () => {
    const plan = series({ totalCents: 100_005, count: 10, firstInvoiceMonth: '2026-12' });
    const base = { cardId: NU.id, occurredOn: '2026-11-20', invoiceMonth: '2026-12' };
    expect(
      linkImportedInstallment(item({ ...base, amountCents: 10_005, description: 'LOJA 01/10' }), [
        plan,
      ]),
    ).not.toBeNull();
    expect(
      linkImportedInstallment(item({ ...base, amountCents: 10_000, description: 'LOJA 01/10' }), [
        plan,
      ]),
    ).toBeNull();
    const informed = series({
      id: 'serie-y',
      totalCents: 100_000,
      count: 4,
      firstInstallmentCents: 25_003,
      firstInvoiceMonth: '2026-12',
    });
    // resto 74.997 em 3: 24.999 cada, com o resto (0) na 2ª
    expect(
      linkImportedInstallment(
        item({
          ...base,
          amountCents: 24_999,
          description: 'LOJA 02/04',
          invoiceMonth: '2027-01',
        }),
        [informed],
      ),
    ).toEqual({ seriesId: 'serie-y' });
    expect(
      linkImportedInstallment(item({ ...base, amountCents: 25_003, description: 'LOJA 01/04' }), [
        informed,
      ]),
    ).toEqual({ seriesId: 'serie-y' });
  });

  it('RN-69: sem mês de fatura, aceita a data da compra repetida pelo banco ou o mês da parcela', () => {
    const plan = series({});
    const at = (occurredOn: string) =>
      linkImportedInstallment(
        item({ cardId: NU.id, amountCents: 10_000, occurredOn, description: 'LOJA X 05/10' }),
        [plan],
      );
    expect(at('2026-11-21')).not.toBeNull(); // data original da compra
    expect(at('2027-03-20')).not.toBeNull(); // mês da parcela 5
    expect(at('2027-07-20')).toBeNull();
    expect(at('2026-12-20')).toBeNull();
  });

  it('RN-69: entre várias séries, a de fatura mais próxima, depois a compra mais recente', () => {
    const a = series({ id: 'a', purchaseDate: '2026-10-20', firstInvoiceMonth: '2026-11' });
    const b = series({ id: 'b', purchaseDate: '2026-11-20', firstInvoiceMonth: '2026-12' });
    const bank = item({
      cardId: NU.id,
      amountCents: 10_000,
      description: 'LOJA 02/10',
      occurredOn: '2026-12-20',
      invoiceMonth: '2027-01',
    });
    expect(linkImportedInstallment(bank, [a, b])).toEqual({ seriesId: 'b' });
    const c = series({ id: 'c', purchaseDate: '2026-11-18', firstInvoiceMonth: '2026-12' });
    expect(linkImportedInstallment(bank, [c, b])).toEqual({ seriesId: 'b' });
    const d = series({ id: 'd', purchaseDate: '2026-11-20', firstInvoiceMonth: '2026-12' });
    expect(linkImportedInstallment(bank, [d, b])).toEqual({ seriesId: 'b' });
  });

  it('RN-69: série com total inválido e transação fora de cartão não casam', () => {
    const bank = item({
      cardId: NU.id,
      amountCents: 1,
      description: 'LOJA 02/10',
      occurredOn: '2026-12-20',
    });
    expect(linkImportedInstallment(bank, [series({ totalCents: 5 })])).toBeNull();
    expect(
      linkImportedInstallment(bank, [series({ totalCents: 20, firstInstallmentCents: 15 })]),
    ).toBeNull();
    expect(
      linkImportedInstallment(item({ accountId: 'acc-bb', description: 'CARNE 02/10' }), [
        series({}),
      ]),
    ).toBeNull();
  });
});

describe('importedInstallmentPlan (US-50, RN-69)', () => {
  it('US-50: compra parcelada nova — "LOJA Y 01/06" de R$ 50,00 cria 6 parcelas nas faturas seguintes', () => {
    const bank = item({
      cardId: NU.id,
      amountCents: 5_000,
      occurredOn: '2026-11-20',
      description: 'LOJA Y 01/06',
    });
    const plan = importedInstallmentPlan(bank, 'serie-y', { categoryId: 'cat-casa' });
    expect(plan).toMatchObject({
      seriesId: 'serie-y',
      cardId: NU.id,
      accountId: null,
      purchaseDate: '2026-11-20',
      totalCents: 30_000,
      count: 6,
      startInstallment: 1,
      description: 'LOJA Y',
      categoryId: 'cat-casa',
      partiallyImported: false,
    });
    if (!plan) {
      throw new Error('plano esperado');
    }
    const drafts = buildInstallments(plan, NU);
    expect(drafts.map((d) => d.amountCents)).toEqual([5_000, 5_000, 5_000, 5_000, 5_000, 5_000]);
    expect(drafts.map((d) => d.invoiceReferenceMonth)).toEqual([
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
    ]);
  });

  it('US-50: parcela de compra anterior ao app — "LOJA Z 04/10" cria 4/10 a 10/10 "importada parcialmente"', () => {
    const bank = item({
      cardId: NU.id,
      amountCents: 8_000,
      occurredOn: '2026-11-20',
      description: 'LOJA Z 04/10',
    });
    const plan = importedInstallmentPlan(bank, 'serie-z');
    expect(plan?.partiallyImported).toBe(true);
    expect(plan?.startInstallment).toBe(4);
    expect(plan?.purchaseDate).toBe('2026-08-20');
    if (!plan) {
      throw new Error('plano esperado');
    }
    const drafts = buildInstallments(plan, NU);
    expect(drafts.map((d) => d.installmentNumber)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(drafts.every((d) => d.amountCents === 8_000)).toBe(true);
    // a parcela 4 fica na fatura da própria transação
    expect(drafts[0]?.invoiceId).toBe(invoiceForPurchase(NU, bank.occurredOn).id);
  });

  it('RN-69/RN-21: total informado pelo agregador ajusta pela RN-21; total inválido cai em valor × n', () => {
    const bank = item({
      cardId: NU.id,
      amountCents: 3_334,
      occurredOn: '2026-11-20',
      description: 'LOJA 1/3',
    });
    expect(importedInstallmentPlan(bank, 's', { totalCents: 10_000 })?.totalCents).toBe(10_000);
    expect(importedInstallmentPlan(bank, 's', { totalCents: 2 })?.totalCents).toBe(10_002);
    expect(importedInstallmentPlan(bank, 's', { totalCents: null })?.totalCents).toBe(10_002);
  });

  it('RN-69: carnê na conta usa o vencimento; sem parcela ou sem conta/cartão não há plano', () => {
    const carne = item({
      accountId: 'acc-bb',
      amountCents: 12_000,
      occurredOn: '2026-11-10',
      description: '03/12',
      installmentNumber: null,
    });
    const plan = importedInstallmentPlan(carne, 's', { purchaseDate: '2026-09-01' });
    expect(plan).toMatchObject({
      cardId: null,
      accountId: 'acc-bb',
      firstDueOn: '2026-09-10',
      purchaseDate: '2026-09-01',
      description: '03/12',
      partiallyImported: true,
    });
    expect(importedInstallmentPlan(item({ cardId: NU.id, description: 'LOJA' }), 's')).toBeNull();
    expect(importedInstallmentPlan(item({ description: 'LOJA 1/2' }), 's')).toBeNull();
    expect(
      importedInstallmentPlan(
        item({ cardId: NU.id, description: null, installmentNumber: 2, installmentCount: 3 }),
        's',
      )?.description,
    ).toBe('');
  });

  it('RN-69: data no dia 31 recua para o último dia do mês', () => {
    const plan = importedInstallmentPlan(
      item({ cardId: NU.id, occurredOn: '2026-12-31', description: 'LOJA 2/5' }),
      's',
    );
    expect(plan?.purchaseDate).toBe('2026-11-30');
  });
});

describe('RN-19: fatura informada pelo banco', () => {
  it('US-50: compra que pela RN-12 cairia em dez/2026, com o banco informando jan/2027, fica em jan/2027 fixada', () => {
    expect(invoiceForPurchase(NU, '2026-11-25').referenceMonth).toBe('2026-12');
    const { invoice, invoicePinned } = invoiceForImported(NU, '2026-11-25', '2027-01');
    expect(invoice.referenceMonth).toBe('2027-01');
    expect(invoice.id).toBe(invoicePeriod(NU, '2027-01').id);
    expect(invoicePinned).toBe(true);
  });

  it('RN-19: sem referência do banco vale a RN-12, sem fixar', () => {
    const { invoice, invoicePinned } = invoiceForImported(NU, '2026-11-25', null);
    expect(invoice.referenceMonth).toBe('2026-12');
    expect(invoicePinned).toBe(false);
  });

  it('RN-19/RN-68: conciliação com fatura do banco fixa a fatura no lançamento', () => {
    const manual = item({ source: 'manual', cardId: NU.id, reviewState: 'ok' });
    const bank = item({ cardId: NU.id });
    const bankInvoiceId = invoiceForImported(NU, '2026-11-25', '2027-01').invoice.id;
    expect(planMerge(bank, manual, { approx: false, bankInvoiceId }).manualPatch).toMatchObject({
      invoiceId: bankInvoiceId,
      invoicePinned: true,
    });
  });
});

describe('RN-70: recorrência de valor variável', () => {
  const luz = () =>
    item({
      source: 'recurrence',
      reviewState: 'ok',
      accountId: 'acc-bb',
      amountCents: 18_000,
      occurredOn: '2026-11-20',
      description: 'Luz',
      isVariableAmount: true,
      matchPattern: 'COPEL',
    });

  it('US-50: "COPEL DIST 112233" de R$ 203,45 em 22/11 efetiva a ocorrência "Luz ≈ R$ 180,00" de 20/11', () => {
    const occurrence = luz();
    const bank = item({
      accountId: 'acc-bb',
      amountCents: 20_345,
      occurredOn: '2026-11-22',
      description: 'COPEL DIST 112233',
    });
    const [action] = reconcile([bank], [occurrence], DEFAULT_RECON_OPTIONS);
    expect(action).toEqual({ importedId: bank.id, action: 'auto_merge', matchId: occurrence.id });
    const plan = planMerge(bank, occurrence, { approx: false });
    expect(plan.manualPatch).toEqual({
      matchedExternal: true,
      status: 'posted',
      amountCents: 20_345,
    });
    expect(plan.importedPatch).toEqual({ reviewState: 'merged', duplicateOf: occurrence.id });
  });

  it('RN-70: fora de 5 dias, termo diferente, valor fixo ou outra conta não casam', () => {
    const bank = (over: Partial<ReconItem>) =>
      item({
        accountId: 'acc-bb',
        amountCents: 20_345,
        occurredOn: '2026-11-22',
        description: 'COPEL DIST 112233',
        ...over,
      });
    expect(reconcile([bank({ occurredOn: '2026-11-26' })], [luz()])[0]?.action).toBe('new');
    expect(reconcile([bank({ occurredOn: '2026-11-25' })], [luz()])[0]?.action).toBe('auto_merge');
    expect(reconcile([bank({ description: 'SANEPAR 9988' })], [luz()])[0]?.action).toBe('new');
    expect(reconcile([bank({ accountId: 'acc-outra' })], [luz()])[0]?.action).toBe('new');
    expect(reconcile([bank({})], [{ ...luz(), isVariableAmount: false }])[0]?.action).toBe('new');
    expect(reconcile([bank({})], [{ ...luz(), matchPattern: null }])[0]?.action).toBe('new');
    expect(reconcile([bank({})], [{ ...luz(), source: 'manual' }])[0]?.action).toBe('new');
  });

  it('RN-70: valor exato vence o termo; duas ocorrências à mesma distância ficam para o usuário', () => {
    const exact = { ...luz(), isVariableAmount: false, amountCents: 20_345, id: 'exata' };
    const variable = luz();
    const bank = item({
      accountId: 'acc-bb',
      amountCents: 20_345,
      occurredOn: '2026-11-22',
      description: 'COPEL DIST',
    });
    expect(reconcile([bank], [variable, exact])[0]).toMatchObject({ matchId: 'exata' });
    const twin = { ...luz(), id: 'gemea', occurredOn: '2026-11-24' };
    const tie = reconcile([bank], [{ ...luz(), id: 'irma' }, twin])[0];
    expect(tie).toEqual({
      importedId: bank.id,
      action: 'suggest',
      matchIds: ['gemea', 'irma'],
      reason: 'tie',
    });
    const near = reconcile([bank], [{ ...luz(), id: 'perto', occurredOn: '2026-11-21' }, twin])[0];
    expect(near).toMatchObject({ action: 'auto_merge', matchId: 'perto' });
  });

  it('RN-70: sem diferença de valor, a ocorrência não muda', () => {
    const fixed = { ...luz(), isVariableAmount: false };
    const bank = item({ accountId: 'acc-bb', amountCents: 18_000 });
    expect(planMerge(bank, fixed, { approx: false }).manualPatch.amountCents).toBeUndefined();
    expect(planMerge(bank, luz(), { approx: false }).manualPatch.amountCents).toBeUndefined();
  });

  it('RN-70/RN-62: o termo de conciliação são os 2 primeiros tokens normalizados', () => {
    expect(matchPatternFor('COPEL DIST 112233 CAMPO MOURAO')).toBe('COPEL DIST');
    expect(matchPatternFor('PIX ENVIADO SANEPAR')).toBe('SANEPAR');
    expect(matchPatternFor('TIM')).toBeNull();
    expect(matchPatternFor(null)).toBeNull();
  });
});

describe('detectInvoicePayments (US-50, RN-71)', () => {
  const dez = invoicePeriod(NU, '2026-12');
  const charge = tx({ cardId: NU.id, invoiceId: dez.id, amountCents: 98_000, reviewState: 'ok' });

  function payable(over: Partial<PayableInvoice> = {}): PayableInvoice {
    const totals = invoiceTotals(dez.id, [charge]);
    return { ...dez, totals, status: invoiceStatus(dez, totals, '2026-12-05'), ...over };
  }

  it('US-50: "PAGTO FATURA NUBANK" de R$ 980,00 em 09/12 paga a fatura dez/2026; "Pagamento recebido" é ignorado', () => {
    const invoice = payable();
    expect(invoice.status).toBe('closed');
    const out = tx({
      accountId: 'acc-bb',
      amountCents: 98_000,
      occurredOn: '2026-12-09',
      description: 'PAGTO FATURA NUBANK',
    });
    const received = tx({
      kind: 'income',
      cardId: NU.id,
      amountCents: 98_000,
      occurredOn: '2026-12-09',
      description: 'Pagamento recebido',
    });
    const matches = detectInvoicePayments([out, received], [invoice]);
    expect(matches).toEqual([{ txId: out.id, invoiceId: dez.id, auto: true }]);
    const [match] = matches;
    if (!match) {
      throw new Error('pagamento esperado');
    }
    const paid = { ...out, ...invoicePaymentPatch(match, dez) };
    expect(paid).toMatchObject({
      kind: 'transfer',
      counterpartCardId: NU.id,
      invoiceId: dez.id,
      categoryId: null,
      reviewState: 'ok',
    });
    const ignored = detectIgnoredCardCredits([out, received]);
    expect(ignored).toEqual([received.id]);
    const ignoredTx = { ...received, reviewState: 'ignored' as const };
    const totals = invoiceTotals(dez.id, [charge, paid, ignoredTx]);
    expect(invoiceStatus(dez, totals, '2026-12-09')).toBe('paid');
    // nenhum dos dois conta como despesa ou receita
    expect(paid.kind).not.toBe('expense');
    expect(countsForTotals(ignoredTx)).toBe(false);
  });

  it('RN-71: valor exato do total ou do saldo, entre o fechamento e o vencimento + 5, sem termo na descrição', () => {
    const partial = payable({
      status: 'partial',
      totals: {
        chargesCents: 98_000,
        creditsCents: 0,
        paymentsCents: 30_000,
        balanceCents: 68_000,
      },
    });
    const at = (amountCents: number, occurredOn: string) =>
      detectInvoicePayments(
        [tx({ accountId: 'acc-bb', amountCents, occurredOn, description: 'DEBITO AUTOMATICO' })],
        [partial],
      );
    expect(at(68_000, '2026-12-02')).toMatchObject([{ auto: true }]);
    expect(at(98_000, '2026-12-14')).toMatchObject([{ auto: true }]);
    expect(at(98_000, '2026-12-15')).toEqual([]);
    expect(at(98_000, '2026-12-01')).toEqual([]);
    expect(at(97_999, '2026-12-09')).toEqual([]);
  });

  it('RN-71: com termo e valor diferente vira sugestão da fatura da janela; sem fatura na janela, nada', () => {
    const invoice = payable();
    const out = (description: string, occurredOn = '2026-12-09') =>
      tx({ accountId: 'acc-bb', amountCents: 50_000, occurredOn, description });
    for (const d of [
      'PAGAMENTO CARTAO',
      'NU PAGAMENTOS SA',
      'OUROCARD',
      'Pagto Fatura',
      'NUBANK',
    ]) {
      expect(detectInvoicePayments([out(d)], [invoice])).toEqual([
        { txId: expect.any(String), invoiceId: dez.id, auto: false },
      ]);
    }
    expect(detectInvoicePayments([out('PADARIA')], [invoice])).toEqual([]);
    expect(detectInvoicePayments([out('FATURAMENTO')], [invoice])).toEqual([]);
    expect(detectInvoicePayments([out('FATURA', '2026-12-20')], [invoice])).toEqual([]);
  });

  it('RN-71: com termo, o valor exato vale mesmo depois do vencimento + 5 (fatura vencida)', () => {
    const overdue = payable({ status: 'overdue' });
    const late = tx({
      accountId: 'acc-bb',
      amountCents: 98_000,
      occurredOn: '2026-12-28',
      description: 'PAGTO FATURA',
    });
    expect(detectInvoicePayments([late], [overdue])).toEqual([
      { txId: late.id, invoiceId: dez.id, auto: true },
    ]);
  });

  it('RN-71: só faturas fechadas, vencidas ou parcialmente pagas; só saídas vivas em conta', () => {
    const at = (status: PayableInvoice['status'], over: Partial<Tx> = {}) =>
      detectInvoicePayments(
        [
          tx({
            accountId: 'acc-bb',
            amountCents: 98_000,
            occurredOn: '2026-12-09',
            description: 'FATURA',
            ...over,
          }),
        ],
        [payable({ status })],
      ).length;
    expect(at('closed')).toBe(1);
    expect(at('overdue')).toBe(1);
    expect(at('partial')).toBe(1);
    expect(at('open')).toBe(0);
    expect(at('paid')).toBe(0);
    expect(at('future')).toBe(0);
    expect(at('closed', { kind: 'income' })).toBe(0);
    expect(at('closed', { cardId: NU.id, accountId: null })).toBe(0);
    expect(at('closed', { accountId: null })).toBe(0);
    expect(at('closed', { status: 'cancelled' })).toBe(0);
    expect(at('closed', { deletedAt: '2026-12-10T00:00:00Z' })).toBe(0);
  });

  it('RN-71: duas faturas com o mesmo valor exato → sugestão da de vencimento mais próximo', () => {
    const other: PayableInvoice = {
      ...payable(),
      id: 'fatura-bb',
      cardId: 'card-bb',
      dueDate: '2026-12-15',
      closingDate: '2026-12-05',
    };
    const out = tx({ accountId: 'acc-bb', amountCents: 98_000, occurredOn: '2026-12-10' });
    expect(detectInvoicePayments([out], [other, payable()])).toEqual([
      { txId: out.id, invoiceId: dez.id, auto: false },
    ]);
    const tie = { ...other, id: '0-fatura', dueDate: dez.dueDate };
    expect(detectInvoicePayments([out], [payable(), tie])[0]?.invoiceId).toBe('0-fatura');
  });

  it('RN-71: a fatura da janela vence a de fora dela, mesmo com vencimento mais próximo', () => {
    const outside: PayableInvoice = { ...payable(), id: 'fora', closingDate: '2026-12-12' };
    const out = tx({
      accountId: 'acc-bb',
      amountCents: 98_000,
      occurredOn: '2026-12-11',
      description: 'FATURA',
    });
    expect(detectInvoicePayments([out], [outside, payable()])).toEqual([
      { txId: out.id, invoiceId: dez.id, auto: true },
    ]);
  });

  it('RN-71: sugestão fica pendente de decisão; fatura errada é recusada', () => {
    expect(invoicePaymentPatch({ invoiceId: dez.id, auto: false }, dez).reviewState).toBe(
      'suggested',
    );
    expect(() => invoicePaymentPatch({ invoiceId: 'outra', auto: true }, dez)).toThrow(DomainError);
  });

  it('RN-71: "PAGAMENTO EFETUADO" e estorno com o termo também são ignorados; compra no cartão não', () => {
    const credits = [
      tx({ kind: 'income', cardId: NU.id, description: 'PAGAMENTO EFETUADO' }),
      tx({ kind: 'refund', cardId: NU.id, description: 'Pagamento Recebido' }),
      tx({ kind: 'expense', cardId: NU.id, description: 'Pagamento recebido' }),
      tx({ kind: 'income', accountId: 'acc-bb', description: 'Pagamento recebido' }),
      tx({ kind: 'income', cardId: NU.id, description: 'ESTORNO LOJA' }),
      tx({ kind: 'income', cardId: NU.id, description: null }),
      tx({
        kind: 'income',
        cardId: NU.id,
        description: 'Pagamento recebido',
        deletedAt: '2026-12-10T00:00:00Z',
      }),
    ];
    expect(detectIgnoredCardCredits(credits)).toEqual([credits[0]?.id, credits[1]?.id]);
  });
});

describe('detectInternalTransfers (RN-71)', () => {
  it('RN-71: saída numa conta e entrada do mesmo valor em outra conta, |Δdata| ≤ 1 → sugestão', () => {
    const out = tx({ accountId: 'acc-bb', amountCents: 50_000, occurredOn: '2026-11-10' });
    const inc = tx({
      kind: 'income',
      accountId: 'acc-nu',
      amountCents: 50_000,
      occurredOn: '2026-11-11',
    });
    expect(detectInternalTransfers([out, inc], { windowDays: 1 })).toEqual([
      { outId: out.id, inId: inc.id },
    ]);
    expect(detectInternalTransfers([out, inc])).toHaveLength(1);
  });

  it('RN-71: mesma conta, valor diferente, mais de 1 dia, cartão ou item descartado não viram transferência', () => {
    const out = tx({ accountId: 'acc-bb', amountCents: 50_000, occurredOn: '2026-11-10' });
    const inc = (over: Partial<Tx>) =>
      tx({
        kind: 'income',
        accountId: 'acc-nu',
        amountCents: 50_000,
        occurredOn: '2026-11-10',
        ...over,
      });
    for (const over of [
      { accountId: 'acc-bb' },
      { amountCents: 50_001 },
      { occurredOn: '2026-11-12' },
      { occurredOn: '2026-11-08' },
      { accountId: null, cardId: NU.id },
      { reviewState: 'merged' as const },
      { reviewState: 'ignored' as const },
      { duplicateOf: 'outra' },
      { status: 'cancelled' as const },
      { deletedAt: '2026-11-11T00:00:00Z' },
    ]) {
      expect(detectInternalTransfers([out, inc(over)], { windowDays: 1 })).toEqual([]);
    }
  });

  it('RN-71: pareamento 1:1 pela menor diferença de data', () => {
    const out1 = tx({
      id: 'o1',
      accountId: 'acc-bb',
      amountCents: 10_000,
      occurredOn: '2026-11-10',
    });
    const out2 = tx({
      id: 'o2',
      accountId: 'acc-bb',
      amountCents: 10_000,
      occurredOn: '2026-11-11',
    });
    const inA = tx({
      id: 'ia',
      kind: 'income',
      accountId: 'acc-nu',
      amountCents: 10_000,
      occurredOn: '2026-11-11',
    });
    const inB = tx({
      id: 'ib',
      kind: 'income',
      accountId: 'acc-nu',
      amountCents: 10_000,
      occurredOn: '2026-11-10',
    });
    expect(detectInternalTransfers([inA, out2, inB, out1], { windowDays: 1 })).toEqual([
      { outId: 'o1', inId: 'ib' },
      { outId: 'o2', inId: 'ia' },
    ]);
    const lone = tx({
      id: 'o3',
      accountId: 'acc-bb',
      amountCents: 10_000,
      occurredOn: '2026-11-10',
    });
    expect(detectInternalTransfers([out1, lone, inB], { windowDays: 1 })).toEqual([
      { outId: 'o1', inId: 'ib' },
    ]);
  });
});
