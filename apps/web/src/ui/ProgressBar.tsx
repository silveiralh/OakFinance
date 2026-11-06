import { type BaseProps, cx } from './types';

export interface ProgressBarProps extends BaseProps {
  valueCents: number;
  maxCents: number;
  tone?: 'band-needs' | 'band-wants' | 'band-savings' | 'info';
  size?: 'xs' | 'sm' | 'md';
  indeterminate?: boolean;
  label: string;
  /** Frações (0–1) com marcação. */
  ticks?: readonly number[];
  valueText?: string;
}

/** Percentual inteiro (piso) do valor sobre o máximo; 0 sem máximo. */
export function percentOf(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.floor((value * 100) / max)) : 0;
}

/** UX §5.16: `role="progressbar"`; excedente com hachura; indeterminada só enquanto carrega. */
export function ProgressBar({
  valueCents,
  maxCents,
  tone = 'info',
  size = 'sm',
  indeterminate = false,
  label,
  ticks = [],
  valueText,
  className,
  'data-testid': testId,
}: ProgressBarProps) {
  const pct = percentOf(valueCents, maxCents);
  const over = pct > 100;
  return (
    <div
      className={cx('progress', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : Math.min(pct, 100)}
      aria-valuetext={indeterminate ? undefined : (valueText ?? `${pct}%`)}
      aria-busy={indeterminate || undefined}
      data-tone={tone}
      data-size={size}
      data-over={over}
      data-indeterminate={indeterminate}
      data-testid={testId}
    >
      <span
        className="progress-fill"
        style={indeterminate ? undefined : { width: `${Math.min(pct, 100)}%` }}
      />
      {over && (
        <span className="progress-excess" style={{ width: `${Math.min(pct - 100, 100)}%` }} />
      )}
      {ticks.map((tick) => (
        <span
          key={tick}
          className="progress-tick"
          style={{ left: `${tick * 100}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
