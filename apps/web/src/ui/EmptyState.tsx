import { Button } from './Button';
import { type BaseProps, cx, type PhosphorIcon } from './types';

interface Action {
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps extends BaseProps {
  variant?: 'empty' | 'filtered' | 'error' | 'offline' | 'done';
  icon: PhosphorIcon;
  title: string;
  description: string;
  primaryAction?: Action;
  secondaryAction?: Action;
}

/** UX §5.25: ícone em disco de vidro (decorativo), título h2 e até duas ações. Textos na UX §6.5. */
export function EmptyState({
  variant = 'empty',
  icon: Glyph,
  title,
  description,
  primaryAction,
  secondaryAction,
  className,
  'data-testid': testId,
}: EmptyStateProps) {
  return (
    <div
      className={cx('empty', className)}
      data-variant={variant}
      data-testid={testId}
      role={variant === 'error' ? 'alert' : undefined}
    >
      <span className="empty-icon" aria-hidden="true">
        <Glyph size={32} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {primaryAction && <Button onClick={primaryAction.onPress}>{primaryAction.label}</Button>}
      {secondaryAction && (
        <Button variant="ghost" onClick={secondaryAction.onPress}>
          {secondaryAction.label}
        </Button>
      )}
    </div>
  );
}
