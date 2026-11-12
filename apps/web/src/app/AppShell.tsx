import { ChartPie, CreditCard, FileUp, House, List, Plug, Plus, Settings } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useNavigation } from 'react-router';
import { markQuickEntryStart } from '../features/quick-entry/clock';
import { type ScreenId, shellText, t, uiText } from '../i18n/pt-BR';
import {
  AppBackdrop,
  type AppIcon,
  BrandLogo,
  Button,
  FAB,
  TabBar,
  type TabItem,
  ToastProvider,
  TopBar,
} from '../ui';
import { AccountMenu } from './AccountMenu';
import { AppTelemetry } from './AppTelemetry';
import { AutoPosts } from './AutoPosts';
import { NoticesBell } from './NoticesBell';
import { OnboardingGate } from './OnboardingGate';
import { OPEN_FINANCE_ENABLED } from './openFinance';
import { PlanTabs } from './PlanTabs';
import { RemoteEditsToast } from './RemoteEditsToast';
import { SessionExpired } from './SessionExpired';
import { StorageBanners } from './StorageBanners';
import { ShellSyncBadge, SyncBanners, WipedDialog } from './SyncStatus';
import {
  backTarget,
  type NavKey,
  PLAN_INDEX,
  PLAN_TABS,
  type PlanTab,
  QUICK_ENTRY_PARAM,
  TAB_ROOTS,
} from './screens';
import { UpdatePrompt } from './UpdatePrompt';
import { useCurrentScreen, useDocumentTitle } from './useScreen';
import { HideValuesButton, ValuesFromProfile } from './values';

const QuickEntryHost = lazy(() =>
  import('../features/quick-entry/QuickEntryHost').then((m) => ({ default: m.QuickEntryHost })),
);
// RN-92: os avisos de orçamento carregam o cálculo do mês; ficam fora do bundle inicial
const BudgetAlerts = lazy(() =>
  import('./BudgetAlerts').then((m) => ({ default: m.BudgetAlerts })),
);
// tech §6.4.2: renova a inscrição de push ao abrir (fora do bundle inicial)
const PushKeeper = lazy(() => import('./PushKeeper').then((m) => ({ default: m.PushKeeper })));
// US-55: relê as notas NFC-e lidas sem rede quando ela volta (fora do bundle inicial)
const NfceRetryKeeper = lazy(() =>
  import('../features/nfce/NfcePending').then((m) => ({ default: m.NfceRetryKeeper })),
);
const FabMenu = lazy(() =>
  import('../features/quick-entry/QuickEntryHost').then((m) => ({ default: m.FabMenu })),
);

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
    icon: List,
    href: '/lancamentos',
  },
  { key: 'cards', label: shellText.nav.cards, icon: CreditCard, href: '/cartoes' },
  { key: 'plan', label: shellText.nav.plan, icon: ChartPie, href: PLAN_INDEX },
];

/**
 * Barra lateral do `lg`: os mesmos itens + Configurações + Conexões (UX §2.1). Sem o Open Finance (D-080) o último
 * item é "Importar extrato", que leva à mesma I01 (importar extrato e ler nota).
 */
export const SIDEBAR_ITEMS: readonly NavItem[] = [
  ...TAB_ITEMS,
  { key: 'settings', label: shellText.nav.settings, icon: Settings, href: '/ajustes' },
  OPEN_FINANCE_ENABLED
    ? {
        key: 'connections',
        label: shellText.nav.connections,
        icon: Plug,
        href: '/ajustes/conexoes',
      }
    : { key: 'connections', label: t('account.import'), icon: FileUp, href: '/ajustes/conexoes' },
];

/** Abre o Q01 como sheet sobre a tela atual (`?novo=despesa`, UX §2.1). */
export function quickEntryHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set(QUICK_ENTRY_PARAM, 'despesa');
  return `${pathname}?${params.toString()}`;
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Glyph: AppIcon = item.icon;
  return (
    <Link
      to={item.href}
      className="shell-side-link"
      aria-current={active ? 'page' : undefined}
      data-nav={item.key}
    >
      <Glyph size={24} strokeWidth={active ? 2.5 : 2} aria-hidden="true" />
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
  const [menuOpen, setMenuOpen] = useState(false);
  const openQuickEntry = () => {
    markQuickEntryStart();
    void navigate(quickEntryHref(location.pathname, location.search));
  };
  const title = screen
    ? ((shellText.shortTitles as Partial<Record<ScreenId, string>>)[screen] ??
      shellText.screens[screen])
    : shellText.appName;
  const root = screen !== null && TAB_ROOTS.has(screen);
  const back = screen ? backTarget(screen) : null;
  // UXA-012: com histórico o Voltar só volta; aberta direto (sem histórico), vai para a tela-mãe
  const goBack = back
    ? () => void (location.key === 'default' ? navigate(back) : navigate(-1))
    : undefined;
  const planTab = (PLAN_TABS as readonly string[]).includes(screen ?? '')
    ? (screen as PlanTab)
    : null;
  return (
    <ToastProvider>
      <AppTelemetry />
      <UpdatePrompt />
      <SessionExpired />
      <RemoteEditsToast />
      <WipedDialog />
      <ValuesFromProfile />
      <OnboardingGate />
      <AutoPosts />
      <Suspense fallback={null}>
        <BudgetAlerts />
        <PushKeeper />
        <NfceRetryKeeper />
      </Suspense>
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
          <TopBar
            title={title}
            transparentUntilScroll={screen === 'H01'}
            {...(goBack ? { onBack: goBack } : {})}
            trailing={
              <>
                {screen === 'H01' && <HideValuesButton />}
                {screen === 'H01' && <NoticesBell />}
                <ShellSyncBadge />
                {root && <AccountMenu />}
              </>
            }
          />
          <StorageBanners />
          <SyncBanners />
          <main
            id="conteudo"
            className="shell-main"
            tabIndex={-1}
            aria-busy={navigation.state === 'loading'}
          >
            {planTab && <PlanTabs current={planTab} />}
            <Outlet />
          </main>
        </div>
        <TabBar
          className="shell-tabbar"
          items={TAB_ITEMS}
          activeKey={nav ?? ''}
          onNavigate={(href) => navigate(href)}
          center={<FAB onPress={openQuickEntry} onLongPress={() => setMenuOpen(true)} />}
        />
        <Suspense fallback={null}>
          <QuickEntryHost />
          {menuOpen && (
            <FabMenu
              open
              onClose={() => setMenuOpen(false)}
              onPick={(href) => {
                setMenuOpen(false);
                markQuickEntryStart();
                void navigate(href.startsWith('?') ? `${location.pathname}${href}` : href);
              }}
            />
          )}
        </Suspense>
      </div>
    </ToastProvider>
  );
}
