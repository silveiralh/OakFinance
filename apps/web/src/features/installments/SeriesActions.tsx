// Ações da T02 para parcela de compra parcelada (US-21, RN-24, RN-25): editar com escopo e regenerar a série, e
// excluir com "Cancelar parcelas restantes" / "Apagar a compra inteira" (dupla confirmação com fatura paga).
import { formatBRL, type ISODate, monthLabel } from '@oakfinance/domain';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { UserSession } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { t } from '../../i18n/pt-BR';
import {
  AmountInput,
  BottomSheet,
  Button,
  Dialog,
  SegmentedControl,
  Select,
  TextField,
  useToast,
} from '../../ui';
import { expenseCategories } from '../quick-entry/model';
import {
  cancelRemaining,
  deleteWholeSeries,
  editSeriesFields,
  type FieldScope,
  loadSeries,
  paidLosses,
  reshapeSeries,
  type SeriesData,
} from './series';

export interface SeriesActionsProps {
  user: UserSession;
  tx: LocalRow<'transactions'>;
  categories: readonly LocalRow<'categories'>[];
  today: ISODate;
}

interface Form {
  description: string;
  categoryId: string;
  notes: string;
  totalCents: number;
  count: string;
  scope: FieldScope;
}

export function SeriesActions({ user, tx, categories, today }: SeriesActionsProps) {
  const navigate = useNavigate();
  const showToast = useToast();
  const [data, setData] = useState<SeriesData | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [losses, setLosses] = useState<Array<{ month: string; amountCents: number }> | null>(null);

  const seriesId = tx.series_id ?? '';

  const openEdit = async () => {
    const loaded = await loadSeries(user.db, seriesId);
    if (!loaded) {
      return;
    }
    setData(loaded);
    setError(null);
    setForm({
      description: tx.description ?? '',
      categoryId: tx.category_id ?? '',
      notes: tx.notes ?? '',
      totalCents: loaded.plan.total_cents,
      count: String(loaded.plan.installments_count),
      scope: 'series',
    });
  };

  const save = async () => {
    if (!data || !form) {
      return;
    }
    const count = Number(form.count);
    const reshaped =
      form.totalCents !== data.plan.total_cents || count !== data.plan.installments_count;
    if (reshaped) {
      const result = await reshapeSeries(
        user.db,
        data,
        { totalCents: form.totalCents, count },
        today,
      );
      if (!result.ok) {
        setError(
          result.error.code === 'INSTALLMENTS_LOCKED'
            ? t('tx.delete.locked')
            : t('quick.missing.installments'),
        );
        return;
      }
    }
    const fresh = reshaped ? await loadSeries(user.db, seriesId) : data;
    if (fresh) {
      await editSeriesFields(
        user.db,
        fresh,
        tx.id,
        {
          description: form.description.trim() || null,
          categoryId: form.categoryId || null,
          notes: form.notes.trim() || null,
        },
        form.scope,
      );
    }
    user.engine.notifyWrite();
    setForm(null);
    showToast({ message: t('toast.edited'), tone: 'success' });
  };

  const openDelete = async () => {
    const loaded = await loadSeries(user.db, seriesId);
    if (loaded) {
      setData(loaded);
      setDeleting(true);
    }
  };

  const choose = async (value: string) => {
    setDeleting(false);
    if (!data) {
      return;
    }
    if (value === 'cancel') {
      const result = await cancelRemaining(user.db, data, today);
      if (result.ok) {
        user.engine.notifyWrite();
        showToast({ message: t('series.cancelled') });
      }
      return;
    }
    if (value === 'delete') {
      const paid = paidLosses(data, today);
      if (paid.length > 0) {
        setLosses(paid);
        return;
      }
      await removeAll();
    }
  };

  const removeAll = async () => {
    setLosses(null);
    const result = await deleteWholeSeries(user.db, seriesId);
    if (result.ok) {
      user.engine.notifyWrite();
      void navigate('/lancamentos');
      showToast({ message: t('series.deleted') });
    }
  };

  const options = expenseCategories(categories).map((c) => ({ value: c.id, label: c.name }));
  return (
    <>
      <Button variant="secondary" iconStart={Pencil} onClick={() => void openEdit()}>
        {t('list.edit')}
      </Button>
      <Button variant="danger" iconStart={Trash2} onClick={() => void openDelete()}>
        {t('list.delete')}
      </Button>
      <BottomSheet
        open={form !== null}
        onClose={() => setForm(null)}
        title={t('series.edit')}
        data-testid="series-sheet"
      >
        {form && (
          <div className="account-form">
            <TextField
              label={t('detail.field.description')}
              value={form.description}
              onChange={(description) => setForm({ ...form, description })}
            />
            <Select
              label={t('detail.field.category')}
              value={form.categoryId}
              onChange={(categoryId) => setForm({ ...form, categoryId })}
              options={options}
            />
            <TextField
              label={t('detail.field.notes')}
              value={form.notes}
              onChange={(notes) => setForm({ ...form, notes })}
            />
            <SegmentedControl
              label={t('series.scope')}
              value={form.scope}
              onChange={(scope) => setForm({ ...form, scope })}
              options={[
                { value: 'series', label: t('tx.scope.series') },
                { value: 'one', label: t('tx.scope.one') },
              ]}
            />
            <AmountInput
              size="compact"
              label={t('series.total')}
              value={form.totalCents}
              onChange={(totalCents) => setForm({ ...form, totalCents })}
            />
            <TextField
              label={t('series.count')}
              value={form.count}
              inputMode="numeric"
              onChange={(count) => setForm({ ...form, count })}
            />
            {error && (
              <p className="detail-note" role="alert">
                {error}
              </p>
            )}
            <Button fullWidth onClick={() => void save()}>
              {t('series.save')}
            </Button>
          </div>
        )}
      </BottomSheet>
      <Dialog
        open={deleting}
        title={t('tx.delete.installments', { n: data?.plan.installments_count ?? '' })}
        description=""
        options={[
          { value: 'cancel', label: t('tx.delete.cancelRemaining') },
          { value: 'delete', label: t('tx.delete.deleteAll'), tone: 'danger' },
          { value: 'back', label: t('tx.delete.back') },
        ]}
        onChoose={(value) => void choose(value)}
        onCancel={() => setDeleting(false)}
        data-testid="series-delete"
      />
      <Dialog
        open={losses !== null}
        title={t('tx.delete.deleteAll')}
        description={(losses ?? [])
          .map((l) =>
            t('tx.delete.paidWarning', {
              mês: monthLabel(l.month as never),
              valor: formatBRL(l.amountCents),
            }),
          )
          .join(' ')}
        confirmLabel={t('series.confirmDelete')}
        onConfirm={() => void removeAll()}
        onCancel={() => setLosses(null)}
        data-testid="series-paid-warning"
      />
    </>
  );
}
