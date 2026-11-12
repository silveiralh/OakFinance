// ON07 — Cartões (UX §3 ON07, US-08, RN-09, RN-12): nome, dias de fechamento e vencimento (1–31), limite opcional
// e a regra do dia do fechamento (padrão: próxima fatura), com a prévia da fatura de uma compra feita hoje.
// "Adicionar outro cartão" acrescenta um formulário; "Não uso cartão de crédito" conclui o passo sem criar nada.
import { type ISODate, monthLabel } from '@oakfinance/domain';
import { Plus } from 'lucide-react';
import type { OakDb } from '../../data/db';
import { isActive } from '../../data/repositories/accounts';
import { createCard, draftCard, parseDay, previewInvoice } from '../../data/repositories/cards';
import { type MessageKey, t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { useToday } from '../../lib/useToday';
import { AmountInput, Button, Switch, TextField } from '../../ui';
import { OnbFrame, useOnbStep, useStepDraft } from './OnbFrame';

export interface CardForm {
  name: string;
  closing: string;
  due: string;
  limitCents: number;
  toNext: boolean;
}

export const EMPTY_CARD: CardForm = { name: '', closing: '', due: '', limitCents: 0, toNext: true };

/** Formulário pronto para criar: nome e os dois dias válidos. */
export function cardReady(form: CardForm): boolean {
  return form.name.trim() !== '' && parseDay(form.closing) !== null && parseDay(form.due) !== null;
}

/** Formulário em branco (o "Adicionar outro" sem preencher) não conta nem bloqueia. */
export function isBlank(form: CardForm): boolean {
  return form.name.trim() === '' && form.closing.trim() === '' && form.due.trim() === '';
}

/** "Compras de hoje vão para a fatura de dez/2026, que vence em 10/12/2026" (RN-12, mesmo texto da S03). */
export function previewText(
  closingDay: number,
  dueDay: number,
  toNext: boolean,
  today: ISODate,
): string {
  const invoice = previewInvoice(
    draftCard({ closingDay, dueDay, closingDayToNext: toNext }),
    today,
  );
  return t('cards.preview', {
    mês: monthLabel(invoice.referenceMonth),
    data: formatDateBR(invoice.dueDate),
  });
}

/** Conta que paga os cartões novos: a do Pix e débito escolhida no ON06, senão a primeira conta corrente ativa. */
export async function defaultPayer(db: OakDb): Promise<string | null> {
  const accounts = (await db.accounts.toArray()).filter(
    (a) => isActive(a) && a.type === 'checking',
  );
  const last = (await db.kv.get('quick.lastMethod'))?.value;
  const pix = typeof last === 'string' && last.startsWith('pix:') ? last.slice(4) : null;
  return accounts.find((a) => a.id === pix)?.id ?? accounts[0]?.id ?? null;
}

/** Sugestões de nome do ON07 (UXA-031). */
const CARD_SUGGESTIONS: readonly MessageKey[] = ['onb.accounts.nubank', 'onb.cards.ourocard'];

export function CardsStep({ today: fixedToday }: { today?: ISODate }) {
  const today = useToday(fixedToday);
  const { user, busy, advance } = useOnbStep('cards');
  const [forms, setForms] = useStepDraft<CardForm[]>('cards', [EMPTY_CARD]);
  const filled = forms.filter((f) => !isBlank(f));
  const valid = filled.length > 0 && filled.every(cardReady);

  const update = (i: number, change: Partial<CardForm>) =>
    setForms(forms.map((f, j) => (j === i ? { ...f, ...change } : f)));

  const save = async () => {
    if (!user || !valid) {
      return;
    }
    const payer = await defaultPayer(user.db);
    for (const form of filled) {
      await createCard(user.db, user.userId, {
        name: form.name,
        closingDay: parseDay(form.closing) as number,
        dueDay: parseDay(form.due) as number,
        closingDayToNext: form.toNext,
        limitCents: form.limitCents > 0 ? form.limitCents : null,
        paymentAccountId: payer ?? null,
      });
    }
    await advance('done');
  };

  return (
    <OnbFrame
      step="cards"
      title={t('onb.cards.title')}
      onSkip={() => void advance('skip')}
      primary={
        <Button
          fullWidth
          disabled={!valid || busy}
          onClick={() => void save()}
          data-testid="onb-continue"
        >
          {t('common.continue')}
        </Button>
      }
      // UXA-031: "Não uso cartão de crédito" como link, sem competir com o Continuar; o "Pular" fica (US-08)
      secondary={
        <Button
          variant="ghost"
          fullWidth
          disabled={busy}
          onClick={() => void advance('done')}
          data-testid="onb-cards-none"
        >
          {t('onb.cards.none')}
        </Button>
      }
    >
      {forms.map((form, i) => {
        const closingDay = parseDay(form.closing);
        const dueDay = parseDay(form.due);
        const closingError =
          form.closing !== '' && closingDay === null ? t('cards.invalidDay') : undefined;
        const dueError = form.due !== '' && dueDay === null ? t('cards.invalidDay') : undefined;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: os formulários só crescem no fim e não são reordenados
          <fieldset key={i} className="onb-line" data-testid={`onb-card-${i}`}>
            <legend className="sr-only">{t('cards.name')}</legend>
            <TextField
              label={t('cards.name')}
              value={form.name}
              onChange={(name) => update(i, { name })}
              data-testid={`onb-card-${i}-name`}
            />
            {/* UXA-031: sugestões em chips, sem placeholder que pareça valor já escrito */}
            {form.name === '' && (
              // fieldset sem flex (WebKit, ver HANDOFF): o layout fica no div de dentro
              <fieldset className="onb-group">
                <legend className="sr-only">{t('onb.cards.suggestions')}</legend>
                <div className="onb-chips">
                  {CARD_SUGGESTIONS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="chip onb-chip"
                      onClick={() => update(i, { name: t(key) })}
                      data-testid={`onb-card-${i}-suggest`}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <TextField
              label={t('cards.closing')}
              value={form.closing}
              onChange={(closing) => update(i, { closing })}
              inputMode="numeric"
              {...(closingError ? { error: closingError } : {})}
              data-testid={`onb-card-${i}-closing`}
            />
            {closingDay === 31 && <p className="account-meta">{t('cards.day31')}</p>}
            <TextField
              label={t('cards.due')}
              value={form.due}
              onChange={(due) => update(i, { due })}
              inputMode="numeric"
              {...(dueError ? { error: dueError } : {})}
              data-testid={`onb-card-${i}-due`}
            />
            {closingDay !== null && dueDay !== null && closingDay === dueDay && (
              <p className="account-meta" role="status">
                {t('cards.sameDay')}
              </p>
            )}
            <AmountInput
              size="compact"
              label={t('onb.cards.limit')}
              value={form.limitCents}
              onChange={(limitCents) => update(i, { limitCents })}
              keypad="native"
              data-testid={`onb-card-${i}-limit`}
            />
            <Switch
              label={t('cards.rule')}
              description={t('cards.ruleHint')}
              checked={form.toNext}
              onChange={(toNext) => update(i, { toNext })}
            />
            {closingDay !== null && dueDay !== null && (
              <p className="account-meta" role="status" data-testid={`onb-card-${i}-preview`}>
                {previewText(closingDay, dueDay, form.toNext, today)}
              </p>
            )}
          </fieldset>
        );
      })}
      <Button
        variant="ghost"
        iconStart={Plus}
        onClick={() => setForms([...forms, EMPTY_CARD])}
        data-testid="onb-card-add"
      >
        {t('onb.cards.addAnother')}
      </Button>
    </OnbFrame>
  );
}
