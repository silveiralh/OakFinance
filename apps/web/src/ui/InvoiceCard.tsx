import { formatBRL, HIDDEN_AMOUNT, type InvoiceStatus } from '@oakfinance/domain';
import {
  CalendarBlank,
  CheckCircle,
  CircleHalf,
  Clock,
  Lock,
  LockOpen,
  WarningCircle,
} from '@phosphor-icons/react';
import { t, uiText } from '../i18n/pt-BR';
import { useEnvironment } from '../lib/useEnvironment';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { type BaseProps, cx, type PhosphorIcon } from './types';

export interface InvoiceCardData {
  card: {
    name: string;
    brandColor: 'aqua' | 'grass' | 'violet' | 'night' | 'coral' | 'graphite';
    last4?: string;
  };
  invoice: {
    month: string;
    totalCents: number;
    remainingCents: number;
    closesOn: string;
    dueOn: string;
    status: InvoiceStatus;
  };
  limitCents?: number;
  usedCents?: number;
}

export interface InvoiceCardProps extends BaseProps, InvoiceCardData {
  /** Dias até o vencimento (calculado pelo chamador com o "hoje" do fuso). */
  daysToDue?: number;
  onPress?: () => void;
}

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Selo da UX §5.18: sempre ícone + texto; "Vence em X dias" (≤ 3) e "Vencida" em tom de alerta. */
export function invoiceBadge(
  status: InvoiceStatus,
  daysToDue: number | undefined,
): {
  icon: PhosphorIcon;
  label: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
} {
  if (status === 'overdue') {
    return {
      icon: WarningCircle,
      label: t('card.status.overdue', { quando: '' }).trim(),
      tone: 'danger',
    };
  }
  if (
    (status === 'closed' || status === 'partial') &&
    daysToDue !== undefined &&
    daysToDue >= 0 &&
    daysToDue <= 3
  ) {
    return {
      icon: Clock,
      label: daysToDue === 0 ? t('card.status.dueToday') : t('card.status.dueIn', { n: daysToDue }),
      tone: 'warning',
    };
  }
  switch (status) {
    case 'open':
      return { icon: LockOpen, label: t('card.status.open'), tone: 'info' };
    case 'closed':
      return { icon: Lock, label: t('card.status.closed'), tone: 'neutral' };
    case 'partial':
      return { icon: CircleHalf, label: uiText.invoicePartial, tone: 'warning' };
    case 'paid':
      return { icon: CheckCircle, label: t('card.status.paid'), tone: 'success' };
    default:
      return { icon: CalendarBlank, label: uiText.invoiceFuture, tone: 'neutral' };
  }
}

/** UX §5.18: cartão em `--grad-card-*`, texto branco, selo de status e barra de limite. */
export function InvoiceCard({
  card,
  invoice,
  limitCents,
  usedCents,
  daysToDue,
  onPress,
  className,
  'data-testid': testId,
}: InvoiceCardProps) {
  const hidden = useEnvironment().values === 'hidden';
  const money = (c: number) => (hidden ? HIDDEN_AMOUNT : formatBRL(c));
  const badge = invoiceBadge(invoice.status, daysToDue);
  const body = (
    <>
      <div className="invoice-top">
        <span className="invoice-name">
          {card.name}
          {card.last4 ? ` ·· ${card.last4}` : ''}
        </span>
        <Badge tone={badge.tone} icon={badge.icon} label={badge.label} />
      </div>
      <span className="invoice-total money-text" data-money="">
        {money(invoice.status === 'partial' ? invoice.remainingCents : invoice.totalCents)}
      </span>
      {limitCents !== undefined && usedCents !== undefined && (
        <ProgressBar label={card.name} valueCents={usedCents} maxCents={limitCents} size="xs" />
      )}
      <span className="invoice-dates">{`${dm(invoice.closesOn)} · ${dm(invoice.dueOn)}`}</span>
    </>
  );
  return onPress ? (
    <button
      type="button"
      className={cx('invoice-card', className)}
      data-brand={card.brandColor}
      data-testid={testId}
      onClick={onPress}
    >
      {body}
    </button>
  ) : (
    <article
      className={cx('invoice-card', className)}
      data-brand={card.brandColor}
      data-testid={testId}
    >
      {body}
    </article>
  );
}

export interface InvoiceMiniProps extends BaseProps {
  cardName: string;
  dueLabel: string;
  amountCents: number;
}

/** InvoiceMini (H01): "Nubank · vence sex, 10/11 · R$ 1.240,30". */
export function InvoiceMini({
  cardName,
  dueLabel,
  amountCents,
  className,
  'data-testid': testId,
}: InvoiceMiniProps) {
  const hidden = useEnvironment().values === 'hidden';
  return (
    <span className={cx('invoice-mini', className)} data-testid={testId}>
      {`${cardName} · ${dueLabel} · ${hidden ? HIDDEN_AMOUNT : formatBRL(amountCents)}`}
    </span>
  );
}
