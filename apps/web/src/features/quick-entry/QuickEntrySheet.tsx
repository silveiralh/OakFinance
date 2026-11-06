import { dayMonth, invoiceForPurchase, monthLabel, todayIn } from '@oakfinance/domain';
import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../../app/auth';
import { newId } from '../../data/ids';
import { useLive } from '../../data/live';
import { cardFromRow } from '../../data/mappers';
import { deleteRow, saveRow } from '../../data/repositories/rows';
import { writeLocal } from '../../data/storage';
import { t } from '../../i18n/pt-BR';
import { track } from '../../lib/telemetry';
import {
  AmountInput,
  BottomSheet,
  Button,
  CategoryChip,
  CategoryPicker,
  type ChipCategory,
  Dialog,
  PaymentMethodPicker,
  useToast,
} from '../../ui';
import { quickEntryElapsed, resetQuickEntryClock } from './clock';
import { categoryIcon } from './icons';
import {
  buildExpense,
  buildInvoice,
  buildMethods,
  expenseCategories,
  missingReason,
  suggestCategories,
} from './model';

export const LAST_METHOD_KEY = 'quick.lastMethod';

function chip(row: {
  id: string;
  name: string;
  icon: string | null;
  bucket: string;
}): ChipCategory {
  const band =
    (['needs', 'wants', 'savings', 'income'] as const).find((b) => b === row.bucket) ?? 'none';
  return { id: row.id, name: row.name, icon: categoryIcon(row.icon), band };
}

export interface QuickEntrySheetProps {
  onClose: () => void;
  today?: string;
}

/** Q01 em modo Despesa (UX §3 Q01, US-12, US-17): valor → categoria → Lançar, com o último meio usado. */
export function QuickEntrySheet({
  onClose,
  today = todayIn('America/Sao_Paulo', new Date()),
}: QuickEntrySheetProps) {
  const { user } = useAuth();
  const toast = useToast();
  const data = useLive(
    user
      ? async () => ({
          categories: await user.db.categories.toArray(),
          accounts: await user.db.accounts.toArray(),
          cards: await user.db.cards.toArray(),
          recent: await user.db.transactions.where('occurred_on').aboveOrEqual('0000').toArray(),
          lastMethod: (await user.db.kv.get(LAST_METHOD_KEY))?.value,
        })
      : null,
    [user],
  );
  const [amount, setAmount] = useState(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);
  const answer = useRef<((discard: boolean) => void) | null>(null);

  const methods = useMemo(() => buildMethods(data?.accounts ?? [], data?.cards ?? []), [data]);
  const suggestions = useMemo(
    () => suggestCategories(data?.categories ?? [], data?.recent ?? [], today),
    [data, today],
  );
  const allCategories = useMemo(() => expenseCategories(data?.categories ?? []).map(chip), [data]);
  const lastMethod = typeof data?.lastMethod === 'string' ? data.lastMethod : null;
  const method = methods.find((m) => m.id === (methodId ?? lastMethod)) ?? methods[0] ?? null;
  const card = method?.cardId ? data?.cards.find((c) => c.id === method.cardId) : undefined;
  const invoice = card ? invoiceForPurchase(cardFromRow(card), today) : null;
  const missing = missingReason(amount, categoryId);
  const pickedOutside = categoryId && !suggestions.some((c) => c.id === categoryId);
  const pickedChip = pickedOutside ? allCategories.find((c) => c.id === categoryId) : undefined;

  if (!user) {
    return null;
  }

  const submit = async () => {
    if (missing || !method || !categoryId) {
      return;
    }
    const nowIso = new Date().toISOString();
    if (invoice && card && !(await user.db.invoices.get(invoice.id))) {
      await saveRow(user.db, 'invoices', buildInvoice(invoice, user.userId, nowIso));
    }
    const row = buildExpense({
      id: newId(),
      userId: user.userId,
      amountCents: amount,
      categoryId,
      method,
      occurredOn: today,
      invoiceId: invoice?.id ?? null,
      nowIso,
    });
    const result = await saveRow(user.db, 'transactions', row);
    if (!result.ok) {
      return;
    }
    setSaved(true);
    await writeLocal(() => user.db.kv.put({ key: LAST_METHOD_KEY, value: method.id }));
    user.engine.notifyWrite();
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    const elapsed = quickEntryElapsed();
    void track(user.db, {
      code: 'lancamento_salvo',
      context: { ...(elapsed !== null && { duracao_ms: elapsed }), offline, origem: 'manual' },
    });
    resetQuickEntryClock();
    toast({
      message: offline ? t('toast.savedOffline') : t('toast.saved'),
      action: {
        label: t('toast.undo'),
        onPress: () => {
          void deleteRow(user.db, 'transactions', row.id).then(() => user.engine.notifyWrite());
        },
      },
    });
    onClose();
  };

  return (
    <BottomSheet
      open
      title={t('quick.title')}
      onClose={onClose}
      confirmClose={() =>
        amount === 0 || saved
          ? true
          : new Promise<boolean>((resolve) => {
              answer.current = resolve;
              setAsking(true);
            })
      }
      data-testid="quick-entry"
    >
      <div className="quick-entry">
        <AmountInput value={amount} onChange={setAmount} autoFocus />
        <div className="quick-chips" role="radiogroup" aria-label={t('quick.type.expense')}>
          {suggestions.map((c) => (
            <CategoryChip
              key={c.id}
              name="quick-category"
              category={chip(c)}
              selected={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
          {pickedChip && (
            <CategoryChip
              name="quick-category"
              category={pickedChip}
              selected
              onPress={() => setPickerOpen(true)}
            />
          )}
          <Button variant="ghost" size="sm" onClick={() => setPickerOpen(true)}>
            {t('quick.more')}
          </Button>
        </div>
        {method && (
          <PaymentMethodPicker
            methods={methods}
            value={method.id}
            onChange={setMethodId}
            {...(invoice
              ? {
                  invoiceHint: t('quick.invoiceHint', {
                    mês: monthLabel(invoice.referenceMonth),
                    data: dayMonth(invoice.dueDate),
                  }),
                }
              : {})}
          />
        )}
        <Button
          size="lg"
          fullWidth
          confirmed={saved}
          disabled={missing !== null}
          disabledReason={missing ?? ''}
          onClick={() => void submit()}
          data-testid="quick-submit"
        >
          {t('quick.cta')}
        </Button>
      </div>
      <CategoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={allCategories}
        value={categoryId}
        onChange={(id) => {
          setCategoryId(id);
          setPickerOpen(false);
        }}
      />
      <Dialog
        open={asking}
        title={t('quick.discard.title')}
        description=""
        confirmLabel={t('quick.discard.confirm')}
        cancelLabel={t('quick.discard.cancel')}
        tone="danger"
        onConfirm={() => {
          setAsking(false);
          answer.current?.(true);
        }}
        onCancel={() => {
          setAsking(false);
          answer.current?.(false);
        }}
      />
    </BottomSheet>
  );
}
