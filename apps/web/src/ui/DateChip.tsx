import { addDays } from '@oakfinance/domain';
import { useId } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type BaseProps, cx } from './types';

export interface DateChipProps extends BaseProps {
  /** 'YYYY-MM-DD' no fuso America/Sao_Paulo. */
  value: string;
  onChange: (date: string) => void;
  /** "Hoje" injetado (o componente não lê o relógio). */
  today: string;
  label?: string;
}

/** UX §5.13: atalhos Hoje e Ontem e o `<input type="date">` nativo em "Escolher". */
export function DateChip({
  value,
  onChange,
  today,
  label = uiText.date,
  className,
  'data-testid': testId,
}: DateChipProps) {
  const id = useId();
  const yesterday = addDays(today, -1);
  return (
    <fieldset className={cx('chip-row', className)} data-testid={testId}>
      <legend className="sr-only">{label}</legend>
      <button
        type="button"
        className="chip glass"
        data-level="1"
        aria-pressed={value === today}
        onClick={() => onChange(today)}
      >
        {uiText.today}
      </button>
      <button
        type="button"
        className="chip glass"
        data-level="1"
        aria-pressed={value === yesterday}
        onClick={() => onChange(yesterday)}
      >
        {uiText.yesterday}
      </button>
      <label className="chip glass" data-level="1" htmlFor={id}>
        <span>{uiText.pickDate}</span>
        <input
          id={id}
          className="date-native"
          type="date"
          value={value}
          onChange={(e) => {
            if (e.target.value !== '') {
              onChange(e.target.value);
            }
          }}
        />
      </label>
    </fieldset>
  );
}
