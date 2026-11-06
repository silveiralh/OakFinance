import type { LucideIcon } from 'lucide-react';

/** Ícone da Lucide (UX §4.7, D-023). */
export type AppIcon = LucideIcon;

/** Props comuns: todos aceitam `className` e repassam `data-testid` (UX §5). */
export interface BaseProps {
  className?: string;
  'data-testid'?: string;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
