import { Check, Plus, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { uiText } from '../i18n/pt-BR';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { TextField } from './TextField';
import { type AppIcon, type BaseProps, cx } from './types';

export type CategoryBand = 'needs' | 'wants' | 'savings' | 'income' | 'none';

export interface ChipCategory {
  id: string;
  name: string;
  icon: AppIcon;
  band: CategoryBand;
}

export interface CategoryChipProps extends BaseProps {
  category: ChipCategory;
  selected: boolean;
  suggested?: boolean;
  size?: 'md' | 'lg';
  /** Nome do grupo de rádios (o mesmo para todos os chips do grupo). */
  name: string;
  onPress: () => void;
}

/**
 * UX §5.10: pílula de 48 px, rádio nativo; selecionado tem borda na cor da faixa, ícone `fill` e check (seleção não
 * depende só de cor); "sugerida" é lida pelo leitor de tela.
 */
export function CategoryChip({
  category,
  selected,
  suggested = false,
  size = 'md',
  name,
  onPress,
  className,
  'data-testid': testId,
}: CategoryChipProps) {
  const Glyph = category.icon;
  return (
    <label
      className={cx('chip glass', className)}
      data-level="1"
      data-size={size}
      data-band={category.band}
      data-selected={selected}
      data-testid={testId}
    >
      <input
        className="sr-only"
        type="radio"
        name={name}
        value={category.id}
        checked={selected}
        onChange={onPress}
      />
      <Glyph size={20} strokeWidth={selected ? 2.5 : 2} aria-hidden="true" />
      <span>
        {category.name}
        {suggested && <span className="sr-only">{`, ${uiText.suggested}`}</span>}
      </span>
      {selected && <Check size={16} strokeWidth={2.5} aria-hidden="true" />}
    </label>
  );
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const BANDS: ReadonlyArray<{ band: CategoryBand; label: string }> = [
  { band: 'needs', label: uiText.bandNeeds },
  { band: 'wants', label: uiText.bandWants },
  { band: 'savings', label: uiText.bandSavings },
];

export interface CategoryPickerProps extends BaseProps {
  open: boolean;
  onClose: () => void;
  categories: readonly ChipCategory[];
  recentIds?: readonly string[];
  value: string | null;
  onChange: (id: string) => void;
  onCreate?: () => void;
  title?: string;
}

/** UX §5.10: sheet com busca, recentes no topo, grupos por faixa e "Criar categoria" no fim. */
export function CategoryPicker({
  open,
  onClose,
  categories,
  recentIds = [],
  value,
  onChange,
  onCreate,
  title = uiText.category,
  'data-testid': testId,
}: CategoryPickerProps) {
  const [query, setQuery] = useState('');
  const name = useId();
  const visible = useMemo(() => {
    const q = fold(query.trim());
    return q === '' ? categories : categories.filter((c) => fold(c.name).includes(q));
  }, [categories, query]);
  const pick = (id: string) => {
    onChange(id);
    onClose();
  };
  const recents =
    query.trim() === '' ? recentIds.flatMap((id) => categories.filter((c) => c.id === id)) : [];
  const groups: Array<{ key: string; label: string; items: readonly ChipCategory[] }> = [
    ...(recents.length > 0 ? [{ key: 'recent', label: uiText.recent, items: recents }] : []),
    ...BANDS.map((b) => ({
      key: b.band,
      label: b.label,
      items: visible.filter((c) => c.band === b.band),
    })),
    {
      key: 'other',
      label: '',
      items: visible.filter((c) => !BANDS.some((b) => b.band === c.band)),
    },
  ].filter((g) => g.items.length > 0);
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <TextField
        label={uiText.search}
        type="search"
        value={query}
        onChange={setQuery}
        prefixIcon={Search}
        clearable
      />
      {groups.map((g) => (
        <fieldset key={g.key} className="chip-group">
          <legend className={g.label ? 'chip-group-title' : 'sr-only'}>{g.label || title}</legend>
          <div className="chip-grid">
            {g.items.map((c) => (
              <CategoryChip
                key={`${g.key}-${c.id}`}
                category={c}
                name={`${name}-${g.key}`}
                selected={c.id === value}
                onPress={() => pick(c.id)}
              />
            ))}
          </div>
        </fieldset>
      ))}
      {onCreate && (
        <Button variant="ghost" iconStart={Plus} onClick={onCreate}>
          {uiText.createCategory}
        </Button>
      )}
    </BottomSheet>
  );
}
