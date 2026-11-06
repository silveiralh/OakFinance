import { formatBRL, HIDDEN_AMOUNT } from '@oakfinance/domain';
import { CheckCircle } from '@phosphor-icons/react';
import { uiText } from '../i18n/pt-BR';
import { useEnvironment } from '../lib/useEnvironment';
import { percentOf } from './ProgressBar';
import { type BaseProps, cx } from './types';

export interface GoalProgressProps extends BaseProps {
  savedCents: number;
  goalCents: number | null;
  variant?: 'ring' | 'bar';
  size?: 'sm' | 'lg';
  ticks?: readonly number[];
  showLabel?: boolean;
}

/** UX §5.17: nível = min(guardado/meta, 1); sem meta, trilho tracejado e "Defina uma meta". */
export function GoalProgress({
  savedCents,
  goalCents,
  variant = 'ring',
  size = 'lg',
  ticks = [0.25, 0.5, 0.75],
  showLabel = true,
  className,
  'data-testid': testId,
}: GoalProgressProps) {
  const env = useEnvironment();
  const hidden = env.values === 'hidden';
  const hasGoal = goalCents !== null && goalCents > 0;
  const pct = hasGoal ? Math.min(percentOf(Math.max(savedCents, 0), goalCents), 100) : 0;
  const reached = hasGoal && savedCents >= goalCents;
  const money = (c: number) => (hidden ? HIDDEN_AMOUNT : formatBRL(c));
  const valueText = hasGoal
    ? `${pct}%, ${money(Math.max(savedCents, 0))} ${uiText.of} ${money(goalCents)}${reached ? `, ${uiText.goalReached}` : ''}`
    : uiText.defineGoal;
  const label = hasGoal ? `${pct}%` : uiText.defineGoal;
  const common = {
    role: 'progressbar' as const,
    'aria-label': uiText.bandSavings,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': pct,
    'aria-valuetext': valueText,
  };
  if (variant === 'bar') {
    return (
      <div
        className={cx('goal-bar', className)}
        data-state={reached ? 'reached' : hasGoal ? 'progress' : 'no-goal'}
        data-testid={testId}
      >
        <div
          className="progress"
          data-tone="band-savings"
          data-size="md"
          data-no-goal={!hasGoal}
          {...common}
        >
          <span className="progress-fill" style={{ width: `${pct}%` }} />
          {ticks.map((tick) => (
            <span
              key={tick}
              className="progress-tick"
              style={{ left: `${tick * 100}%` }}
              aria-hidden="true"
            />
          ))}
        </div>
        {showLabel && (
          <span className="goal-label">
            {reached && <CheckCircle size={16} weight="fill" aria-hidden="true" />}
            {label}
          </span>
        )}
      </div>
    );
  }
  const px = size === 'lg' ? 200 : 96;
  const stroke = 12;
  const r = px / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={cx('goal-ring', className)}
      data-state={reached ? 'reached' : hasGoal ? 'progress' : 'no-goal'}
      data-testid={testId}
      {...common}
    >
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden="true">
        <g transform={`rotate(-90 ${px / 2} ${px / 2})`}>
          <circle
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            stroke="var(--band-track)"
            strokeWidth={stroke}
            strokeDasharray={hasGoal ? undefined : '6 6'}
          />
          <circle
            className="ring-arc"
            cx={px / 2}
            cy={px / 2}
            r={r}
            fill="none"
            stroke="var(--band-savings)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * c} ${c}`}
          />
          {ticks.map((tick) => {
            const a = tick * 2 * Math.PI;
            const x = px / 2 + r * Math.cos(a);
            const y = px / 2 + r * Math.sin(a);
            return <circle key={tick} cx={x} cy={y} r={1} fill="var(--border-strong)" />;
          })}
        </g>
      </svg>
      {showLabel && (
        <span className="goal-center">
          {reached && <CheckCircle size={20} weight="fill" aria-hidden="true" />}
          <span>{label}</span>
        </span>
      )}
    </div>
  );
}
