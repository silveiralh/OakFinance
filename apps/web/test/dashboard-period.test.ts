// T-102: o Início lê só o período que o mês usa (US-30, RN-46, RN-47, RN-51). Propriedade: com históricos gerados
// (parcelas antigas em faturas futuras, recorrências realizadas, pagamentos de fatura, aportes, agendados e
// excluídos), a leitura por período dá o mesmo painel, os mesmos avisos de orçamento e a mesma P01 que a leitura
// completa, no mês corrente e na virada do mês. Dados sintéticos.
import {
  addDays,
  addMonths,
  clampDay,
  daysInMonth,
  type ISODate,
  invoiceForPurchase,
  monthOf,
} from '@oakfinance/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type LocalRow, OakDb } from '../src/data/db';
import { cardFromRow } from '../src/data/mappers';
import { budgetAlerts, budgetView } from '../src/features/budget/budget';
import {
  loadHomePeriodRows,
  loadHomeRows,
  loadRecentRows,
  loadReviewRows,
} from '../src/features/dashboard/data';
import { homeModel } from '../src/features/dashboard/model';
import { buildInvoice } from '../src/features/quick-entry/model';
import {
  ACCOUNT,
  base,
  CARD,
  CATEGORIES,
  RECURRENCES,
  recurrence,
  STAMP,
  USER,
} from './data/reference';
import { makeRow, tx } from './data/rows';

let n = 0;
function freshDb(): OakDb {
  n += 1;
  return new OakDb(`dashboard-period-${n}`);
}

const card = cardFromRow(CARD);
const CARD_REC = recurrence('rec-streaming', {
  description: 'Streaming',
  account_id: null,
  card_id: 'a',
  payment_method: 'credit',
  amount_cents: 3990,
  day_of_month: 28,
  category_id: 'contas-da-casa',
});

type Event =
  | { t: 'expense'; day: number; cents: number; deleted: boolean; pending: boolean }
  | { t: 'income'; day: number; cents: number; expected: boolean; before: boolean }
  | { t: 'purchase'; day: number; cents: number; count: number; refund: boolean }
  | { t: 'payment'; day: number; cents: number; pick: number }
  | { t: 'goal'; day: number; cents: number; out: boolean }
  | { t: 'recurrence'; months: number; shift: number; rec: number }
  | { t: 'review'; day: number; state: 'new' | 'suggested' };

const day = fc.integer({ min: -900, max: 150 });
const cents = fc.integer({ min: 1, max: 500_000 });
const event: fc.Arbitrary<Event> = fc.oneof(
  fc.record({
    t: fc.constant('expense' as const),
    day,
    cents,
    deleted: fc.boolean(),
    pending: fc.boolean(),
  }),
  fc.record({
    t: fc.constant('income' as const),
    day,
    cents,
    expected: fc.boolean(),
    before: fc.boolean(),
  }),
  fc.record({
    t: fc.constant('purchase' as const),
    day,
    cents,
    count: fc.integer({ min: 1, max: 24 }),
    refund: fc.boolean(),
  }),
  fc.record({ t: fc.constant('payment' as const), day, cents, pick: fc.nat() }),
  fc.record({ t: fc.constant('goal' as const), day, cents, out: fc.boolean() }),
  fc.record({
    t: fc.constant('recurrence' as const),
    months: fc.integer({ min: -30, max: 2 }),
    shift: fc.integer({ min: -10, max: 10 }),
    rec: fc.nat(),
  }),
  fc.record({
    t: fc.constant('review' as const),
    day,
    state: fc.constantFrom('new' as const, 'suggested' as const),
  }),
);

// dias de virada (último e primeiro dia do mês, fevereiro e ano novo) e datas quaisquer
const today: fc.Arbitrary<ISODate> = fc.oneof(
  fc.constantFrom<ISODate>(
    '2026-11-15' as ISODate,
    '2026-11-30' as ISODate,
    '2026-12-01' as ISODate,
    '2026-12-31' as ISODate,
    '2027-01-01' as ISODate,
    '2027-02-28' as ISODate,
    '2027-03-01' as ISODate,
  ),
  fc.integer({ min: 0, max: 1100 }).map((d) => addDays('2025-01-01' as ISODate, d)),
);

