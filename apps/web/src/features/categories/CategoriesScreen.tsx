// S04 — Categorias (US-27, RN-39..RN-42): lista por faixa, criar e editar (nome, ícone, faixa obrigatória), trocar
// faixa com aviso, arquivar, excluir pedindo destino quando há uso; categorias de sistema bloqueadas.
import { formatBRL } from '@oakfinance/domain';
import { ChevronRight, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { maskMoney, useValuesHidden } from '../../app/values';
import type { LocalRow } from '../../data/db';
import { useLive } from '../../data/live';
import { categoryLimit, setCategoryLimit } from '../../data/repositories/budgets';
import {
  BUCKETS,
  type Bucket,
  type CategoryNameProblem,
  categoryNameProblem,
  categoryUsage,
  createCategory,
  deleteCategory,
  isEditable,
  setArchived,
  updateCategory,
} from '../../data/repositories/categories';
import { iconText, type MessageKey, t, uiText } from '../../i18n/pt-BR';
import {
  AmountInput,
  BottomSheet,
  Button,
  Dialog,
  GlassCard,
  SegmentedControl,
  Select,
  TextField,
  useToast,
} from '../../ui';
import { CATEGORY_ICONS, categoryIcon } from '../quick-entry/icons';

type Category = LocalRow<'categories'>;

const BAND_LABEL: Record<Bucket, string> = {
  needs: uiText.bandNeeds,
  wants: uiText.bandWants,
  savings: uiText.bandSavings,
};

const NAME_ERROR: Record<CategoryNameProblem, MessageKey> = {
  required: 'categories.nameRequired',
  tooLong: 'categories.nameTooLong',
  duplicate: 'categories.duplicate',
};

/** Grupos da lista: as três faixas, receitas e as de sistema; arquivadas à parte. */
export function groupCategories(categories: readonly Category[]) {
  const alive = categories
    .filter((c) => c.deleted_at === null)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'pt-BR'));
  const active = alive.filter((c) => c.archived_at === null);
  return {
    bands: BUCKETS.map((bucket) => ({
      bucket,
      rows: active.filter((c) => !c.is_system && c.kind === 'expense' && c.bucket === bucket),
    })),
    income: active.filter((c) => !c.is_system && c.kind === 'income'),
    system: active.filter((c) => c.is_system),
    archived: alive.filter((c) => c.archived_at !== null && !c.is_system),
  };
}

interface Draft {
  id: string | null;
  name: string;
  icon: string | null;
  bucket: Bucket;
  kind: string;
  originalBucket: string | null;
  /** US-32: limite mensal em centavos (0 = sem limite). */
  limitCents: number;
}

