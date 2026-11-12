import {
  dayMonth,
  invoiceForPurchase,
  MAX_TX_CENTS,
  monthLabel,
  todayIn,
  type YearMonth,
} from '@oakfinance/domain';
import { ChevronDown, QrCode, ReceiptText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { clearDraft, loadDraft, saveDraft } from '../../data/drafts';
import { newId } from '../../data/ids';
import { useLive } from '../../data/live';
import { cardFromRow } from '../../data/mappers';
import { deleteSeries } from '../../data/repositories/cascade';
import { deleteRow, saveRow } from '../../data/repositories/rows';
import { writeLocal } from '../../data/storage';
import { t, uiText } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { track, trackUsage } from '../../lib/telemetry';
import {
  AmountInput,
  appendDigits,
  Badge,
  BottomSheet,
  Button,
  CategoryChip,
  CategoryPicker,
  type ChipCategory,
  DateChip,
  Dialog,
  InstallmentStepper,
  NumericKeypad,
  PaymentMethodPicker,
  preferredKeypad,
  SegmentedControl,
  Select,
  Switch,
  TextField,
  useToast,
} from '../../ui';
import { isMonthClosed, monthTitle, reopenMonth } from '../budget/closing';
import type { NfceDraft } from '../nfce/model';
import {
  buildFixedExpense,
  buildFixedIncome,
  confirmOccurrence,
  recurrenceFromRow,
} from '../recurrences/model';
import { quickEntryElapsed, resetQuickEntryClock } from './clock';
import { categoryIcon } from './icons';
import {
  type InstallmentMode,
  installmentProblem,
  installmentRows,
  saveInstallmentPurchase,
} from './installments';
import {
  buildExpense,
  buildInvoice,
  buildMethods,
  DRAFT_KEY,
  expenseCategories,
  incomeCategories,
  isFarDate,
  missingReason,
  type QuickKind,
  statusFor,
  suggestCategories,
  suggestFromDescription,
  transferAccounts,
  transferMissing,
  usableDraft,
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
  /** Modo inicial (`?novo=despesa|receita`). */
  mode?: QuickKind;
  /** Edição de um lançamento existente (`?editar=<id>`, US-13). */
  editId?: string | null;
  /** I04 (T-089): Q01 pré-preenchido pela nota, com o selo "Dados da nota fiscal" (UX §3 Q01). */
  nfce?: QuickEntryNfce | null;
}

/** Dados da nota que pré-preenchem o Q01; o lançamento salvo fica ligado à nota (`source = 'nfce'`). */
export interface QuickEntryNfce {
  receiptId: string;
  issuerCnpj: string | null;
  issuerName: string | null;
  draft: NfceDraft;
}

/**
 * Q01 (UX §3 Q01): Despesa ou Receita — valor → categoria → Lançar, com "Mais detalhes" (descrição que sugere a
 * categoria sem sobrescrever a escolhida, data com confirmação acima de 60 dias, observação) e edição.
 */
export function QuickEntrySheet({
  onClose,
  today = todayIn('America/Sao_Paulo', new Date()),
  mode: initialMode = 'expense',
  editId = null,
  nfce = null,
}: QuickEntrySheetProps) {
  const { user } = useAuth();
  const toast = useToast();
  const data = useLive(
    user
      ? async () => ({
          categories: await user.db.categories.toArray(),
          rules: await user.db.category_rules.toArray(),
          accounts: await user.db.accounts.toArray(),
          cards: await user.db.cards.toArray(),
          recent: await user.db.transactions.toArray(),
          lastMethod: (await user.db.kv.get(LAST_METHOD_KEY))?.value,
          editing: editId ? await user.db.transactions.get(editId) : undefined,
          closings: await user.db.month_closings.toArray(),
        })
      : null,
    [user, editId],
  );
  const navigate = useNavigate();
  // RN-104: lancamento_iniciado, uma vez por abertura do Q01 para um lançamento novo.
  useEffect(() => {
    if (user && editId === null) {
      void trackUsage(user.db, 'lancamento_iniciado', { origem: nfce ? 'nfce' : 'manual' });
    }
  }, [user, editId, nfce]);
  const [mode, setMode] = useState<QuickKind>(initialMode);
  const [amount, setAmount] = useState(nfce?.draft.amountCents ?? 0);
  // UXA-008: a folha abre com o foco no valor; UXA-003: o teclado próprio vai para o rodapé fixo, junto do Lançar
  const amountRef = useRef<HTMLInputElement>(null);
  const [keypad] = useState(preferredKeypad);
  // UX2A-008: com um campo de texto em foco (descrição, observação), o teclado numérico sai da frente
  const [typingText, setTypingText] = useState(false);
  // UX2A-001: com o teclado próprio, o valor fica no rodapé fixo, logo acima do teclado, sempre à vista
  const amountInFooter = keypad === 'custom';
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryByRule, setCategoryByRule] = useState(false);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [details, setDetails] = useState(nfce !== null);
  const [description, setDescription] = useState(nfce?.draft.description ?? '');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState<string>(nfce?.draft.occurredOn ?? today);
  const [received, setReceived] = useState<'yes' | 'no'>('yes');
  const [countBefore, setCountBefore] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [count, setCount] = useState(1);
  const [installMode, setInstallMode] = useState<InstallmentMode>('total');
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const draftChecked = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);
  const [confirmFar, setConfirmFar] = useState(false);
  const [confirmClosed, setConfirmClosed] = useState(false);
  const answer = useRef<((discard: boolean) => void) | null>(null);
  const loaded = useRef(false);

  // Edição: preenche o formulário uma vez com a linha existente
  const editing: LocalRow<'transactions'> | undefined = data?.editing;
  useEffect(() => {
    if (!editing || loaded.current) {
      return;
    }
    loaded.current = true;
    setMode(editing.kind === 'income' ? 'income' : 'expense');
    setAmount(editing.amount_cents);
    setCategoryId(editing.category_id);
    setDescription(editing.description ?? '');
    setNotes(editing.notes ?? '');
    setDate(editing.occurred_on);
    setReceived(editing.status === 'posted' ? 'yes' : 'no');
    setCountBefore(editing.count_before_received);
    const method = editing.card_id
      ? `credit:${editing.card_id}`
      : `${({ meal_voucher: 'vr', food_voucher: 'va' } as Record<string, string>)[editing.payment_method] ?? editing.payment_method}:${editing.account_id}`;
    setMethodId(method);
    if (editing.description || editing.notes || editing.occurred_on !== today) {
      setDetails(true);
    }
  }, [editing, today]);

  // G17: rascunho guardado por até 24 h; ao abrir de novo, é oferecido com "Descartar"
  useEffect(() => {
    if (!user || editId || nfce || draftChecked.current) {
      return;
    }
    draftChecked.current = true;
    void loadDraft(user.db, DRAFT_KEY).then((value) => {
      const draft = usableDraft(value, Date.now());
      // UX2A-002: o rascunho só volta no modo pedido (`?novo=receita` não abre a despesa guardada)
      if (!draft || draft.mode !== initialMode) {
        return;
      }
      setMode(draft.mode);
      setAmount(draft.amount);
      setCategoryId(draft.categoryId);
      setDescription(draft.description);
      setNotes(draft.notes);
      setDate(draft.date);
      toast({
        message: t('quick.draft.restored'),
        tone: 'info',
        action: {
          label: t('quick.draft.discard'),
          onPress: () => {
            void clearDraft(user.db, DRAFT_KEY);
            setAmount(0);
            setCategoryId(null);
            setDescription('');
            setNotes('');
            setDate(today);
          },
        },
      });
    });
  }, [user, editId, toast, today, nfce, initialMode]);

  useEffect(() => {
    if (!user || editId || saved || !draftChecked.current || amount === 0) {
      return;
    }
    void saveDraft(user.db, DRAFT_KEY, {
      savedAt: Date.now(),
      mode,
      amount,
      categoryId,
      description,
      notes,
      date,
    });
  }, [user, editId, saved, mode, amount, categoryId, description, notes, date]);

  const income = mode === 'income';
  const transfer = mode === 'transfer';
  const refund = mode === 'refund';
  const allMethods = useMemo(() => buildMethods(data?.accounts ?? [], data?.cards ?? []), [data]);
  const methods = income
    ? allMethods.filter((m) => m.kind !== 'credit')
    : refund
      ? allMethods.filter((m) => m.kind === 'credit')
      : allMethods;
  const transferable = transferAccounts(data?.accounts ?? []);
  const origin = fromId ?? transferable[0]?.id ?? null;
  const transferCategory =
    data?.categories.find((c) => c.slug === 'transferencia-entre-contas' && c.deleted_at === null)
      ?.id ?? null;
  const suggestions = useMemo(
    () =>
      mode === 'income'
        ? incomeCategories(data?.categories ?? []).slice(0, 5)
        : suggestCategories(data?.categories ?? [], data?.recent ?? [], today),
    [data, today, mode],
  );
  const pickerCategories = useMemo(
    () =>
      (income
        ? incomeCategories(data?.categories ?? [])
        : expenseCategories(data?.categories ?? [])
      ).map(chip),
    [data, income],
  );
  const lastMethod = typeof data?.lastMethod === 'string' ? data.lastMethod : null;
  const method = methods.find((m) => m.id === (methodId ?? lastMethod)) ?? methods[0] ?? null;
  const card = method?.cardId ? data?.cards.find((c) => c.id === method.cardId) : undefined;
  const invoice = card ? invoiceForPurchase(cardFromRow(card), date) : null;
  // US-20: parcelar só no crédito e só ao lançar uma despesa nova
  const parcelled = Boolean(card) && mode === 'expense' && !editing && count > 1;
  const missing = transfer
    ? transferMissing(amount, origin, toId)
    : (missingReason(amount, categoryId, method !== null) ??
      (parcelled && installmentProblem(amount, count, installMode)
        ? t('quick.missing.installments')
        : null));
  const pickedOutside = categoryId && !suggestions.some((c) => c.id === categoryId);
  const pickedChip = pickedOutside ? pickerCategories.find((c) => c.id === categoryId) : undefined;
  const status = statusFor(mode, date, today, received === 'yes');

  if (!user) {
    return null;
  }

  const changeMode = (next: QuickKind) => {
    setMode(next);
    setCategoryId(null);
    setCategoryByRule(false);
  };

  // RN-61: a descrição sugere a categoria só enquanto o usuário não escolheu uma
  const changeDescription = (text: string) => {
    setDescription(text);
    if (categoryId && !categoryByRule) {
      return;
    }
    const suggested = suggestFromDescription(text, mode, data?.rules ?? [], data?.categories ?? []);
    setCategoryId(suggested);
    setCategoryByRule(suggested !== null);
  };

  const pick = (id: string) => {
    setCategoryId(id);
    setCategoryByRule(false);
  };

  const save = async () => {
    if (transfer) {
      if (missing || !origin || !toId) {
        return;
      }
    } else if (missing || !method || !categoryId) {
      return;
    }
    const nowIso = new Date().toISOString();
    if (invoice && card && !(await user.db.invoices.get(invoice.id))) {
      await saveRow(user.db, 'invoices', buildInvoice(invoice, user.userId, nowIso));
    }
    const transferMethod = {
      id: `transfer:${origin}`,
      kind: 'account' as const,
      label: '',
      accountId: origin,
      paymentMethod: 'transfer' as const,
    };
    const fresh = buildExpense({
      id: editing?.id ?? newId(),
      userId: user.userId,
      amountCents: amount,
      categoryId: transfer ? (transferCategory ?? '') : (categoryId ?? ''),
      method: transfer ? transferMethod : (method ?? transferMethod),
      occurredOn: date,
      invoiceId: transfer ? null : (invoice?.id ?? null),
      counterpartAccountId: transfer ? toId : null,
      nowIso,
      kind: mode,
      status,
      description,
      notes,
      countBeforeReceived: income && received === 'no' && countBefore,
    });
    // na edição, mantém as colunas que o Q01 não mostra (origem, vínculos, série…)
    const row: LocalRow<'transactions'> = editing
      ? {
          ...editing,
          kind: fresh.kind,
          status: fresh.status,
          amount_cents: fresh.amount_cents,
          occurred_on: fresh.occurred_on,
          description: fresh.description,
          notes: fresh.notes,
          category_id: fresh.category_id,
          category_source: categoryByRule ? 'rule' : 'manual',
          payment_method: fresh.payment_method,
          account_id: fresh.account_id,
          card_id: fresh.card_id,
          invoice_id: fresh.invoice_id,
          count_before_received: fresh.count_before_received,
          counterpart_account_id: fresh.counterpart_account_id,
        }
      : {
          ...fresh,
          category_source: categoryByRule ? 'rule' : 'manual',
          ...(nfce && {
            source: 'nfce',
            nfce_receipt_id: nfce.receiptId,
            merchant_cnpj: nfce.issuerCnpj,
            merchant_name: nfce.issuerName,
          }),
        };
    // "Repetir todo mês" na receita (US-23): cria a receita fixa no dia da data; se já caiu, este lançamento é a
    // ocorrência dessa data (id v5); se não caiu, a ocorrência fica projetada e conta na Base (RN-32)
    if (
      repeat &&
      !parcelled &&
      !editing &&
      (income || mode === 'expense') &&
      (method?.accountId || card)
    ) {
      const name =
        description.trim() ||
        data?.categories.find((c) => c.id === categoryId)?.name ||
        t(income ? 'quick.type.income' : 'quick.type.expense');
      const day = Number(date.slice(8, 10));
      const rec = income
        ? buildFixedIncome({
            userId: user.userId,
            description: name,
            amountCents: amount,
            dayOfMonth: day,
            accountId: method?.accountId ?? '',
            categoryId,
            startOn: date,
            nowIso,
          })
        : buildFixedExpense({
            userId: user.userId,
            description: name,
            amountCents: amount,
            dayOfMonth: day,
            accountId: card ? null : (method?.accountId ?? null),
            cardId: card?.id ?? null,
            categoryId,
            variable: false,
            startOn: date,
            nowIso,
          });
      const recResult = await saveRow(user.db, 'recurrences', rec);
      if (!recResult.ok) {
        return;
      }
      const domainRec = recurrenceFromRow(rec);
      // receita: só se já caiu; despesa: se a data já chegou (a ocorrência futura fica projetada)
      if (domainRec && (income ? received === 'yes' : date <= today)) {
        await confirmOccurrence(user.db, user.userId, domainRec, date, amount);
      }
      setSaved(true);
      await clearDraft(user.db, DRAFT_KEY);
      user.engine.notifyWrite();
      resetQuickEntryClock();
      toast({ message: t(income ? 'fixed.saved' : 'fixed.expenseSaved') });
      onClose();
      return;
    }
    if (parcelled && card) {
      const seriesId = newId();
      const rows = installmentRows({
        seriesId,
        userId: user.userId,
        card,
        invoices: await user.db.invoices.where('card_id').equals(card.id).toArray(),
        base: row,
        amountCents: amount,
        count,
        mode: installMode,
        purchaseDate: date,
        nowIso,
      });
      const saved = await saveInstallmentPurchase(user.db, rows);
      if (!saved.ok) {
        return;
      }
      setSaved(true);
      await clearDraft(user.db, DRAFT_KEY);
      if (method) {
        await writeLocal(() => user.db.kv.put({ key: LAST_METHOD_KEY, value: method.id }));
      }
      user.engine.notifyWrite();
      const elapsed = quickEntryElapsed();
      void track(user.db, {
        code: 'usage.lancamento_salvo',
        context: {
          ...(elapsed !== null && { duracao_ms: elapsed }),
          offline: typeof navigator !== 'undefined' && !navigator.onLine,
          origem: nfce ? 'nfce' : 'manual',
        },
      });
      resetQuickEntryClock();
      toast({
        message: t('toast.saved'),
        action: {
          label: t('toast.undo'),
          onPress: () => {
            void deleteSeries(user.db, seriesId).then(() => user.engine.notifyWrite());
          },
        },
      });
      onClose();
      return;
    }
    const result = await saveRow(user.db, 'transactions', row);
    if (!result.ok) {
      return;
    }
    setSaved(true);
    await clearDraft(user.db, DRAFT_KEY);
    if (!transfer && !refund && method) {
      await writeLocal(() => user.db.kv.put({ key: LAST_METHOD_KEY, value: method.id }));
    }
    user.engine.notifyWrite();
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (!editing) {
      const elapsed = quickEntryElapsed();
      void track(user.db, {
        code: 'usage.lancamento_salvo',
        context: {
          ...(elapsed !== null && { duracao_ms: elapsed }),
          offline,
          origem: nfce ? 'nfce' : 'manual',
        },
      });
    }
    resetQuickEntryClock();
    toast(
      editing
        ? { message: t('toast.edited') }
        : {
            message: income
              ? t('toast.incomeSaved')
              : offline
                ? t('toast.savedOffline')
                : t('toast.saved'),
            action: {
              label: t('toast.undo'),
              onPress: () => {
                void deleteRow(user.db, 'transactions', row.id).then(() =>
                  user.engine.notifyWrite(),
                );
              },
            },
          },
    );
    onClose();
  };

  // RN-77/US-36: editar um lançamento de um mês já fechado pede confirmação e reabre o mês para revisão
  const closedMonth =
    editing && data && isMonthClosed(data.closings, editing.occurred_on.slice(0, 7) as YearMonth)
      ? (editing.occurred_on.slice(0, 7) as YearMonth)
      : null;
  const submit = (closedOk = false) => {
    if (closedMonth && !closedOk) {
      setConfirmClosed(true);
      return;
    }
    if (isFarDate(date, today)) {
      setConfirmFar(true);
      return;
    }
    void save();
  };

  const amountField = (
    <AmountInput
      value={amount}
      onChange={setAmount}
      autoFocus
      keypad={keypad}
      showKeypad={false}
      inputRef={amountRef}
    />
  );

  return (
    <BottomSheet
      open
      title={editing ? t('quick.edit.title') : t('quick.title')}
      onClose={onClose}
      initialFocus={() => amountRef.current}
      // UX2A-001: quase a tela toda, para o valor, as categorias e o Lançar caberem juntos a 360×640
      snapPoints={[0.96]}
      confirmClose={() =>
        amount === 0 || saved || editing
          ? true
          : new Promise<boolean>((resolve) => {
              answer.current = resolve;
              setAsking(true);
            })
      }
      data-testid="quick-entry"
    >
      <div className="quick-entry">
        {nfce && !editing && (
          <Badge
            tone="info"
            icon={ReceiptText}
            label={t('quick.fromNote')}
            data-testid="quick-from-note"
          />
        )}
        {/* UX2A-001: tipo e "Ler nota" na mesma linha, sem uma linha só para o botão */}
        {!editing && (mode === 'expense' || mode === 'income') && (
          <div className="quick-head">
            <SegmentedControl
              label={t('quick.title')}
              value={mode}
              onChange={changeMode}
              options={[
                { value: 'expense', label: t('quick.type.expense') },
                { value: 'income', label: t('quick.type.income') },
              ]}
            />
            {/* D-096 (T-126): "Ler nota" à vista no Q01, sem depender do toque longo no FAB */}
            {!nfce && mode === 'expense' && (
              <Button
                variant="ghost"
                size="sm"
                iconStart={QrCode}
                onClick={() => void navigate('/nota')}
                data-testid="quick-read-note"
              >
                <span className="quick-read-note-text">{t('quick.readNote')}</span>
              </Button>
            )}
          </div>
        )}
        {!amountInFooter && amountField}
        {(transfer || refund) && (
          <div className="quick-other">
            <p className="account-name">{transfer ? t('quick.transfer') : t('quick.refund')}</p>
            <Button variant="ghost" size="sm" onClick={() => changeMode('expense')}>
              {t('quick.type.expense')}
            </Button>
          </div>
        )}
        {transfer && (
          <>
            <Select
              label={t('quick.from')}
              value={origin ?? ''}
              onChange={(value) => {
                setFromId(value);
                if (value === toId) {
                  setToId(null);
                }
              }}
              options={transferable.map((a) => ({ value: a.id, label: a.name }))}
            />
            <Select
              label={t('quick.to')}
              value={toId ?? ''}
              onChange={(value) => setToId(value || null)}
              options={[
                { value: '', label: t('cards.noPayer') },
                ...transferable
                  .filter((a) => a.id !== origin)
                  .map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          </>
        )}
        {!transfer && (
          <div className="quick-chips" role="radiogroup" aria-label={uiText.category}>
            {suggestions.map((c) => (
              <CategoryChip
                key={c.id}
                name="quick-category"
                category={chip(c)}
                selected={categoryId === c.id}
                suggested={categoryId === c.id && categoryByRule}
                onPress={() => pick(c.id)}
              />
            ))}
            {pickedChip && (
              <CategoryChip
                name="quick-category"
                category={pickedChip}
                selected
                suggested={categoryByRule}
                onPress={() => setPickerOpen(true)}
              />
            )}
            {/* UXA-027: "Mais" com forma de chip */}
            <button
              type="button"
              className="chip glass quick-more"
              data-level="1"
              onClick={() => setPickerOpen(true)}
            >
              <span>{uiText.more}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        {!transfer && method && (
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
        {card && mode === 'expense' && !editing && (
          <InstallmentStepper
            value={count}
            onChange={setCount}
            amountCents={amount}
            mode={installMode}
            onModeChange={setInstallMode}
            {...(invoice ? { firstInvoiceLabel: monthLabel(invoice.referenceMonth) } : {})}
            data-testid="quick-installments"
          />
        )}
        {income && (
          <>
            <SegmentedControl
              label={t('quick.income.received')}
              value={received}
              onChange={setReceived}
              options={[
                { value: 'yes', label: t('quick.yes') },
                { value: 'no', label: t('quick.no') },
              ]}
            />
            {received === 'no' && (
              <Switch
                label={t('quick.income.countBefore')}
                checked={countBefore}
                onChange={setCountBefore}
              />
            )}
          </>
        )}
        {!details ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDetails(true)}
            data-testid="quick-details"
          >
            {t('quick.more')}
          </Button>
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: só observa o foco dos campos de dentro para tirar o teclado numérico da frente (UX2A-008); não é um controle
          <div
            className="quick-details"
            onFocus={(event) =>
              setTypingText(
                event.target instanceof HTMLInputElement && event.target.type !== 'checkbox',
              )
            }
            onBlur={() => setTypingText(false)}
          >
            <TextField
              label={t('quick.description')}
              value={description}
              onChange={changeDescription}
            />
            <DateChip label={t('quick.date')} value={date} onChange={setDate} today={today} />
            <TextField label={t('quick.notes')} value={notes} onChange={setNotes} />
            {!editing && (income || mode === 'expense') && count === 1 && (
              <Switch label={t('quick.repeat')} checked={repeat} onChange={setRepeat} />
            )}
            {!editing && mode === 'expense' && (
              <fieldset className="quick-other">
                <legend className="sr-only">{t('quick.otherType')}</legend>
                <Button variant="secondary" size="sm" onClick={() => changeMode('transfer')}>
                  {t('quick.transfer')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => changeMode('refund')}>
                  {t('quick.refund')}
                </Button>
              </fieldset>
            )}
          </div>
        )}
        {!income && status === 'pending' && (
          <p className="account-meta">{t('quick.scheduled', { data: formatDateBR(date) })}</p>
        )}
        {!transfer && method === null && (
          <Button
            variant="secondary"
            fullWidth
            onClick={() => void navigate('/ajustes/contas?adicionar=conta')}
            data-testid="quick-add-account"
          >
            {t('accounts.add')}
          </Button>
        )}
        <div className="quick-footer" data-testid="quick-footer">
          {amountInFooter && amountField}
          {keypad === 'custom' && !typingText && (
            <NumericKeypad
              onDigit={(d) => setAmount((v) => appendDigits(v, d, MAX_TX_CENTS))}
              onBackspace={() => setAmount((v) => Math.floor(v / 10))}
              onClear={() => setAmount(0)}
            />
          )}
          <Button
            size="lg"
            fullWidth
            confirmed={saved}
            disabled={missing !== null}
            disabledReason={missing ?? ''}
            onClick={() => submit()}
            data-testid="quick-submit"
          >
            {editing ? t('quick.edit.save') : t('quick.cta')}
          </Button>
        </div>
      </div>
      <CategoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={pickerCategories}
        value={categoryId}
        onChange={(id) => {
          pick(id);
          setPickerOpen(false);
        }}
      />
      <Dialog
        open={confirmClosed}
        title={closedMonth ? t('close.editClosed', { mes: monthTitle(closedMonth) }) : ''}
        description=""
        confirmLabel={t('close.saveAnyway')}
        onConfirm={() => {
          setConfirmClosed(false);
          if (closedMonth) {
            void reopenMonth(user.db, user.userId, closedMonth);
          }
          submit(true);
        }}
        onCancel={() => setConfirmClosed(false)}
        data-testid="closed-month-dialog"
      />
      <Dialog
        open={confirmFar}
        title={t('quick.farDate')}
        description={formatDateBR(date)}
        confirmLabel={t('quick.cta')}
        onConfirm={() => {
          setConfirmFar(false);
          void save();
        }}
        onCancel={() => setConfirmFar(false)}
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
          void clearDraft(user.db, DRAFT_KEY);
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
