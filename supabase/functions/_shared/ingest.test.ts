// T-072: tipos neutros → linhas do banco (tech §6.1.4 passo 4 e §6.1.6; RN-19, RN-65, RN-80). Dados sintéticos.
import assert from 'node:assert/strict';
import type { ProviderBill, ProviderTransaction } from './connectors/types.ts';
import {
  type Card,
  type Category,
  type CategoryRule,
  invoiceId,
  pluggyTxId,
} from './domain/index.ts';
import {
  categoryFor,
  externalMetaOf,
  type IngestTarget,
  type InvoiceRef,
  invoiceForProviderTx,
  invoiceOverrides,
  invoiceRow,
  newTransactionRow,
  paymentMethodFor,
  providerPatch,
  SERVER_DEVICE,
  txKindFor,
} from './ingest.ts';

const USER = '00000000-0000-7000-8000-00000000000a';
const NOW = '2026-11-07T12:00:00.000Z';
const CARD: Card = {
  id: '00000000-0000-7000-8000-0000000000c1',
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: 500000,
  paymentAccountId: null,
};
const ACCOUNT: IngestTarget = {
  kind: 'account',
  accountId: '00000000-0000-7000-8000-0000000000a1',
};
const ON_CARD: IngestTarget = { kind: 'card', card: CARD };

function ptx(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    id: 'tx-1',
    accountId: 'acc',
    occurredAt: '2026-10-15T18:00:00.000Z',
    occurredOn: '2026-10-15',
    amountCents: 12000,
    direction: 'out',
    description: 'Loja Exemplo',
    descriptionRaw: 'LOJA EXEMPLO',
    status: 'posted',
    providerCategory: null,
    paymentMethodRaw: null,
    installment: null,
    billId: null,
    merchantName: null,
    merchantCnpj: null,
    ...overrides,
  };
}

Deno.test('tech §6.1.6: DEBIT/CREDIT em conta e em cartão viram o tipo certo', () => {
  assert.equal(txKindFor({ direction: 'out' }, ACCOUNT), 'expense');
  assert.equal(txKindFor({ direction: 'in' }, ACCOUNT), 'income');
  assert.equal(txKindFor({ direction: 'out' }, ON_CARD), 'expense');
  assert.equal(txKindFor({ direction: 'in' }, ON_CARD), 'refund');
});

Deno.test('tech §6.1.6: meio de pagamento pelo provedor; cartão é crédito; senão débito', () => {
  assert.equal(paymentMethodFor({ paymentMethodRaw: 'PIX' }, ACCOUNT), 'pix');
  assert.equal(paymentMethodFor({ paymentMethodRaw: 'ted' }, ACCOUNT), 'transfer');
  assert.equal(paymentMethodFor({ paymentMethodRaw: 'BOLETO' }, ACCOUNT), 'boleto');
  assert.equal(paymentMethodFor({ paymentMethodRaw: null }, ACCOUNT), 'debit');
  assert.equal(paymentMethodFor({ paymentMethodRaw: 'PIX' }, ON_CARD), 'credit');
});

Deno.test('tech §6.1.6: external_meta segue o contrato e preserva userMovedInvoice', () => {
  const tx = ptx({
    providerCategory: 'Shopping',
    billId: 'bill-1',
    installment: { n: 2, total: 10 },
    paymentMethodRaw: 'PIX',
  });
  assert.deepEqual(externalMetaOf(tx), {
    provider: 'pluggy',
    providerCategory: 'Shopping',
    billId: 'bill-1',
    installment: { n: 2, total: 10 },
    paymentMethodRaw: 'PIX',
  });
  assert.deepEqual(externalMetaOf(ptx(), { provider: 'pluggy', userMovedInvoice: true }), {
    provider: 'pluggy',
    userMovedInvoice: true,
  });
});