interface History {
  txs: LocalRow<'transactions'>[];
  invoices: LocalRow<'invoices'>[];
  plans: LocalRow<'installment_plans'>[];
  goal: LocalRow<'goals'>;
}

function invoiceRow(purchase: ISODate): LocalRow<'invoices'> {
  return {
    ...buildInvoice(invoiceForPurchase(card, purchase), USER, STAMP),
    is_manual_dates: false,
  };
}

/** A k-ésima parcela cai na fatura do mesmo dia k − 1 meses depois (a data guardada é a da compra, RN-22). */
function shiftDate(d: ISODate, months: number): ISODate {
  const ym = addMonths(monthOf(d), months);
  return clampDay(ym, Math.min(Number(d.slice(8, 10)), daysInMonth(ym)));
}

function build(events: readonly Event[], now: ISODate): History {
  const txs: LocalRow<'transactions'>[] = [];
  const invoices = new Map<string, LocalRow<'invoices'>>();
  const plans: LocalRow<'installment_plans'>[] = [];
  const recs = [...RECURRENCES, CARD_REC];
  events.forEach((e, i) => {
    const id = `t${i}`;
    switch (e.t) {
      case 'expense':
        txs.push(
          tx(id, {
            ...base,
            category_id: i % 2 ? 'mercado' : 'moradia',
            amount_cents: e.cents,
            occurred_on: addDays(now, e.day),
            status: e.pending ? 'pending' : 'posted',
            deleted_at: e.deleted ? STAMP : null,
          }),
        );
        break;
      case 'income':
        txs.push(
          tx(id, {
            ...base,
            kind: 'income',
            category_id: 'renda-extra',
            amount_cents: e.cents,
            occurred_on: addDays(now, e.day),
            income_expected: e.expected,
            count_before_received: e.before,
            status: e.expected ? 'pending' : 'posted',
          }),
        );
        break;
      case 'purchase': {
        const purchase = addDays(now, e.day);
        const series = `s${i}`;
        plans.push(
          makeRow('installment_plans', {
            id: series,
            card_id: 'a',
            account_id: null,
            category_id: 'mercado',
            purchase_date: purchase,
            installments_count: e.count,
            start_installment: 1,
            total_cents: e.cents * e.count,
            deleted_at: null,
          }),
        );
        for (let k = 1; k <= e.count; k++) {
          const inv = invoiceRow(shiftDate(purchase, k - 1));
          invoices.set(inv.id, inv);
          txs.push(
            tx(`${id}-${k}`, {
              ...base,
              account_id: null,
              card_id: 'a',
              invoice_id: inv.id,
              payment_method: 'credit',
              category_id: 'mercado',
              amount_cents: e.cents,
              occurred_on: purchase,
              series_id: e.count > 1 ? series : null,
              installment_number: e.count > 1 ? k : null,
              installment_count: e.count > 1 ? e.count : null,
            }),
          );
        }
        if (e.refund) {
          const inv = invoiceRow(purchase);
          invoices.set(inv.id, inv);
          txs.push(
            tx(`${id}-r`, {
              ...base,
              kind: 'refund',
              account_id: null,
              card_id: 'a',
              invoice_id: inv.id,
              payment_method: 'credit',
              category_id: 'mercado',
              amount_cents: Math.ceil(e.cents / 2),
              occurred_on: purchase,
            }),
          );
        }
        break;
      }
      case 'payment': {
        const list = [...invoices.values()];
        const inv = list[e.pick % Math.max(list.length, 1)];
        if (!inv) {
          break;
        }
        txs.push(
          tx(id, {
            ...base,
            kind: 'transfer',
            category_id: null,
            counterpart_card_id: 'a',
            invoice_id: inv.id,
            amount_cents: e.cents,
            occurred_on: inv.due_date < now ? inv.due_date : addDays(now, e.day),
            payment_method: 'transfer',
          }),
        );
        break;
      }
      case 'goal':
        txs.push(
          tx(id, {
            ...base,
            kind: e.out ? 'income' : 'expense',
            category_id: e.out ? null : 'reserva-emergencia',
            goal_id: 'g1',
            amount_cents: e.cents,
            occurred_on: addDays(now, e.day),
          }),
        );
        break;
      case 'recurrence': {
        const rec = recs[e.rec % recs.length];
        if (!rec) {
          break;
        }
        const ym = addMonths(monthOf(now), e.months);
        const date = clampDay(ym, Math.min(rec.day_of_month ?? 1, daysInMonth(ym)));
        txs.push(
          tx(id, {
            ...base,
            kind: rec.kind === 'income' ? 'income' : 'expense',
            account_id: rec.account_id,
            card_id: rec.card_id,
            invoice_id: rec.card_id ? invoiceRow(date).id : null,
            payment_method: rec.payment_method,
            category_id: rec.category_id,
            amount_cents: rec.amount_cents,
            occurred_on: addDays(date, e.shift),
            recurrence_id: rec.id,
            recurrence_date: date,
            source: 'recurrence',
          }),
        );
        if (rec.card_id) {
          const inv = invoiceRow(date);
          invoices.set(inv.id, inv);
        }
        break;
      }
      case 'review':
        txs.push(
          tx(id, {
            ...base,
            category_id: 'mercado',
            occurred_on: addDays(now, e.day),
            source: 'ofx',
            external_id: id,
            review_state: e.state,
          }),
        );
        break;
    }
  });
  const goal = makeRow('goals', {
    id: 'g1',
    kind: 'emergency_reserve',
    target_mode: 'manual',
    target_cents: 1_000_000,
    deleted_at: null,
  });
  return { txs, invoices: [...invoices.values()], plans, goal };
}

