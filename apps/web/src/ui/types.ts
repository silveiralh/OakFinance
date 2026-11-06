import type { Icon } from '@phosphor-icons/react';

/** Ícone da Phosphor (UX §4.7). */
export type PhosphorIcon = Icon;

/** Props comuns: todos aceitam `className` e repassam `data-testid` (UX §5). */
export interface BaseProps {
  className?: string;
  'data-testid'?: string;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
