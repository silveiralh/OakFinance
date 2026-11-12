import { formatBRL, HIDDEN_AMOUNT } from '@oakfinance/domain';
import { TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { uiText } from '../i18n/pt-BR';
import { useEnvironment } from '../lib/useEnvironment';
import { percentOf } from './ProgressBar';
import { type BaseProps, cx } from './types';

export type BandKey = 'needs' | 'wants' | 'savings';

export interface RingBand {
  key: BandKey;
  spentCents: number;
  plannedCents: number;
}

export interface BudgetRingProps extends BaseProps {
  bands: readonly RingBand[];
  incomeCents: number;
  size?: 'sm' | 'lg';
  showLegend?: boolean;
}

const NAME: Record<BandKey, string> = {
  needs: uiText.bandNeeds,
  wants: uiText.bandWants,
  savings: uiText.bandSavings,
};
const ORDER: readonly BandKey[] = ['needs', 'wants', 'savings'];

/** Rótulo acessível: "Necessidades 53% de R$ 2.400,00; Desejos 41% de R$ 1.440,00; …". */
export function ringLabel(bands: readonly RingBand[], hidden: boolean): string {
  return ORDER.flatMap((key) => bands.filter((b) => b.key === key))
    .map(
      (b) =>
        `${NAME[b.key]} ${percentOf(b.spentCents, b.plannedCents)}% ${uiText.of} ${hidden ? HIDDEN_AMOUNT : formatBRL(b.plannedCents)}`,
    )
    .join('; ');
}

/** UX §5.15: anéis concêntricos (Necessidades fora), excedente em segunda volta com hachura; tabela como legenda. */
export function BudgetRing({
  bands,
  incomeCents,
  size = 'lg',
  showLegend = size === 'lg',
  className,
  'data-testid': testId,
}: BudgetRingProps) {
  const env = useEnvironment();
  const hidden = env.values === 'hidden';
  const hatch = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-hatch`;
  const px = size === 'lg' ? 240 : 96;
  const stroke = size === 'lg' ? 12 : 7;
  const gap = stroke + (size === 'lg' ? 6 : 3);
  const sorted = ORDER.flatMap((key) => bands.filter((b) => b.key === key));
  const money = (c: number) => (hidden ? HIDDEN_AMOUNT : formatBRL(c));
  return (
    <figure className={cx('budget-ring', className)} data-size={size} data-testid={testId}>
      <svg
        width={px}
        height={px}
        viewBox={`0 0 ${px} ${px}`}
        role="img"
        aria-label={ringLabel(bands, hidden)}
      >
        <defs>
          <pattern
            id={hatch}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="3" height="6" fill="var(--status-danger-fill)" />
          </pattern>
        </defs>
        {sorted.map((b, i) => {
          const r = px / 2 - stroke / 2 - i * gap;
          const c = 2 * Math.PI * r;
          const frac = b.plannedCents > 0 ? b.spentCents / b.plannedCents : 0;
          const base = Math.min(frac, 1);
          const excess = Math.min(Math.max(frac - 1, 0), 1);
          return (
            <g key={b.key} transform={`rotate(-90 ${px / 2} ${px / 2})`} data-band={b.key}>
              <circle
                cx={px / 2}
                cy={px / 2}
                r={r}
                fill="none"
                stroke="var(--band-track)"
                strokeWidth={stroke}
              />
              {/* UXB-019: arco de 0% com ponta redonda vira um ponto; sem valor, só o trilho */}
              {base > 0 && (
                <circle
                  className="budget-ring-arc"
                  cx={px / 2}
                  cy={px / 2}
                  r={r}
                  fill="none"
                  stroke={`var(--band-${b.key})`}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${base * c} ${c}`}
                />
              )}
              {excess > 0 && (
                <circle
                  className="budget-ring-arc"
                  data-excess="true"
                  cx={px / 2}
                  cy={px / 2}
                  r={r}
                  fill="none"
                  stroke={`url(#${hatch})`}
                  strokeWidth={stroke}
                  strokeDasharray={`${excess * c} ${c}`}
                />
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="budget-ring-center">
        <span className="money-text" data-size={size === 'lg' ? 'display' : 'label'}>
          {money(incomeCents)}
        </span>
      </figcaption>
      {showLegend && (
        <table className="budget-ring-legend">
          <tbody>
            {sorted.map((b) => {
              const pct = percentOf(b.spentCents, b.plannedCents);
              const over = b.spentCents - b.plannedCents;
              return (
                <tr key={b.key} data-band={b.key}>
                  <th scope="row">
                    {pct >= 80 && b.key !== 'savings' && (
                      <TriangleAlert size={16} aria-hidden="true" />
                    )}
                    {NAME[b.key]}
                  </th>
                  <td>{`${pct}%`}</td>
                  <td>{money(b.plannedCents)}</td>
                  <td>
                    {over > 0 && b.key !== 'savings'
                      ? uiText.aboveBy.replace('{valor}', money(over))
                      : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </figure>
  );
}
