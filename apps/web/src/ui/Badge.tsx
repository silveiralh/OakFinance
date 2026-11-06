import { type AppIcon, type BaseProps, cx } from './types';

export interface BadgeProps extends BaseProps {
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  icon: AppIcon;
  label: string;
}

/** UX §5.34: pílula de 24 px, sempre ícone + texto. */
export function Badge({
  tone = 'neutral',
  icon: Glyph,
  label,
  className,
  'data-testid': testId,
}: BadgeProps) {
  return (
    <span className={cx('badge', className)} data-tone={tone} data-testid={testId}>
      <Glyph size={14} strokeWidth={2.5} aria-hidden="true" />
      {label}
    </span>
  );
}
