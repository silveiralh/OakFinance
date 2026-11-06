import { ChevronLeft } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { uiText } from '../i18n/pt-BR';
import { type AppIcon, type BaseProps, cx } from './types';

export interface TopBarProps extends BaseProps {
  title: string;
  onBack?: () => void;
  trailing?: ReactNode;
  transparentUntilScroll?: boolean;
}

/** UX §5.33: título, voltar com rótulo "Voltar", ações; transparente até rolar (padrão no Início). */
export function TopBar({
  title,
  onBack,
  trailing,
  transparentUntilScroll = false,
  className,
  'data-testid': testId,
}: TopBarProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!transparentUntilScroll) {
      return;
    }
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [transparentUntilScroll]);
  return (
    <header
      className={cx('topbar', className)}
      data-transparent={transparentUntilScroll && !scrolled}
      data-testid={testId}
    >
      {onBack && (
        <button type="button" className="icon-btn" aria-label={uiText.back} onClick={onBack}>
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
      )}
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-trailing">{trailing}</div>
    </header>
  );
}

export interface TabItem {
  key: string;
  label: string;
  icon: AppIcon;
  href: string;
  badge?: number;
}

export interface TabBarProps extends BaseProps {
  items: readonly TabItem[];
  activeKey: string;
  /** Slot central (FAB). */
  center?: ReactNode;
  onNavigate?: (href: string) => void;
}

/** UX §5.33: rótulo sempre visível; aba ativa com ícone `fill`, texto 600 e pílula (forma, não só cor). */
export function TabBar({
  items,
  activeKey,
  center,
  onNavigate,
  className,
  'data-testid': testId,
}: TabBarProps) {
  const half = Math.ceil(items.length / 2);
  const link = (item: TabItem) => {
    const active = item.key === activeKey;
    const Glyph = item.icon;
    return (
      <a
        key={item.key}
        href={item.href}
        className="tab"
        aria-current={active ? 'page' : undefined}
        onClick={(event) => {
          if (onNavigate) {
            event.preventDefault();
            onNavigate(item.href);
          }
        }}
      >
        <span className="tab-pill">
          <Glyph size={24} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
          {item.badge !== undefined && item.badge > 0 && (
            <span className="tab-badge">{item.badge}</span>
          )}
        </span>
        <span className="tab-label">{item.label}</span>
      </a>
    );
  };
  return (
    <nav
      className={cx('tabbar glass', className)}
      data-level="3"
      aria-label={uiText.mainNav}
      data-testid={testId}
    >
      {items.slice(0, half).map(link)}
      {center && <div className="tab-center">{center}</div>}
      {items.slice(half).map(link)}
    </nav>
  );
}
