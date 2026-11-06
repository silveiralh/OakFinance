// Registrar pagamento da fatura (US-19, RN-14..RN-16, UX §3 C02): valor, conta de origem e fatura; grava a
// transferência para o cartão e confirma com "Pagamento da fatura de {mês} registrado.".
import { formatBRL, type ISODate, monthLabel } from '@oakfinance/domain';
import { useEffect, useState } from 'react';
import type { UserSession } from '../../app/auth';
import { maskMoney } from '../../app/values';
import type { LocalRow } from '../../data/db';
import { newId } from '../../data/ids';
import { saveRow } from '../../data/repositories/rows';
import { t } from '../../i18n/pt-BR';
import { AmountInput, BottomSheet, Button, Select, useToast } from '../../ui';
import { buildInvoice } from '../quick-entry/model';
import { buildPayment, defaultPaymentTarget, type InvoiceView, payableInvoices } from './model';

export const PAYMENT_SLUG = 'pagamento-fatura';

export interface PaymentSheetProps {
  open: boolean;
  onClose: () => void;
  user: UserSession;
  card: LocalRow<'cards'>;
  accounts: readonly LocalRow<'accounts'>[];
  categories: readonly LocalRow<'categories'>[];
  invoices: readonly LocalRow<'invoices'>[];
  /** Faturas do cartão já calculadas (anteriores, atual e a da tela). */
  views: readonly InvoiceView[];
  today: ISODate;
  hidden: boolean;
}

export function PaymentSheet({
  open,
  onClose,
  user,
  card,
  accounts,
  categories,
  invoices,
  views,
  today,
  hidden,
}: PaymentSheetProps) {
  const showToast = useToast();
  const payable = payableInvoices(views);
  const fallback = defaultPaymentTarget(views);
  const active = accounts.filter((a) => a.deleted_at === null && a.archived_at === null);
  const [invoiceId, setInvoiceId] = useState(fallback?.period.id ?? '');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState(0);
  const target = payable.find((v) => v.period.id === invoiceId) ?? fallback;

  // ao abrir: fatura padrão da RN-16, saldo restante e a conta que paga o cartão
  // biome-ignore lint/correctness/useExhaustiveDependencies: só ao abrir a folha
  useEffect(() => {
    if (!open) {
      return;
    }
    setInvoiceId(fallback?.period.id ?? '');
    setAmount(fallback?.remainingCents ?? 0);
    const payer = active.find((a) => a.id === card.payment_account_id) ?? active[0];
    setAccountId(payer?.id ?? '');
  }, [open]);

  const save = async () => {
    if (!target || !accountId || amount <= 0) {
      return;
    }
    const nowIso = new Date().toISOString();
    if (!invoices.some((i) => i.id === target.period.id && i.deleted_at === null)) {
      await saveRow(user.db, 'invoices', buildInvoice(target.period, user.userId, nowIso));
    }
    const mes = monthLabel(target.period.referenceMonth);
    const category =
      categories.find((c) => c.slug === PAYMENT_SLUG && c.deleted_at === null)?.id ?? null;
    const result = await saveRow(
      user.db,
      'transactions',
      buildPayment({
        id: newId(),
        userId: user.userId,
        cardId: card.id,
        accountId,
        invoice: target.period,
        amountCents: amount,
        today,
        nowIso,
        categoryId: category,
        description: t('pay.description', { mês: mes }),
      }),
    );
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    onClose();
    showToast({ message: t('card.paid.toast', { mês: mes }), tone: 'success' });
  };

  const missing = !target ? null : amount <= 0 ? t('pay.missingAmount') : null;
  return (
    <BottomSheet open={open} onClose={onClose} title={t('card.pay.cta')} data-testid="pay-sheet">
      {active.length === 0 ? (
        <p className="detail-note">{t('pay.noAccount')}</p>
      ) : (
        <div className="account-form">
          <AmountInput label={t('pay.amount')} value={amount} onChange={setAmount} />
          <Select
            label={t('pay.from')}
            value={accountId}
            onChange={setAccountId}
            options={active.map((a) => ({ value: a.id, label: a.name }))}
          />
          <Select
            label={t('pay.invoice')}
            value={target?.period.id ?? ''}
            onChange={(id) => {
              setInvoiceId(id);
              const next = payable.find((v) => v.period.id === id);
              if (next) {
                setAmount(next.remainingCents);
              }
            }}
            options={payable.map((v) => ({
              value: v.period.id,
              label: t('pay.invoiceOption', {
                mês: monthLabel(v.period.referenceMonth),
                valor: maskMoney(formatBRL(v.remainingCents), hidden),
              }),
            }))}
          />
          {target && amount > target.remainingCents && (
            <p className="detail-note" data-testid="pay-over">
              {t('pay.over')}
            </p>
          )}
          <Button
            fullWidth
            onClick={() => void save()}
            disabled={missing !== null || !target}
            {...(missing ? { disabledReason: missing } : {})}
          >
            {t('card.pay.cta')}
          </Button>
        </div>
      )}
    </BottomSheet>
  );
}
