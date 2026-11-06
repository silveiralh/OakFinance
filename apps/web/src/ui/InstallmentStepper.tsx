import { formatBRL, MAX_INSTALLMENTS } from '@oakfinance/domain';
import { useId, useState } from 'react';
import { t, uiText } from '../i18n/pt-BR';
import { SegmentedControl } from './SegmentedControl';
import { type BaseProps, cx } from './types';

export interface InstallmentStepperProps extends BaseProps {
  /** 1 = à vista. */
  value: number;
  onChange: (n: number) => void;
  max?: number;
  /** Total (modo 'total') ou valor da parcela (modo 'installment'), em centavos. */
  amountCents: number;
  mode: 'total' | 'installment';
  onModeChange: (mode: 'total' | 'installment') => void;
  /** Ex.: "dezembro". */
  firstInvoiceLabel?: string;
}

const QUICK = 12;

/** Valor de cada parcela exibido: modo parcela = o próprio valor; modo total = base da RN-21 (a 1ª leva o resto). */
export function installmentPreview(
  amountCents: number,
  n: number,
  mode: 'total' | 'installment',
): number {
  return mode === 'installment' ? amountCents : Math.floor(amountCents / n);
}

/**
 * UX §5.12 e RN-20: "À vista, 2x … 12x" e "Mais" para 13–48; no modo total, parcelas que deixariam menos de
 * 1 centavo por parcela ficam indisponíveis.
 */
export function InstallmentStepper({
  value,
  onChange,
  max = MAX_INSTALLMENTS,
  amountCents,
  mode,
  onModeChange,
  firstInvoiceLabel,
  className,
  'data-testid': testId,
}: InstallmentStepperProps) {
  const name = useId();
  const [expanded, setExpanded] = useState(value > QUICK);
  const limit = Math.min(max, MAX_INSTALLMENTS);
  const counts = Array.from({ length: expanded ? limit : Math.min(QUICK, limit) }, (_, i) => i + 1);
  const allowed = (n: number) =>
    n === 1 || mode === 'installment' || amountCents === 0 || amountCents >= n;
  return (
    <div className={cx('installments', className)} data-testid={testId}>
      <SegmentedControl
        label={uiText.installments}
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'total', label: uiText.total },
          { value: 'installment', label: uiText.installment },
        ]}
      />
      <fieldset className="chip-row">
        <legend className="sr-only">{uiText.installments}</legend>
        {counts.map((n) => (
          <label
            key={n}
            className="chip glass"
            data-level="1"
            data-selected={n === value}
            data-disabled={!allowed(n)}
          >
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={n}
              checked={n === value}
              disabled={!allowed(n)}
              onChange={() => onChange(n)}
            />
            {n === 1 ? uiText.cashPayment : `${n}x`}
          </label>
        ))}
        {!expanded && limit > QUICK && (
          <button
            type="button"
            className="chip glass"
            data-level="1"
            aria-expanded={false}
            onClick={() => setExpanded(true)}
          >
            {uiText.more}
          </button>
        )}
      </fieldset>
      {value > 1 && amountCents > 0 && (
        <p className="field-hint" aria-live="polite">
          {t('quick.installments', {
            n: value,
            valor: formatBRL(installmentPreview(amountCents, value, mode)),
            mês: firstInvoiceLabel ?? '',
          })}
        </p>
      )}
    </div>
  );
}
