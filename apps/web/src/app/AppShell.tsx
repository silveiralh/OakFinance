import {
  ChartDonut,
  CreditCard,
  GearSix,
  House,
  ListBullets,
  Plugs,
  Plus,
} from '@phosphor-icons/react';
import { Link, Outlet, useLocation, useNavigate, useNavigation } from 'react-router';
import { shellText, uiText } from '../i18n/pt-BR';
import {
  AppBackdrop,
  BrandLogo,
  Button,
  FAB,
  type PhosphorIcon,
  TabBar,
  type TabItem,
  ToastProvider,
  TopBar,
} from '../ui';
import { type NavKey, PLAN_INDEX, QUICK_ENTRY_PARAM } from './screens';
import { UpdatePrompt } from './UpdatePrompt';
import { useCurrentScreen, useDocumentTitle } from './useScreen';
import './shell.css';

interface NavItem extends TabItem {
  key: NavKey;
}

/** Abas do celular (UX §2.1), na ordem; o FAB fica no meio. */
export const TAB_ITEMS: readonly NavItem[] = [
  { key: 'home', label: shellText.nav.home, icon: House, href: '/' },
  {
    key: 'transactions',
    label: shellText.nav.transactions,
    icon: ListBullets,
    href: '/lancamentos',
  },
  { key: 'cards', label: shellText.nav.cards, icon: CreditCard, href: '/cartoes' },
  { key: 'plan', label: shellText.nav.plan, icon: ChartDonut, href: PLAN_INDEX },
];

/** Barra lateral do `lg`: os mesmos itens + Configurações + Conexões (UX §2.1). */
export const SIDEBAR_ITEMS: readonly NavItem[] = [
  ...TAB_ITEMS,
  { key: 'settings', label: shellText.nav.settings, icon: GearSix, href: '/ajustes' },
  { key: 'connections', label: shellText.nav.connections, icon: Plugs, href: '/ajustes/conexoes' },
];

/** Abre o Q01 como sheet sobre a tela atual (`?novo=despesa`, UX §2.1). */
export function quickEntryHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set(QUICK_ENTRY_PARAM, 'despesa');
  return `${pathname}?${params.toString()}`;
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Glyph: PhosphorIcon = item.icon;
  return (
    <Link
      to={item.href}
      className="shell-side-link"
      aria-current={active ? 'page' : undefined}
      data-nav={item.key}
    >
      <Glyph size={24} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}

/**
 * Moldura comum (UX §3.0): fundo, "Pular para o conteúdo", TopBar com o título da tela, `<main id="conteudo">`,
 * abas com FAB no celular e barra lateral de 248 px no `lg`, e a região `aria-live` única (toasts).
 */
export function AppShell() {
  const { screen, nav } = useCurrentScreen();
  useDocumentTitle(screen);
  const navigate = useNavigate();
  const location = useLocation();
  const navigation = useNavigation();
  const openQuickEntry = () => navigate(quickEntryHref(location.pathname, location.search));
  const title = screen ? shellText.screens[screen] : shellText.appName;
  return (
    <ToastProvider>
      <UpdatePrompt />
      <div className="shell" data-testid="app-shell">
        <a className="skip-link" href="#conteudo">
          {shellText.skipToContent}
        </a>
        <AppBackdrop />
        <nav className="shell-sidebar glass" data-level="3" aria-label={uiText.mainNav}>
          <BrandLogo variant="wordmark" height={24} className="shell-side-logo" />
          <Button iconStart={Plus} fullWidth onClick={openQuickEntry}>
            {uiText.newEntry}
          </Button>
          <ul>
            {SIDEBAR_ITEMS.map((item) => (
              <li key={item.key}>
                <SidebarLink item={item} active={item.key === nav} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="shell-column">
          <TopBar title={title} transparentUntilScroll={screen === 'H01'} />
          <main
            id="conteudo"
            className="shell-main"
            tabIndex={-1}
            aria-busy={navigation.state === 'loading'}
          >
            <Outlet />
          </main>
        </div>
        <TabBar
          className="shell-tabbar"
          items={TAB_ITEMS}
          activeKey={nav ?? ''}
          onNavigate={(href) => navigate(href)}
          center={<FAB onPress={openQuickEntry} />}
        />
      </div>
    </ToastProvider>
  );
}