Deno.test('RN-12/RN-19: fatura pela data da compra; com billId, a do banco e fixada', () => {
  const bills: ProviderBill[] = [
    { id: 'bill-1', dueDate: '2026-12-10', totalCents: 1, minimumPaymentCents: null },
  ];
  // sem billId: compra em 15/10 com fechamento dia 3 → fatura que fecha em 03/11 e vence em 10/11
  const plain = invoiceForProviderTx(CARD, ptx(), [], bills);
  assert.equal(plain.invoice.referenceMonth, '2026-11');
  assert.equal(plain.invoice.id, invoiceId(CARD.id, '2026-11'));
  assert.equal(plain.invoicePinned, false);
  assert.equal(plain.existingId, null);
  // com billId da bill de dezembro → fatura de dezembro, fixada (RN-19)
  const pinned = invoiceForProviderTx(CARD, ptx({ billId: 'bill-1' }), [], bills);
  assert.equal(pinned.invoice.referenceMonth, '2026-12');
  assert.equal(pinned.invoicePinned, true);
  // fatura já gravada com o external_bill_id → usa ela
  const stored: InvoiceRef = {
    id: 'inv-gravada',
    card_id: CARD.id,
    reference_month: '2027-01-01',
    closing_date: '2027-01-03',
    due_date: '2027-01-10',
    external_bill_id: 'bill-1',
    deleted_at: null,
  };
  const byBill = invoiceForProviderTx(CARD, ptx({ billId: 'bill-1' }), [stored], bills);
  assert.equal(byBill.invoice.referenceMonth, '2027-01');
  assert.equal(byBill.existingId, 'inv-gravada');
  // billId desconhecido → RN-12; fatura do mês já gravada é reaproveitada
  const sameMonth = {
    ...stored,
    id: 'inv-nov',
    reference_month: '2026-11-01',
    external_bill_id: null,
  };
  const unknown = invoiceForProviderTx(CARD, ptx({ billId: 'bill-x' }), [sameMonth], bills);
  assert.equal(unknown.invoicePinned, false);
  assert.equal(unknown.existingId, 'inv-nov');
  // fechamento ajustado na fatura gravada vale para a RN-12 (compra em 04/11 com fechamento movido para 05/11)
  const moved = { ...sameMonth, closing_date: '2026-11-05', due_date: '2026-11-12' };
  assert.deepEqual(invoiceOverrides([moved, { ...moved, id: 'z', deleted_at: NOW }]), [
    { referenceMonth: '2026-11', closingDate: '2026-11-05', dueDate: '2026-11-12' },
  ]);
  const late = invoiceForProviderTx(CARD, ptx({ occurredOn: '2026-11-04' }), [moved], []);
  assert.equal(late.invoice.referenceMonth, '2026-11');
  // fatura de outro cartão não conta
  const other = invoiceForProviderTx(CARD, ptx(), [{ ...sameMonth, card_id: 'outro' }], []);
  assert.equal(other.existingId, null);
});

Deno.test('tech §6.1.4: fatura nova com id v5 e os dados da bill do banco', () => {
  const { invoice } = invoiceForProviderTx(CARD, ptx(), [], []);
  const bill: ProviderBill = {
    id: 'bill-nov',
    dueDate: '2026-11-11',
    totalCents: 90000,
    minimumPaymentCents: 13500,
  };
  assert.deepEqual(invoiceRow(USER, invoice, NOW, bill), {
    id: invoiceId(CARD.id, '2026-11'),
    user_id: USER,
    card_id: CARD.id,
    reference_month: '2026-11-01',
    closing_date: '2026-11-03',
    due_date: '2026-11-11',
    is_manual_dates: false,
    external_bill_id: 'bill-nov',
    external_total_cents: 90000,
    external_min_payment_cents: 13500,
    client_updated_at: NOW,
    device_id: SERVER_DEVICE,
  });
  const plain = invoiceRow(USER, invoice, NOW);
  assert.equal(plain.due_date, '2026-11-10');
  assert.equal(plain.external_bill_id, null);
});

const MERCADO: Category = {
  id: 'cat-mercado',
  slug: 'mercado',
  kind: 'expense',
  bucket: 'needs',
  parentId: null,
  isSystem: false,
  feedsReserve: false,
};
const LAZER: Category = { ...MERCADO, id: 'cat-lazer', slug: 'lazer', bucket: 'wants' };

Deno.test('tech §6.1.4: categoria pelas regras do usuário; senão pelo provedor; senão nenhuma', () => {
  const rule = {
    id: 'rule-1',
    categoryId: LAZER.id,
    matchField: 'description',
    matchType: 'token_prefix',
    pattern: 'LOJA EXEMPLO',
    enabled: true,
    source: 'learned',
    hits: 3,
    lastHitAt: null,
    accountId: null,
    cardId: null,
    paymentMethod: null,
    priority: 0,
    deletedAt: null,
  } as unknown as CategoryRule;
  const byRule = categoryFor(
    ptx({ providerCategory: 'Groceries' }),
    ON_CARD,
    [rule],
    [MERCADO, LAZER],
  );
  assert.equal(byRule.categorySource, 'rule');
  assert.equal(byRule.categoryId, LAZER.id);
  assert.deepEqual(
    categoryFor(
      ptx({ description: 'Outra', providerCategory: 'Groceries' }),
      ON_CARD,
      [rule],
      [MERCADO, LAZER],
    ),
    {
      categoryId: MERCADO.id,
      categorySource: 'provider',
      ruleId: null,
    },
  );
  assert.deepEqual(categoryFor(ptx({ description: null }), ACCOUNT, [], [MERCADO]), {
    categoryId: null,
    categorySource: 'none',
    ruleId: null,
  });
});