async function seedHistory(db: OakDb, h: History, attribution: string) {
  await db.categories.bulkPut(CATEGORIES);
  await db.accounts.bulkPut([ACCOUNT]);
  await db.cards.bulkPut([CARD]);
  await db.recurrences.bulkPut([...RECURRENCES, CARD_REC]);
  await db.invoices.bulkPut(h.invoices);
  await db.installment_plans.bulkPut(h.plans);
  await db.goals.bulkPut([h.goal]);
  await db.profiles.put(
    makeRow('profiles', { id: USER, settings: { spendable: { cardAttribution: attribution } } }),
  );
  await db.transactions.bulkPut(h.txs);
}

/** O painel sem o saldo nas contas (que soma o histórico inteiro, D-081). */
function monthOnly(m: ReturnType<typeof homeModel>) {
  const { balanceCents: _balance, ...rest } = m;
  return rest;
}

describe('T-102: Início lê só o período necessário (RN-46, RN-47, RN-51)', () => {
  it('RN-47: a leitura por período dá o mesmo painel, os mesmos avisos e a mesma P01 que a leitura completa', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(event, { maxLength: 40 }),
        today,
        fc.constantFrom('invoice_due_month', 'purchase_month'),
        async (events, now, attribution) => {
          const db = freshDb();
          try {
            await seedHistory(db, build(events, now), attribution);
            const all = await loadHomeRows(db);
            const period = await loadHomePeriodRows(db, now);
            expect(period.txRows.length).toBeLessThanOrEqual(all.txRows.length);
            // no dia e na virada para o dia seguinte (o painel recarrega a leitura quando o dia muda)
            // D-081: o "Saldo nas contas" depende de todo o histórico das contas; a leitura por período (T-102) ainda
            // não tem o agregado, então ele fica fora desta comparação (ver HANDOFF §3, T-102)
            expect(monthOnly(homeModel(period, now))).toEqual(monthOnly(homeModel(all, now)));
            expect(budgetAlerts(period, now, false)).toEqual(budgetAlerts(all, now, false));
            expect(budgetView(period, now)).toEqual(budgetView(all, now));
            const next = addDays(now, 1);
            const periodNext = await loadHomePeriodRows(db, next);
            expect(monthOnly(homeModel(periodNext, next))).toEqual(monthOnly(homeModel(all, next)));
          } finally {
            db.close();
            await db.delete();
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('RN-51: o histórico antigo fora das faturas abertas, das séries e das recorrências não é lido', async () => {
    const db = freshDb();
    const now = '2026-11-15' as ISODate;
    const old = Array.from({ length: 50 }, (_, i) =>
      tx(`old${i}`, {
        ...base,
        category_id: 'mercado',
        occurred_on: addDays('2024-01-01' as ISODate, i),
      }),
    );
    const recent = tx('outubro', { ...base, category_id: 'mercado', occurred_on: '2026-10-01' });
    await seedHistory(
      db,
      { txs: [...old, recent], invoices: [], plans: [], goal: build([], now).goal },
      'invoice_due_month',
    );
    const period = await loadHomePeriodRows(db, now);
    expect(period.txRows.map((r) => r.id)).toEqual(['outubro']);
    expect(homeModel(period, now)).toEqual(homeModel(await loadHomeRows(db), now));
  });

  it('US-30: parcela de compra de 2 anos atrás na fatura de dezembro entra no período (RN-22)', async () => {
    const db = freshDb();
    const now = '2026-11-15' as ISODate;
    const h = build([{ t: 'purchase', day: -700, cents: 10_000, count: 24, refund: false }], now);
    await seedHistory(db, h, 'invoice_due_month');
    const period = await loadHomePeriodRows(db, now);
    const months = period.txRows.map(
      (r) => h.invoices.find((inv) => inv.id === r.invoice_id)?.reference_month ?? '',
    );
    expect(months).toContain('2026-12-01');
    expect(months).toContain('2026-11-01');
    expect(period.txRows.length).toBeGreaterThan(0);
    expect(homeModel(period, now)).toEqual(homeModel(await loadHomeRows(db), now));
  });
});

describe('T-102: recentes e "Conferir" pelos índices', () => {
  it('US-30: os 3 mais recentes por data e, no mesmo dia, pelo criado por último', async () => {
    const db = freshDb();
    await db.transactions.bulkPut([
      tx('a', { occurred_on: '2026-11-10', created_at: '2026-11-10T10:00:00.000Z' }),
      tx('b', { occurred_on: '2026-11-12', created_at: '2026-11-12T08:00:00.000Z' }),
      tx('c', { occurred_on: '2026-11-12', created_at: '2026-11-12T09:00:00.000Z' }),
      tx('d', {
        occurred_on: '2026-11-11',
        created_at: '2026-11-11T09:00:00.000Z',
        deleted_at: STAMP,
      }),
      tx('e', { occurred_on: '2026-11-10', created_at: '2026-11-10T12:00:00.000Z' }),
      tx('f', { occurred_on: '2025-01-01' }),
    ]);
    expect((await loadRecentRows(db, 3)).map((r) => r.id)).toEqual(['c', 'b', 'e']);
    expect(await loadRecentRows(freshDb(), 3)).toEqual([]);
  });

  it('US-30: "Conferir" conta só importados novos ou sugeridos e não excluídos', async () => {
    const db = freshDb();
    await db.transactions.bulkPut([
      tx('n', { source: 'ofx', external_id: 'n', review_state: 'new' }),
      tx('s', { source: 'pluggy', external_id: 's', review_state: 'suggested' }),
      tx('m', { source: 'manual', review_state: 'new' }),
      tx('x', { source: 'ofx', external_id: 'x', review_state: 'new', deleted_at: STAMP }),
      tx('o', { source: 'ofx', external_id: 'o', review_state: 'ok' }),
    ]);
    expect((await loadReviewRows(db)).map((r) => r.id).sort()).toEqual(['n', 's']);
  });
});
