import type { MouseEvent } from 'react';
import { type BaseProps, cx, type PhosphorIcon } from './types';

export interface IconButtonProps extends BaseProps {
  icon: PhosphorIcon;
  label: string;
  variant?: 'glass' | 'plain';
  size?: 48 | 56;
  pressed?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/** UX §5.2: rótulo obrigatório vira `aria-label`; área de toque ≥ 48 px. */
export function IconButton({
  icon: Glyph,
  label,
  variant = 'plain',
  size = 48,
  pressed,
  onClick,
  className,
  'data-testid': testId,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx('icon-btn', className)}
      data-variant={variant}
      data-size={size}
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Glyph size={24} weight={pressed ? 'fill' : 'regular'} aria-hidden="true" />
    </button>
  );
}
