// Leitura das telas de cartão e a gravação das faturas que faltam e do saldo credor (RN-15) ao abrir C01/C02.
import { CARRY_OVER_SLUG, type ISODate, type Tx } from '@oakfinance/domain';
import { useEffect, useMemo, useRef } from 'react';
import type { UserSession } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { cardFromRow, txFromRow } from '../../data/mappers';
import { saveRow } from '../../data/repositories/rows';
import { planCardData } from './model';

export interface CardsData {
  cards: LocalRow<'cards'>[];
  invoices: LocalRow<'invoices'>[];
  txRows: LocalRow<'transactions'>[];
  categories: LocalRow<'categories'>[];
  accounts: LocalRow<'accounts'>[];
  txs: Tx[];
}

/** Cartões ativos (não excluídos nem arquivados), faturas, lançamentos de cartão e categorias. */
export function useCardsData(user: UserSession | null): CardsData | undefined {
  const raw = useLive(
    user
      ? async () => ({
          cards: (await user.db.cards.toArray())
            .filter((c) => c.deleted_at === null && c.archived_at === null)
            .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
          invoices: await user.db.invoices.toArray(),
          txRows: (await user.db.transactions.toArray()).filter(
            (r) => r.card_id !== null || r.counterpart_card_id !== null,
          ),
          categories: await user.db.categories.toArray(),
          accounts: await user.db.accounts.toArray(),
        })
      : null,
    [user],
  );
  return useMemo(
    () =>
      raw
        ? {
            ...raw,
            // linha de cartão fora do contrato não derruba a tela (fica fora da lista)
            cards: raw.cards.filter((row) => {
              try {
                cardFromRow(row);
                return true;
              } catch {
                return false;
              }
            }),
            txs: raw.txRows.flatMap((row) => {
              try {
                return [txFromRow(row)];
              } catch {
                return [];
              }
            }),
          }
        : undefined,
    [raw],
  );
}

/** Grava as faturas que faltam e o saldo credor de cada cartão. Só roda de novo quando os dados mudam. */
export function useEnsureCardData(
  user: UserSession | null,
  data: CardsData | undefined,
  today: ISODate,
) {
  const running = useRef(false);
  useEffect(() => {
    if (!user || !data || running.current) {
      return;
    }
    const carryOver =
      data.categories.find((c) => c.slug === CARRY_OVER_SLUG && c.deleted_at === null)?.id ?? null;
    const nowIso = new Date().toISOString();
    const plans = data.cards.map((row) =>
      planCardData(
        cardFromRow(row),
        data.invoices,
        data.txRows,
        data.txs,
        today,
        user.userId,
        nowIso,
        carryOver,
      ),
    );
    const invoices = plans.flatMap((p) => p.invoices);
    const transactions = plans.flatMap((p) => p.transactions);
    if (invoices.length === 0 && transactions.length === 0) {
      return;
    }
    running.current = true;
    void (async () => {
      try {
        for (const row of invoices) {
          await saveRow(user.db, 'invoices', row);
        }
        for (const row of transactions) {
          await saveRow(user.db, 'transactions', row);
        }
        user.engine.notifyWrite();
      } finally {
        running.current = false;
      }
    })();
  }, [user, data, today]);
}

/** Cor do cartão para o InvoiceCard (UX §5.18); sem cor válida, grafite. */
export const BRAND_COLORS = ['aqua', 'grass', 'violet', 'night', 'coral', 'graphite'] as const;
export type BrandColor = (typeof BRAND_COLORS)[number];

export function brandColor(color: string | null): BrandColor {
  return (BRAND_COLORS as readonly string[]).includes(color ?? '')
    ? (color as BrandColor)
    : 'graphite';
}
