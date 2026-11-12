// T-121 (D-082): limiares de aviso configuráveis (RN-92) — perfil, faixas, limites por categoria e avisos.
import { describe, expect, it } from 'vitest';
import {
  type BudgetConfig,
  bucketBudget,
  categoryThresholdsBp,
  DEFAULT_THRESHOLDS_BP,
  type MonthInput,
  resolveBudgetConfig,
} from '../src/budget.ts';
import {
  alertThresholdsBp,
  DEFAULT_ALERT_PCTS,
  resolveProfileSettings,
  validAlertPcts,
} from '../src/settings.ts';
import type { Category, Tx } from '../src/types.ts';

const mercado: Category = {
  id: 'mercado',
  parentId: null,
  kind: 'expense',
  bucket: 'needs',
  slug: 'mercado',
  feedsReserve: false,
} as Category;

function tx(amountCents: number): Tx {
  return {
    id: `t-${amountCents}`,
    kind: 'expense',
    status: 'posted',
    countBeforeReceived: false,
    invoicePinned: false,
    amountCents,
    occurredOn: '2026-11-05',
    description: null,
    categoryId: 'mercado',
    paymentMethod: 'pix',
    accountId: 'bb',
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
    source: 'manual',
    externalId: null,
    reviewState: 'ok',
    duplicateOf: null,
    merchantCnpj: null,
    deletedAt: null,
  };
}

function input(cents: number): MonthInput {
  return {
    month: '2026-11',
    today: '2026-11-10',
    txs: [tx(cents)],
    recurrences: [],
    cards: [],
    accounts: [],
    categories: [mercado],
    invoiceMonthById: new Map(),
    attribution: 'invoice_due_month',
    includeRestrictedAccounts: true,
  };
}

const PCT = { needs: 5000, wants: 3000, savings: 2000 };

describe('D-082: limiares do perfil', () => {
  it('RN-92 (D-082): padrão 80% e 100%; inteiros com 1 ≤ atenção < passou ≤ 200', () => {
    expect(resolveProfileSettings({}).alerts).toEqual(DEFAULT_ALERT_PCTS);
    expect(alertThresholdsBp(DEFAULT_ALERT_PCTS)).toEqual([...DEFAULT_THRESHOLDS_BP]);
    expect(resolveProfileSettings({ alerts: { attentionPct: 70, overPct: 120 } }).alerts).toEqual({
      attentionPct: 70,
      overPct: 120,
    });
    for (const [a, o] of [
      [0, 100],
      [80, 80],
      [90, 80],
      [80, 201],
      [80.5, 100],
      ['80', 100],
    ]) {
      expect(validAlertPcts(a, o), `${a}/${o}`).toBe(false);
      expect(resolveProfileSettings({ alerts: { attentionPct: a, overPct: o } }).alerts).toEqual(
        DEFAULT_ALERT_PCTS,
      );
    }
    expect(validAlertPcts(1, 200)).toBe(true);
  });

  it('RN-92 (D-082): os limiares do perfil valem para as faixas no lugar dos guardados no orçamento', () => {
    const rows = [
      {
        month: null,
        scope: 'bucket',
        bucket: 'needs' as const,
        pctBp: 5000,
        alertThresholdsBp: [8000, 10000],
      },
    ];
    expect(resolveBudgetConfig(rows, '2026-11').alertThresholdsBp).toEqual([8000, 10000]);
    expect(resolveBudgetConfig(rows, '2026-11', [7000, 12000]).alertThresholdsBp).toEqual([
      7000, 12000,
    ]);
  });

  it('RN-92 (D-082): com 70%/120%, Necessidades fica em atenção a 75% e só passa do planejado acima de 120%', () => {
    const custom: BudgetConfig = { pctBp: PCT, alertThresholdsBp: [7000, 12000] };
    const standard: BudgetConfig = { pctBp: PCT, alertThresholdsBp: [...DEFAULT_THRESHOLDS_BP] };
    // renda 1.000 → meta de Necessidades 500
    expect(bucketBudget(input(37_500), custom, 100_000).needs.level).toBe('warning');
    expect(bucketBudget(input(37_500), standard, 100_000).needs.level).toBe('ok');
    expect(bucketBudget(input(55_000), custom, 100_000).needs.level).toBe('warning');
    expect(bucketBudget(input(55_000), standard, 100_000).needs.level).toBe('over');
    expect(bucketBudget(input(60_000), custom, 100_000).needs.level).toBe('warning');
    expect(bucketBudget(input(60_001), custom, 100_000).needs.level).toBe('over');
  });

  it('RN-92 (D-082): limite por categoria com o padrão segue o perfil; com limiares próprios fica como está', () => {
    expect(categoryThresholdsBp([8000, 10000], [7000, 12000])).toEqual([7000, 12000]);
    expect(categoryThresholdsBp([9000, 10000], [7000, 12000])).toEqual([9000, 10000]);
  });
});