Deno.test('RN-65/RN-80: lançamento novo com id determinístico, review_state new e o que é antigo já revisado', () => {
  const tx = ptx({
    status: 'pending',
    installment: { n: 2, total: 10 },
    billId: 'bill-1',
    merchantName: 'Loja Exemplo',
    description: 'x'.repeat(250),
  });
  const row = newTransactionRow({
    userId: USER,
    tx,
    target: ON_CARD,
    category: { categoryId: 'cat-lazer', categorySource: 'rule', ruleId: 'rule-1' },
    invoice: { id: 'inv-1', pinned: true },
    startedOn: '2026-10-01',
    nowIso: NOW,
  });
  assert.equal(row.id, pluggyTxId(USER, 'tx-1'));
  assert.deepEqual(
    [
      row.kind,
      row.status,
      row.amount_cents,
      row.payment_method,
      row.card_id,
      row.account_id,
      row.invoice_id,
      row.invoice_pinned,
    ],
    ['expense', 'pending', 12000, 'credit', CARD.id, null, 'inv-1', true],
  );
  assert.deepEqual(
    [row.source, row.external_id, row.review_state, row.device_id],
    ['pluggy', 'tx-1', 'new', SERVER_DEVICE],
  );
  assert.deepEqual([row.installment_number, row.installment_count], [2, 10]);
  assert.equal((row.description as string).length, 200);
  assert.equal(row.description_raw, 'LOJA EXEMPLO');
  assert.equal(row.category_rule_id, 'rule-1');
  // RN-80: anterior ao início do uso → revisado
  const old = newTransactionRow({
    userId: USER,
    tx: ptx({ occurredOn: '2026-09-30', direction: 'in' }),
    target: ACCOUNT,
    category: { categoryId: null, categorySource: 'none', ruleId: null },
    invoice: null,
    startedOn: '2026-10-01',
    nowIso: NOW,
  });
  assert.deepEqual(
    [old.review_state, old.kind, old.payment_method, old.card_id, old.invoice_id],
    ['ok', 'income', 'debit', null, null],
  );
  // id igual para o mesmo item do provedor (não duplica ao sincronizar de novo)
  assert.equal(old.id, row.id);
  assert.throws(() =>
    newTransactionRow({
      userId: USER,
      tx,
      target: ON_CARD,
      category: { categoryId: null, categorySource: 'none', ruleId: null },
      invoice: null,
      startedOn: null,
      nowIso: NOW,
    }),
  );
});

Deno.test('tech §6.1.4: existente muda só as colunas do provedor e respeita a fatura movida pelo usuário', () => {
  const existing = {
    amount_cents: 12000,
    occurred_on: '2026-10-15',
    occurred_at: '2026-10-15T18:00:00+00:00',
    status: 'pending',
    description_raw: 'LOJA EXEMPLO',
    // jsonb volta com outra ordem de chaves
    external_meta: { provider: 'pluggy' },
    invoice_id: 'inv-1',
    invoice_pinned: false,
    category_id: 'cat-do-usuario',
    notes: 'anotação',
    review_state: 'merged',
  };
  // nada mudou → null
  assert.equal(
    providerPatch(existing, ptx({ status: 'pending' }), { id: 'inv-1', pinned: false }, NOW),
    null,
  );
  const patch = providerPatch(
    existing,
    ptx({ status: 'posted', amountCents: 12500 }),
    { id: 'inv-2', pinned: true },
    NOW,
  );
  assert.deepEqual(patch, {
    amount_cents: 12500,
    occurred_on: '2026-10-15',
    occurred_at: '2026-10-15T18:00:00.000Z',
    status: 'posted',
    description_raw: 'LOJA EXEMPLO',
    external_meta: { provider: 'pluggy' },
    invoice_id: 'inv-2',
    invoice_pinned: true,
    client_updated_at: NOW,
    device_id: SERVER_DEVICE,
  });
  for (const column of ['category_id', 'notes', 'description', 'review_state', 'duplicate_of']) {
    assert.ok(!(column in (patch ?? {})), column);
  }
  // usuário moveu de fatura: invoice_id fica
  const moved = { ...existing, external_meta: { userMovedInvoice: true, provider: 'pluggy' } };
  const keep = providerPatch(
    moved,
    ptx({ amountCents: 13000 }),
    { id: 'inv-2', pinned: true },
    NOW,
  );
  assert.ok(keep && !('invoice_id' in keep));
  assert.deepEqual(keep?.external_meta, { provider: 'pluggy', userMovedInvoice: true });
  // occurred_at nulo antes
  assert.ok(
    providerPatch({ ...existing, occurred_at: null }, ptx({ status: 'pending' }), null, NOW),
  );
});
