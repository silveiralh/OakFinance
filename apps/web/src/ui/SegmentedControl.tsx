import { useId } from 'react';
import { type AppIcon, type BaseProps, cx } from './types';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: AppIcon;
}

export interface SegmentedControlProps<T extends string> extends BaseProps {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'md' | 'lg';
}

/**
 * UX §5.9: grupo de rádios nativos (papel `radiogroup`/`radio`); as setas trocam a opção pelo comportamento do
 * próprio navegador. O indicador em vidro acompanha a opção marcada.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
  'data-testid': testId,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={cx('segmented', className)} data-size={size} data-testid={testId}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => {
        const Glyph = o.icon;
        const checked = o.value === value;
        return (
          <label key={o.value} data-checked={checked}>
            <input
              className="sr-only"
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              onChange={() => onChange(o.value)}
            />
            {Glyph && <Glyph size={20} strokeWidth={checked ? 2.5 : 2} aria-hidden="true" />}
            {o.label}
          </label>
        );
      })}
    </fieldset>
  );
}
