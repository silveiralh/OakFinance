import { X } from '@phosphor-icons/react';
import { uiText } from '../i18n/pt-BR';
import { Button } from './Button';
import { type BaseProps, cx, type PhosphorIcon } from './types';

export interface BannerProps extends BaseProps {
  tone?: 'info' | 'warning';
  icon: PhosphorIcon;
  message: string;
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
}

/** UX §5.23: `role="status"` (info) ou `role="alert"` (alerta com ação necessária); faixa de tom + ícone. */
export function Banner({
  tone = 'info',
  icon: Glyph,
  message,
  action,
  onDismiss,
  className,
  'data-testid': testId,
}: BannerProps) {
  const role = tone === 'warning' && action ? 'alert' : 'status';
  return (
    <div
      className={cx('glass banner', className)}
      data-level="3"
      data-tone={tone}
      data-testid={testId}
      role={role}
    >
      <Glyph size={20} aria-hidden="true" />
      <p>{message}</p>
      {action && (
        <Button variant="ghost" size="sm" onClick={action.onPress}>
          {action.label}
        </Button>
      )}
      {onDismiss && (
        <button type="button" className="icon-btn" aria-label={uiText.close} onClick={onDismiss}>
          <X size={20} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