export function CategoriesScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const categories = useLive(user ? () => user.db.categories.toArray() : null, [user]);
  const budgets = useLive(user ? () => user.db.budgets.toArray() : null, [user]);
  const limits = new Map(
    (budgets ?? []).flatMap((b) =>
      // o limite padrão (todos os meses), o mesmo que a folha de edição mostra
      b.scope === 'category' &&
      b.category_id &&
      b.month === null &&
      b.deleted_at === null &&
      (b.limit_cents ?? 0) > 0
        ? [[b.category_id, b.limit_cents ?? 0] as const]
        : [],
    ),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBand, setConfirmBand] = useState(false);
  const [removing, setRemoving] = useState<{ row: Category; usage: number } | null>(null);
  const [target, setTarget] = useState('');

  if (!user || !categories) {
    return <section className="screen" data-screen="S04" data-testid="screen-S04" />;
  }
  const groups = groupCategories(categories);

  const open = (row: Category | null) => {
    setError(null);
    setDraft(
      row
        ? {
            id: row.id,
            name: row.name,
            icon: row.icon,
            bucket: (BUCKETS as readonly string[]).includes(row.bucket)
              ? (row.bucket as Bucket)
              : 'needs',
            kind: row.kind,
            originalBucket: row.bucket,
            limitCents: categoryLimit(budgets ?? [], row.id)?.limit_cents ?? 0,
          }
        : {
            id: null,
            name: '',
            icon: null,
            bucket: 'needs',
            kind: 'expense',
            originalBucket: null,
            limitCents: 0,
          },
    );
  };

  const persist = async () => {
    if (!draft) {
      return;
    }
    const result = draft.id
      ? await updateCategory(user.db, draft.id, {
          name: draft.name,
          icon: draft.icon,
          ...(draft.kind === 'expense' ? { bucket: draft.bucket } : {}),
        })
      : await createCategory(user.db, user.userId, {
          name: draft.name,
          icon: draft.icon,
          bucket: draft.bucket,
        });
    if (!result.ok) {
      const problem = (result.error as { problem?: CategoryNameProblem }).problem;
      setError(problem ? t(NAME_ERROR[problem]) : t('categories.locked'));
      return;
    }
    const savedId = result.value?.id ?? draft.id;
    if (draft.kind === 'expense' && savedId) {
      await setCategoryLimit(user.db, user.userId, savedId, draft.limitCents);
    }
    user.engine.notifyWrite();
    setDraft(null);
    setConfirmBand(false);
    showToast({ message: t('categories.saved'), tone: 'success' });
  };

  const save = () => {
    if (!draft) {
      return;
    }
    const problem = categoryNameProblem(draft.name, categories, draft.id ?? undefined);
    if (problem) {
      setError(t(NAME_ERROR[problem]));
      return;
    }
    // RN-42: trocar a faixa de uma categoria existente avisa antes
    if (draft.id && draft.kind === 'expense' && draft.originalBucket !== draft.bucket) {
      setConfirmBand(true);
      return;
    }
    void persist();
  };

  const startRemove = async (row: Category) => {
    const usage = await categoryUsage(user.db, row.id);
    if (usage.total === 0) {
      const result = await deleteCategory(user.db, row.id, null);
      if (result.ok) {
        user.engine.notifyWrite();
        setDraft(null);
        showToast({ message: t('categories.deleted') });
      }
      return;
    }
    setDraft(null);
    setTarget('');
    setRemoving({ row, usage: usage.total });
  };

  const finishRemove = async () => {
    if (!removing || !target) {
      return;
    }
    const result = await deleteCategory(user.db, removing.row.id, target);
    if (!result.ok) {
      return;
    }
    user.engine.notifyWrite();
    setRemoving(null);
    showToast({ message: t('categories.deleted') });
  };

  const archive = async (row: Category, archived: boolean) => {
    const result = await setArchived(user.db, row.id, archived);
    if (result.ok) {
      user.engine.notifyWrite();
      setDraft(null);
    }
  };

  const targets = removing
    ? categories.filter(
        (c) =>
          c.id !== removing.row.id &&
          c.deleted_at === null &&
          c.archived_at === null &&
          !c.is_system &&
          c.kind === removing.row.kind,
      )
    : [];
  const editing = draft?.id ? categories.find((c) => c.id === draft.id) : undefined;

  return (
    <section className="screen" data-screen="S04" data-testid="screen-S04">
      <div className="detail-actions">
        <Button iconStart={Plus} onClick={() => open(null)}>
          {t('categories.new')}
        </Button>
        <Button variant="ghost" onClick={() => void navigate('/ajustes/regras')}>
          {t('categories.rules')}
        </Button>
      </div>
      {groups.bands.map(({ bucket, rows }) => (
        <CategoryGroup
          key={bucket}
          title={BAND_LABEL[bucket]}
          rows={rows}
          onPick={open}
          limits={limits}
          testId={`categories-${bucket}`}
        />
      ))}
      {groups.income.length > 0 && (
        <CategoryGroup
          title={t('categories.income')}
          rows={groups.income}
          onPick={open}
          limits={limits}
          testId="categories-income"
        />
      )}
      {groups.system.length > 0 && (
        <CategoryGroup
          title={t('categories.system')}
          rows={groups.system}
          testId="categories-system"
        />
      )}
      {groups.archived.length > 0 && (
        <CategoryGroup
          title={t('categories.archived')}
          rows={groups.archived}
          onPick={open}
          limits={limits}
          testId="categories-archived"
        />
      )}
      <BottomSheet
        open={draft !== null && !confirmBand}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('categories.edit') : t('categories.new')}
        data-testid="category-sheet"
      >
        {draft && (
          <div className="account-form">
            <TextField
              label={t('categories.name')}
              value={draft.name}
              onChange={(name) => setDraft({ ...draft, name })}
              {...(error ? { error } : {})}
            />
            <fieldset className="category-icons-field">
              <legend>{t('categories.icon')}</legend>
              <div className="category-icons">
                {Object.keys(CATEGORY_ICONS).map((name) => {
                  const Glyph = categoryIcon(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      className="category-icon"
                      aria-pressed={draft.icon === name}
                      aria-label={iconText[name] ?? name}
                      onClick={() => setDraft({ ...draft, icon: name })}
                    >
                      <Glyph size={20} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {draft.kind === 'expense' && (
              <SegmentedControl
                label={t('categories.band')}
                value={draft.bucket}
                onChange={(bucket) => setDraft({ ...draft, bucket: bucket as Bucket })}
                options={BUCKETS.map((b) => ({ value: b, label: BAND_LABEL[b] }))}
              />
            )}
            {draft.kind === 'expense' && (
              <AmountInput
                size="compact"
                label={t('categories.limit')}
                value={draft.limitCents}
                onChange={(limitCents) => setDraft({ ...draft, limitCents })}
                data-testid="category-limit"
              />
            )}
            <Button fullWidth onClick={save}>
              {t('categories.save')}
            </Button>
            {editing && (
              <div className="detail-actions">
                <Button
                  variant="secondary"
                  onClick={() => void archive(editing, editing.archived_at === null)}
                >
                  {editing.archived_at === null
                    ? t('categories.archive')
                    : t('categories.unarchive')}
                </Button>
                <Button variant="danger" onClick={() => void startRemove(editing)}>
                  {t('categories.delete')}
                </Button>
              </div>
            )}
          </div>
        )}
      </BottomSheet>
      <Dialog
        open={confirmBand}
        title={t('categories.bandConfirm')}
        description={t('categories.bandWarning')}
        confirmLabel={t('categories.bandConfirm')}
        onConfirm={() => void persist()}
        onCancel={() => setConfirmBand(false)}
        data-testid="band-dialog"
      />
      <BottomSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('categories.deleteTitle', { nome: removing?.row.name ?? '' })}
        data-testid="delete-sheet"
      >
        {removing && (
          <div className="account-form">
            <p className="detail-note">{t('categories.deleteUsage', { n: removing.usage })}</p>
            <Select
              label={t('categories.deleteTarget')}
              value={target}
              onChange={setTarget}
              options={[
                { value: '', label: '' },
                ...targets.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Button
              variant="danger"
              fullWidth
              disabled={!target}
              onClick={() => void finishRemove()}
            >
              {t('categories.deleteConfirm')}
            </Button>
          </div>
        )}
      </BottomSheet>
    </section>
  );
}

function CategoryGroup({
  title,
  rows,
  onPick,
  limits,
  testId,
}: {
  title: string;
  rows: readonly Category[];
  onPick?: (row: Category) => void;
  /** Limite mensal por categoria (UXC-019: aparece na linha). */
  limits?: ReadonlyMap<string, number>;
  testId: string;
}) {
  const hidden = useValuesHidden();
  return (
    <GlassCard level={1} title={title} headingLevel={2}>
      <ul className="cards-invoices" data-testid={testId}>
        {rows.map((row) => {
          const Glyph = categoryIcon(row.icon);
          const locked = !isEditable(row) || !onPick;
          return (
            <li key={row.id}>
              {locked ? (
                <span className="cards-invoice category-row">
                  <Glyph size={20} aria-hidden="true" />
                  <span className="cards-invoice-month">{row.name}</span>
                  <Lock size={16} aria-label={t('categories.locked')} />
                </span>
              ) : (
                // UXC-019: o limite (quando houver) e a seta dizem que a linha abre a edição
                <button
                  type="button"
                  className="cards-invoice category-row"
                  onClick={() => onPick(row)}
                >
                  <Glyph size={20} aria-hidden="true" />
                  <span className="cards-invoice-month">{row.name}</span>
                  {(limits?.get(row.id) ?? 0) > 0 ? (
                    <span className="category-limit">
                      {t('categories.limitShort', {
                        valor: maskMoney(formatBRL(limits?.get(row.id) ?? 0), hidden),
                      })}
                    </span>
                  ) : (
                    <span />
                  )}
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
