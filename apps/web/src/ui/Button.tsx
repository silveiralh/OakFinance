import { Check } from 'lucide-react';
import { type MouseEvent, type ReactNode, useId } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type AppIcon, type BaseProps, cx } from './types';

export interface ButtonProps extends BaseProps {
  children: ReactNode;
  variant?: 'primary' | 'success' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  iconStart?: AppIcon;
  iconEnd?: AppIcon;
  loading?: boolean;
  confirmed?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * UX §5.1. Desabilitado usa `aria-disabled` (continua focável e lê o motivo); carregando mantém a largura e marca
 * `aria-busy`; confirmado troca o rótulo pelo ícone Check, sem perder o nome acessível.
 */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  iconStart: Start,
  iconEnd: End,
  loading = false,
  confirmed = false,
  disabled = false,
  disabledReason,
  type = 'button',
  onClick,
  className,
  'data-testid': testId,
}: ButtonProps) {
  const reasonId = useId();
  const blocked = disabled || loading;
  const showReason = disabled && disabledReason !== undefined && disabledReason !== '';
  const covered = loading || confirmed;
  const button = (
    <button
      type={type}
      className={cx('btn', !showReason && className)}
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth}
      data-testid={testId}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      aria-describedby={showReason ? reasonId : undefined}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <span data-part="label" data-hidden={covered} style={{ display: 'contents' }}>
        {Start && <Start size={20} aria-hidden="true" />}
        <span>{children}</span>
        {End && <End size={20} aria-hidden="true" />}
      </span>
      {loading && (
        <span data-part="overlay" aria-hidden="true">
          <span className="spinner" />
        </span>
      )}
      {!loading && confirmed && (
        <span data-part="overlay">
          <Check size={20} strokeWidth={2.5} aria-hidden="true" />
          <span className="sr-only">{uiText.saved}</span>
        </span>
      )}
    </button>
  );
  if (!showReason) {
    return button;
  }
  return (
    <span className={cx(className)} style={{ display: fullWidth ? 'block' : 'inline-block' }}>
      {button}
      <p id={reasonId} className="btn-reason">
        {disabledReason}
      </p>
    </span>
  );
}
