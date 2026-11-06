import { uiText } from '../i18n/pt-BR';
import { type BaseProps, cx } from './types';

export interface SkeletonProps extends BaseProps {
  shape?: 'line' | 'circle' | 'card' | 'hero';
  lines?: number;
}

/** UX §5.26: contêiner `aria-busy` com "Carregando" para leitor de tela; pulso estático com movimento reduzido. */
export function Skeleton({
  shape = 'line',
  lines = 1,
  className,
  'data-testid': testId,
}: SkeletonProps) {
  const count = shape === 'line' ? Math.max(1, lines) : 1;
  return (
    <div className={cx(className)} aria-busy="true" data-testid={testId}>
      <span className="sr-only">{uiText.loading}</span>
      {Array.from({ length: count }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: linhas idênticas e estáticas
          key={i}
          className="skeleton"
          data-shape={shape}
          aria-hidden="true"
          style={shape === 'line' && i === count - 1 && count > 1 ? { width: '60%' } : undefined}
        />
      ))}
    </div>
  );
}
