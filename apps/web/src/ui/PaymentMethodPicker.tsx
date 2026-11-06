import {
  Banknote,
  ChevronDown,
  CreditCard,
  Diamond,
  Landmark,
  ShoppingCart,
  Utensils,
} from 'lucide-react';
import { useId, useState } from 'react';
import { uiText } from '../i18n/pt-BR';
import { BottomSheet } from './BottomSheet';
import { type AppIcon, type BaseProps, cx } from './types';

export type MethodKind = 'pix' | 'debit' | 'credit' | 'cash' | 'vr' | 'va' | 'account';

export interface PaymentMethodOption {
  id: string;
  kind: MethodKind;
  label: string;
  accountId: string | null;
  cardId?: string | null;
  /** Ex.: "fatura fecha dia 3". */
  detail?: string;
}

export const METHOD_ICON: Readonly<Record<MethodKind, AppIcon>> = {
  pix: Diamond,
  debit: CreditCard,
  credit: CreditCard,
  cash: Banknote,
  vr: Utensils,
  va: ShoppingCart,
  account: Landmark,
};

export interface PaymentMethodPickerProps extends BaseProps {
  methods: readonly PaymentMethodOption[];
  value: string;
  onChange: (id: string) => void;
  variant?: 'compact' | 'list';
  invoiceHint?: string;
  label?: string;
}

function MethodList({
  methods,
  value,
  onPick,
  label,
}: {
  methods: readonly PaymentMethodOption[];
  value: string;
  onPick: (id: string) => void;
  label: string;
}) {
  const name = useId();
  return (
    <fieldset className="method-list">
      <legend className="sr-only">{label}</legend>
      {methods.map((m) => {
        const Glyph = METHOD_ICON[m.kind];
        return (
          <label key={m.id} className="method-row" data-selected={m.id === value}>
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={m.id}
              checked={m.id === value}
              onChange={() => onPick(m.id)}
            />
            <span className="method-icon" aria-hidden="true">
              <Glyph size={24} strokeWidth={m.id === value ? 2.5 : 2} />
              {m.kind === 'debit' && <span className="method-seal">D</span>}
            </span>
            <span className="method-text">
              <span>{m.label}</span>
              {m.detail && <span className="field-hint">{m.detail}</span>}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** UX §5.11: chip compacto que abre a lista em sheet, ou a lista direto; dica da fatura no crédito. */
export function PaymentMethodPicker({
  methods,
  value,
  onChange,
  variant = 'compact',
  invoiceHint,
  label = uiText.paymentMethod,
  className,
  'data-testid': testId,
}: PaymentMethodPickerProps) {
  const [open, setOpen] = useState(false);
  const current = methods.find((m) => m.id === value);
  const hint =
    current?.kind === 'credit' && invoiceHint ? <p className="field-hint">{invoiceHint}</p> : null;
  if (variant === 'list') {
    return (
      <div className={cx(className)} data-testid={testId}>
        <MethodList methods={methods} value={value} onPick={onChange} label={label} />
        {hint}
      </div>
    );
  }
  const Glyph = current ? METHOD_ICON[current.kind] : CreditCard;
  return (
    <div className={cx(className)} data-testid={testId}>
      <button
        type="button"
        className="chip glass"
        data-level="1"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Glyph size={20} aria-hidden="true" />
        <span>
          <span className="sr-only">{`${label}: `}</span>
          {current?.label ?? label}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {hint}
      <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
        <MethodList
          methods={methods}
          value={value}
          label={label}
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
        />
      </BottomSheet>
    </div>
  );
}
