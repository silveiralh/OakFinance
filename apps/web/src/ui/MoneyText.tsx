import { formatBRL, HIDDEN_AMOUNT, MINUS_SIGN } from '@oakfinance/domain';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, PiggyBank } from 'lucide-react';
import { uiText } from '../i18n/pt-BR';
import { useEnvironment } from '../lib/useEnvironment';
import { type BaseProps, cx } from './types';

export type MoneyKind = 'neutral' | 'income' | 'expense' | 'saving' | 'transfer';

export interface MoneyTextProps extends BaseProps {
  /** Centavos inteiros. Em income/expense/saving/transfer é o valor absoluto; o sentido vem de `kind`. */
  value: number;
  kind?: MoneyKind;
  size?: 'hero' | 'display' | 'body' | 'label';
  showSign?: boolean;
  showIcon?: boolean;
  hideable?: boolean;
}

const ICON = {
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  saving: PiggyBank,
  transfer: ArrowLeftRight,
} as const;

const PREFIX: Record<Exclude<MoneyKind, 'neutral'>, string> = {
  income: uiText.incomeOf,
  expense: uiText.expenseOf,
  saving: uiText.savingOf,
  transfer: uiText.transferOf,
};

/** Texto exibido: "+R$ 10,00" (receita), "−R$ 10,00" (despesa, U+2212), "R$ ••••" quando oculto. */
export function moneyLabel(
  value: number,
  kind: MoneyKind,
  showSign: boolean,
  hidden: boolean,
): string {
  if (hidden) {
    return HIDDEN_AMOUNT;
  }
  if (kind === 'neutral') {
    return formatBRL(value);
  }
  const body = formatBRL(Math.abs(value));
  if (!showSign) {
    return body;
  }
  return kind === 'income' ? `+${body}` : kind === 'expense' ? `${MINUS_SIGN}${body}` : body;
}

/** UX §5.7 e RN-103: sinal + cor + ícone/rótulo (nunca só cor); obedece `data-values="hidden"`. */
export function MoneyText({
  value,
  kind = 'neutral',
  size = 'body',
  showSign = kind === 'income' || kind === 'expense',
  showIcon = false,
  hideable = true,
  className,
  'data-testid': testId,
}: MoneyTextProps) {
  const env = useEnvironment();
  const hidden = hideable && env.values === 'hidden';
  const text = moneyLabel(value, kind, showSign, hidden);
  const Glyph = kind === 'neutral' ? null : ICON[kind];
  return (
    <span
      className={cx('money-text', className)}
      data-kind={kind}
      data-size={size}
      data-money=""
      data-testid={testId}
    >
      {showIcon && Glyph && <Glyph size={size === 'hero' ? 32 : 20} aria-hidden="true" />}
      {kind !== 'neutral' && <span className="sr-only">{`${PREFIX[kind]} `}</span>}
      {hidden ? (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{uiText.hiddenValue}</span>
        </>
      ) : (
        <span>{text}</span>
      )}
    </span>
  );
}
