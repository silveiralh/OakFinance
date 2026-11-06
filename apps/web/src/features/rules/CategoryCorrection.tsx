// T02 — "Mudar categoria" com aprendizado (US-28): a correção cria a regra e o toast "Regra criada: '{termo}' →
// {categoria}" oferece Desfazer por 8 s; havendo parecidos, "Aplicar a mais N parecidos".
import { useState } from 'react';
import type { UserSession } from '../../app/auth';
import type { LocalRow } from '../../data/db';
import { t } from '../../i18n/pt-BR';
import { BottomSheet, Button, Select, useToast } from '../../ui';
import { applySimilar, type Correction, correctCategory, undoLearning } from './learn';

export interface CategoryCorrectionProps {
  user: UserSession;
  tx: LocalRow<'transactions'>;
  categories: readonly LocalRow<'categories'>[];
}

export function CategoryCorrection({ user, tx, categories }: CategoryCorrectionProps) {
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [learned, setLearned] = useState<Correction | null>(null);
  const kind = tx.kind === 'income' ? 'income' : 'expense';
  const options = categories
    .filter(
      (c) => c.kind === kind && !c.is_system && c.deleted_at === null && c.archived_at === null,
    )
    .map((c) => ({ value: c.id, label: c.name }));

  const save = async () => {
    setOpen(false);
    if (!choice || choice === tx.category_id) {
      return;
    }
    const correction = await correctCategory(user.db, user.userId, tx, choice);
    user.engine.notifyWrite();
    const name = categories.find((c) => c.id === choice)?.name ?? '';
    if (correction.rule) {
      setLearned(correction);
      showToast({
        message: t('toast.ruleLearned', { termo: correction.rule.pattern, categoria: name }),
        action: {
          label: t('toast.undo'),
          onPress: () => {
            setLearned(null);
            void undoLearning(user.db, correction).then(() => user.engine.notifyWrite());
          },
        },
      });
    } else {
      showToast({ message: t('toast.edited') });
    }
  };

  const apply = async () => {
    if (!learned?.rule) {
      return;
    }
    const n = await applySimilar(user.db, learned.rule, learned.similar);
    user.engine.notifyWrite();
    setLearned(null);
    showToast({ message: t('rules.applied', { n }) });
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setChoice(tx.category_id ?? options[0]?.value ?? '');
          setOpen(true);
        }}
      >
        {t('detail.changeCategory')}
      </Button>
      {learned && learned.similar.length > 0 && (
        <Button variant="ghost" onClick={() => void apply()} data-testid="apply-similar">
          {t('toast.applySimilar', { n: learned.similar.length })}
        </Button>
      )}
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('detail.changeCategory')}
        data-testid="category-correction"
      >
        <div className="account-form">
          <Select
            label={t('detail.field.category')}
            value={choice}
            onChange={setChoice}
            options={options}
          />
          <Button fullWidth onClick={() => void save()}>
            {t('categories.save')}
          </Button>
        </div>
      </BottomSheet>
    </>
  );
}
