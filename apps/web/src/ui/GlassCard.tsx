import { CheckCircle, Info, Warning } from '@phosphor-icons/react';
import { createElement, type ReactNode } from 'react';
import { Skeleton } from './Skeleton';
import { type BaseProps, cx } from './types';

export interface GlassCardProps extends BaseProps {
  children?: ReactNode;
  level?: 1 | 2 | 3;
  as?: 'section' | 'article' | 'div' | 'li';
  title?: string;
  headingLevel?: 2 | 3 | 4;
  action?: { label: string; onPress: () => void } | { label: string; href: string };
  interactive?: { onPress: () => void } | { href: string };
  padding?: 'none' | 'md' | 'lg';
  tone?: 'default' | 'info' | 'warning' | 'success';
  loading?: boolean;
}

const TONE_ICON = { info: Info, warning: Warning, success: CheckCircle } as const;

/** UX §5.4: vidro em níveis; tom com faixa e ícone (nunca só cor); card inteiro clicável quando interativo. */
export function GlassCard({
  children,
  level = 2,
  as = 'section',
  title,
  headingLevel = 2,
  action,
  interactive,
  padding = 'md',
  tone = 'default',
  loading = false,
  className,
  'data-testid': testId,
}: GlassCardProps) {
  const ToneIcon = tone === 'default' ? null : TONE_ICON[tone];
  const head =
    title !== undefined || action ? (
      <div className="card-head">
        {title !== undefined &&
          createElement(
            `h${headingLevel}`,
            { className: 'card-title' },
            ToneIcon && <ToneIcon size={20} aria-hidden="true" />,
            title,
          )}
        {action &&
          ('href' in action ? (
            <a className="card-action" href={action.href}>
              {action.label}
            </a>
          ) : (
            <button type="button" className="card-action" onClick={action.onPress}>
              {action.label}
            </button>
          ))}
      </div>
    ) : (
      ToneIcon && <ToneIcon size={20} aria-hidden="true" />
    );
  const body = loading ? <Skeleton lines={3} /> : children;
  const common = {
    className: cx('glass card', className),
    'data-level': level,
    'data-padding': padding,
    'data-tone': tone,
    'data-testid': testId,
    'aria-busy': loading || undefined,
  };
  if (interactive) {
    const inner = (
      <>
        {head}
        {body}
      </>
    );
    return 'href' in interactive ? (
      <a {...common} data-interactive="true" href={interactive.href}>
        {inner}
      </a>
    ) : (
      <button {...common} type="button" data-interactive="true" onClick={interactive.onPress}>
        {inner}
      </button>
    );
  }
  return createElement(as, common, head, body);
}
