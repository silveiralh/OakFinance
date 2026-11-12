// I06 — Regras (US-29, RN-59, RN-60): lista por último uso com termo, categoria, conta, origem, acertos e último uso;
// editar o termo mostra "Casaria com {n} lançamentos dos últimos 90 dias"; criar regra manual; apagar sem mexer nos
// lançamentos já categorizados.
import {
  addDays,
  type CategoryRule,
  type ISODate,
  normalizeDescription,
  ruleMatches,
  todayIn,
} from '@oakfinance/domain';
import { ChevronRight, Plus, WandSparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { newId } from '../../data/ids';
import { useLive } from '../../data/live';
import { txFromRow } from '../../data/mappers';
import { deleteRow, saveRow } from '../../data/repositories/rows';
import { emptyStates, type MessageKey, t, tn } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { BottomSheet, Button, EmptyState, GlassCard, Select, TextField, useToast } from '../../ui';
import { ruleFromRow } from '../quick-entry/model';
import { ruleToRow } from './learn';

type RuleRow = LocalRow<'category_rules'>;

const SOURCE: Readonly<Record<string, MessageKey>> = {
  default: 'rules.source.default',
  learned: 'rules.source.learned',
  manual: 'rules.source.manual',
};

/** Por último uso (mais recente primeiro; sem uso no fim, por termo). */
export function sortRules(rows: readonly RuleRow[]): RuleRow[] {
  return rows
    .filter((r) => r.deleted_at === null)
    .sort((a, b) => {
      const x = a.last_hit_at ?? '';
      const y = b.last_hit_at ?? '';
      return x === y ? a.pattern.localeCompare(b.pattern, 'pt-BR') : x < y ? 1 : -1;
    });
}

/** Lançamentos dos últimos 90 dias que a regra com este termo pegaria. */
export function wouldMatch(
  rule: CategoryRule,
  txRows: readonly LocalRow<'transactions'>[],
  today: ISODate,
): LocalRow<'transactions'>[] {
  const from = addDays(today, -90);
  return txRows.filter((row) => {
    if (row.deleted_at !== null || row.occurred_on < from || row.occurred_on > today) {
      return false;
    }
    let tx: ReturnType<typeof txFromRow>;
    try {
      tx = txFromRow(row);
    } catch {
      return false;
    }
    const description = row.description_raw ?? row.description;
    return ruleMatches(
      { ...rule, enabled: true },
      {
        description,
        merchantCnpj: row.merchant_cnpj,
        paymentMethod: tx.paymentMethod,
        kind: tx.kind,
        accountId: row.account_id,
        cardId: row.card_id,
      },
      normalizeDescription(description ?? ''),
    );
  });
}

interface Draft {
  id: string | null;
  pattern: string;
  categoryId: string;
}

export function RulesScreen({
  today = todayIn('America/Sao_Paulo', new Date()),
}: {
  today?: ISODate;
}) {
  const { user } = useAuth();
  const showToast = useToast();
  const data = useLive(
    user
      ? async () => ({
          rules: await user.db.category_rules.toArray(),
          categories: await user.db.categories.toArray(),
          accounts: [...(await user.db.accounts.toArray()), ...(await user.db.cards.toArray())],
          transactions: await user.db.transactions.toArray(),
        })
      : null,
    [user],
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editing = draft?.id ? data?.rules.find((r) => r.id === draft.id) : undefined;
  const preview = useMemo(() => {
    if (!draft || !data || normalizeDescription(draft.pattern).length < 4) {
      return null;
    }
    const base = editing ? ruleFromRow(editing) : null;
    const rule: CategoryRule = {
      ...(base ?? {
        id: 'previa',
        matchField: 'description',
        matchType: 'token_prefix',
        accountId: null,
        cardId: null,
        paymentMethod: null,
        source: 'manual',
        priority: 0,
        hits: 0,
        lastHitAt: null,
        enabled: true,
      }),
      pattern: normalizeDescription(draft.pattern),
      categoryId: draft.categoryId,
    };
    return wouldMatch(rule, data.transactions, today);
  }, [draft, data, editing, today]);

  if (!user || !data) {
    return <section className="screen" data-screen="I06" data-testid="screen-I06" />;
  }
  const rows = sortRules(data.rules);
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));
  const options = data.categories
    .filter(
      (c) =>
        c.deleted_at === null && c.archived_at === null && !c.is_system && c.kind !== 'transfer',
    )
    .map((c) => ({ value: c.id, label: c.name }));

  const save = async () => {
    if (!draft) {
      return;
    }
    const pattern = normalizeDescription(draft.pattern);
    if (pattern.length < 4) {
      setError(t('rules.patternShort'));
      return;
    }
    const nowIso = new Date().toISOString();
    const base = editing ? ruleFromRow(editing) : null;
    const rule: CategoryRule = {
      ...(base ?? {
        id: newId(),
        matchField: 'description',
        matchType: 'token_prefix',
        accountId: null,
        cardId: null,
        paymentMethod: null,
        source: 'manual',
        priority: 0,
        hits: 0,
        lastHitAt: null,
        enabled: true,
      }),
      pattern,
      categoryId: draft.categoryId,
      // editar à mão torna a regra manual (a correção não a muda mais, RN-63)
      source: 'manual',
    };
    const result = await saveRow(
      user.db,
      'category_rules',
      ruleToRow(rule, editing, user.userId, nowIso),
    );
    if (result.ok) {
      user.engine.notifyWrite();
      setDraft(null);
      showToast({ message: t('rules.saved'), tone: 'success' });
    }
  };

  const remove = async () => {
    if (!editing) {
      return;
    }
    const result = await deleteRow(user.db, 'category_rules', editing.id);
    if (result.ok) {
      user.engine.notifyWrite();
      setDraft(null);
      showToast({ message: t('rules.deleted') });
    }
  };

  return (
    <section className="screen" data-screen="I06" data-testid="screen-I06">
      <div className="detail-actions">
        <Button
          iconStart={Plus}
          onClick={() => {
            setError(null);
            setDraft({ id: null, pattern: '', categoryId: options[0]?.value ?? '' });
          }}
        >
          {t('rules.new')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={WandSparkles}
          title={emptyStates.rules.title}
          description={emptyStates.rules.text}
        />
      ) : (
        <GlassCard level={1}>
          <ul className="cards-invoices" data-testid="rules-list">
            {rows.map((row) => (
              <li key={row.id}>
                {/* UXC-013: termo → categoria em destaque e a meta numa segunda linha, com seta para a edição */}
                <button
                  type="button"
                  className="cards-invoice rule-row"
                  onClick={() => {
                    setError(null);
                    setDraft({ id: row.id, pattern: row.pattern, categoryId: row.category_id });
                  }}
                >
                  <span className="rule-row-text">
                    <span className="rule-row-title">
                      {`${row.pattern} → ${categoryName.get(row.category_id) ?? ''}`}
                    </span>
                    <span className="rule-row-meta" data-testid="rule-meta">
                      {[
                        row.account_id ? accountName.get(row.account_id) : null,
                        row.card_id ? accountName.get(row.card_id) : null,
                        SOURCE[row.source] ? t(SOURCE[row.source] as MessageKey) : row.source,
                        row.hits > 0 ? tn('rules.hits', row.hits) : null,
                        row.last_hit_at
                          ? t('rules.lastHit', {
                              data: formatDateBR(row.last_hit_at.slice(0, 10) as ISODate),
                            })
                          : t('rules.never'),
                      ]
                        .filter(Boolean)
                        .map((part) => (
                          <span key={part}>{part}</span>
                        ))}
                    </span>
                  </span>
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
      <BottomSheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={editing ? t('rules.edit') : t('rules.new')}
        data-testid="rule-sheet"
      >
        {draft && (
          <div className="account-form">
            <TextField
              label={t('rules.pattern')}
              value={draft.pattern}
              onChange={(pattern) => setDraft({ ...draft, pattern })}
              {...(error ? { error } : {})}
            />
            <Select
              label={t('detail.field.category')}
              value={draft.categoryId}
              onChange={(categoryId) => setDraft({ ...draft, categoryId })}
              options={options}
            />
            {preview && (
              <div data-testid="rule-preview">
                <p className="detail-note" aria-live="polite">
                  {t('rules.preview', { n: preview.length })}
                </p>
                <ul className="cards-invoices">
                  {preview.slice(0, 10).map((row) => (
                    <li key={row.id} className="detail-note">
                      {`${formatDateBR(row.occurred_on as ISODate)} · ${row.description ?? ''}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button fullWidth onClick={() => void save()}>
              {t('categories.save')}
            </Button>
            {editing && (
              <Button variant="danger" fullWidth onClick={() => void remove()}>
                {t('rules.delete')}
              </Button>
            )}
          </div>
        )}
      </BottomSheet>
    </section>
  );
}
