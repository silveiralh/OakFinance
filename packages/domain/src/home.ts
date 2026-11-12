// Início pelo gasto do mês (D-081, T-120): saldo atual das contas e a saúde de cada faixa do 50/30/20. O gasto do
// mês é o GR da RN-47 (`spendableThisMonth().spentCents`: efetivadas pelo mês de impacto, menos estornos).
import type { BucketStatus } from './budget.ts';
import { daysInMonth, monthOf } from './dates.ts';
import type { Account, Cents, ISODate, Tx } from './types.ts';

/**
 * Saldo atual de uma conta (D-081): saldo inicial na data dele mais o efeito dos lançamentos efetivados, não
 * cancelados e não apagados, de `initialBalanceOn` até `today` (inclusive). Entradas (receita, estorno, ajuste de
 * entrada e transferência recebida) somam; saídas (despesa, ajuste de saída, transferência enviada e pagamento de
 * fatura) subtraem.
 */
export function accountBalance(
  account: Pick<Account, 'id' | 'initialBalanceCents' | 'initialBalanceOn'>,
  txs: readonly Tx[],
  today: ISODate,
): Cents {
  let cents = account.initialBalanceCents;
  for (const tx of txs) {
    if (
      tx.status !== 'posted' ||
      tx.deletedAt !== null ||
      tx.occurredOn < account.initialBalanceOn ||
      tx.occurredOn > today
    ) {
      continue;
    }
    if (tx.accountId === account.id) {
      if (tx.kind === 'income' || tx.kind === 'refund' || tx.kind === 'adjust_in') {
        cents += tx.amountCents;
      } else {
        cents -= tx.amountCents;
      }
    } else if (tx.kind === 'transfer' && tx.counterpartAccountId === account.id) {
      cents += tx.amountCents;
    }
  }
  return cents;
}

/** "Saldo nas contas" (D-081): soma dos saldos atuais das contas (cartões não são contas). */
export function accountsBalance(
  accounts: readonly Pick<Account, 'id' | 'initialBalanceCents' | 'initialBalanceOn'>[],
  txs: readonly Tx[],
  today: ISODate,
): Cents {
  return accounts.reduce((sum, a) => sum + accountBalance(a, txs, today), 0);
}

export type BandHealth = 'on_track' | 'attention' | 'over';

/** Dias finais do mês em que a Poupança abaixo da meta passa a "Atenção". */
export const SAVINGS_ATTENTION_DAYS = 5;

/**
 * Estado da faixa no card "Saúde do mês" (D-081, limiares 80%/100% da D-082 até a T-121). Necessidades e Desejos são
 * teto: o nível do orçamento (`ok`/`warning`/`over`) vira "No caminho"/"Atenção"/"Passou do planejado". Poupança é
 * mínimo: nunca "passa do planejado"; abaixo da meta só vira "Atenção" nos últimos dias do mês.
 */
export function bandHealth(status: BucketStatus, today: ISODate): BandHealth {
  if (status.bucket !== 'savings') {
    return status.level === 'over' ? 'over' : status.level === 'warning' ? 'attention' : 'on_track';
  }
  if (status.targetCents <= 0 || status.spentCents >= status.targetCents) {
    return 'on_track';
  }
  const last = daysInMonth(monthOf(today));
  const day = Number(today.slice(8, 10));
  return last - day < SAVINGS_ATTENTION_DAYS ? 'attention' : 'on_track';
}
