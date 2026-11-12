import { formatBRL, HIDDEN_AMOUNT, MINUS_SIGN } from '@oakfinance/domain';
import { CloudUpload, Ellipsis, Link } from 'lucide-react';
import { uiText } from '../i18n/pt-BR';
import { useEnvironment } from '../lib/useEnvironment';
import { MoneyText } from './MoneyText';
import { type AppIcon, type BaseProps, cx } from './types';

export type TxState = 'scheduled' | 'forecast' | 'to_receive' | 'late' | 'cancelled';

export interface RowTx {
  id: string;
  kind: 'expense' | 'income' | 'saving' | 'transfer';
  amountCents: number;
  description?: string;
  category: {
    name: string;
    icon: AppIcon;
    band: 'needs' | 'wants' | 'savings' | 'income' | 'none';
  };
  method: string;
  /** Texto de data/hora já formatado ("hoje 14:32"). */
  when: string;
  installment?: { n: number; total: number };
  syncState: 'synced' | 'pending' | 'error';
  state?: TxState;
  needsReview?: boolean;
  linked?: boolean;
}

export interface TransactionRowProps extends BaseProps {
  tx: RowTx;
  density?: 'comfortable' | 'compact';
  onPress?: () => void;
  onActions?: () => void;
}

const STATE_TEXT: Record<TxState, string> = {
  scheduled: uiText.stateScheduled,
  forecast: uiText.stateForecast,
  to_receive: uiText.stateToReceive,
  late: uiText.stateLate,
  cancelled: uiText.stateCancelled,
};

const KIND_PREFIX = {
  expense: uiText.expenseOf,
  income: uiText.incomeOf,
  saving: uiText.savingOf,
  transfer: uiText.transferOf,
} as const;

/** Rótulo completo da UX §5.19: "Despesa de −R$ 32,90, Padaria, Mercado, Nubank crédito, parcela 3 de 10, hoje 14:32, não sincronizado". */
export function rowLabel(tx: RowTx, hidden: boolean): string {
  const value = hidden
    ? HIDDEN_AMOUNT
    : `${tx.kind === 'expense' ? MINUS_SIGN : tx.kind === 'income' ? '+' : ''}${formatBRL(tx.amountCents)}`;
  return [
    `${KIND_PREFIX[tx.kind]} ${value}`,
    tx.description,
    tx.category.name,
    tx.method,
    tx.installment
      ? uiText.installmentOf
          .replace('{n}', String(tx.installment.n))
          .replace('{total}', String(tx.installment.total))
      : undefined,
    tx.when,
    tx.state ? STATE_TEXT[tx.state] : undefined,
    tx.needsReview ? uiText.needsReview : undefined,
    tx.linked ? uiText.linked : undefined,
    tx.syncState !== 'synced' ? uiText.syncError.toLowerCase() : undefined,
  ]
    .filter((p): p is string => typeof p === 'string' && p !== '')
    .join(', ');
}

/** UX §5.19: selos sempre com texto; cancelada fica riscada; ações com alternativa ao deslize (Ellipsis). */
export function TransactionRow({
  tx,
  density = 'comfortable',
  onPress,
  onActions,
  className,
  'data-testid': testId,
}: TransactionRowProps) {
  const hidden = useEnvironment().values === 'hidden';
  const Glyph = tx.category.icon;
  const meta = [
    tx.method,
    tx.installment ? `${tx.installment.n}/${tx.installment.total}` : '',
    tx.when,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className={cx('tx-row', className)}
      data-density={density}
      data-state={tx.state}
      data-testid={testId}
    >
      <button type="button" className="tx-main" aria-label={rowLabel(tx, hidden)} onClick={onPress}>
        <span className="tx-icon" data-band={tx.category.band} aria-hidden="true">
          <Glyph size={20} />
        </span>
        <span className="tx-text" aria-hidden="true">
          <span className="tx-title">{tx.description || tx.category.name}</span>
          <span className="tx-meta">{meta}</span>
          <span className="tx-seals">
            {tx.state && (
              <span className="tx-seal" data-seal={tx.state}>
                {STATE_TEXT[tx.state]}
              </span>
            )}
            {tx.needsReview && (
              <span className="tx-seal" data-seal="review">
                {uiText.needsReview}
              </span>
            )}
            {tx.linked && (
              <span className="tx-seal">
                <Link size={12} />
                {uiText.linked}
              </span>
            )}
            {tx.syncState !== 'synced' && (
              <span className="tx-seal" data-seal="sync">
                <CloudUpload size={12} />
                {uiText.syncError}
              </span>
            )}
          </span>
        </span>
        <span aria-hidden="true" className="tx-amount" data-cancelled={tx.state === 'cancelled'}>
          <MoneyText value={tx.amountCents} kind={tx.kind} />
        </span>
      </button>
      {onActions && (
        <button type="button" className="icon-btn" aria-label={uiText.actions} onClick={onActions}>
          <Ellipsis size={24} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
