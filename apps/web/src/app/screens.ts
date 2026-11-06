// Tabela de rotas do UX §2.1 e §3 (caminho, tela e aba). As telas são carregadas sob demanda (lazy) pelos módulos
// de `features/`; o `routes.tsx` monta o roteador a partir desta tabela.
import type { ComponentType } from 'react';
import type { ScreenId } from '../i18n/pt-BR';

export type NavKey = 'home' | 'transactions' | 'cards' | 'plan' | 'settings' | 'connections';

/** Metadados de rota lidos pelo AppShell (`useMatches`). */
export interface ScreenHandle {
  screen: ScreenId | ((search: URLSearchParams) => ScreenId);
  nav?: NavKey;
}

export interface ScreenRoute {
  /** Caminho do React Router, igual ao da UX §3 (parâmetros com nomes do código). */
  path: string;
  handle: ScreenHandle;
  load: () => Promise<ComponentType>;
}

/** ON02a/b/c: `/instalar?p=android|ios|desktop`; sem `p` (ou outro valor), o guia do computador. */
export function installScreen(search: URLSearchParams): ScreenId {
  const platform = search.get('p');
  if (platform === 'android') {
    return 'ON02a';
  }
  if (platform === 'ios') {
    return 'ON02b';
  }
  return 'ON02c';
}

export function resolveScreen(handle: ScreenHandle, search: URLSearchParams): ScreenId {
  return typeof handle.screen === 'function' ? handle.screen(search) : handle.screen;
}

const dashboard = () => import('../features/dashboard/screens');
const transactions = () => import('../features/transactions/screens');
const cards = () => import('../features/cards/screens');
const budget = () => import('../features/budget/screens');
const connections = () => import('../features/connections/screens');
const onboarding = () => import('../features/onboarding/screens');

/** Telas dentro do AppShell (TopBar, abas ou barra lateral, FAB). */
export const SHELL_SCREENS: readonly ScreenRoute[] = [
  {
    path: '/',
    handle: { screen: 'H01', nav: 'home' },
    load: () => dashboard().then((m) => m.HomeScreen),
  },
  {
    path: '/avisos',
    handle: { screen: 'H02', nav: 'home' },
    load: () => dashboard().then((m) => m.NoticesScreen),
  },
  {
    path: '/lancamentos',
    handle: { screen: 'T01', nav: 'transactions' },
    load: () => transactions().then((m) => m.TransactionsScreen),
  },
  {
    path: '/lancamentos/:id',
    handle: { screen: 'T02', nav: 'transactions' },
    load: () => transactions().then((m) => m.TransactionDetailScreen),
  },
  {
    path: '/cartoes',
    handle: { screen: 'C01', nav: 'cards' },
    load: () => cards().then((m) => m.CardsScreen),
  },
  {
    path: '/cartoes/:cartaoId/fatura/:mes',
    handle: { screen: 'C02', nav: 'cards' },
    load: () => cards().then((m) => m.InvoiceScreen),
  },
  {
    path: '/planejar/orcamento',
    handle: { screen: 'P01', nav: 'plan' },
    load: () => budget().then((m) => m.BudgetScreen),
  },
  {
    path: '/planejar/reserva',
    handle: { screen: 'P02', nav: 'plan' },
    load: () => budget().then((m) => m.ReserveScreen),
  },
  {
    path: '/planejar/futuro',
    handle: { screen: 'P03', nav: 'plan' },
    load: () => budget().then((m) => m.FutureScreen),
  },
  {
    path: '/planejar/fechar/:mes',
    handle: { screen: 'P04', nav: 'plan' },
    load: () => budget().then((m) => m.CloseMonthScreen),
  },
  {
    path: '/ajustes',
    handle: { screen: 'S01', nav: 'settings' },
    load: () => import('../features/settings/screens').then((m) => m.SettingsScreen),
  },
  {
    path: '/ajustes/contas',
    handle: { screen: 'S03', nav: 'settings' },
    load: () => import('../features/accounts/screens').then((m) => m.AccountsScreen),
  },
  {
    path: '/ajustes/conexoes',
    handle: { screen: 'I01', nav: 'connections' },
    load: () => connections().then((m) => m.ConnectionsScreen),
  },
  {
    path: '/ajustes/conexoes/novo',
    handle: { screen: 'I02', nav: 'connections' },
    load: () => connections().then((m) => m.ConnectBankScreen),
  },
  {
    path: '/importar',
    handle: { screen: 'I03', nav: 'connections' },
    load: () => import('../features/imports/screens').then((m) => m.ImportScreen),
  },
  {
    path: '/nota',
    handle: { screen: 'I04', nav: 'connections' },
    load: () => import('../features/nfce/screens').then((m) => m.NfceScreen),
  },
  {
    path: '/conferir',
    handle: { screen: 'I05', nav: 'transactions' },
    load: () => import('../features/inbox/screens').then((m) => m.InboxScreen),
  },
];

/** Antes do login (UX §2.3): com sessão, vão direto ao Início. */
export const PUBLIC_SCREENS: readonly ScreenRoute[] = [
  {
    path: '/boas-vindas',
    handle: { screen: 'ON01' },
    load: () => onboarding().then((m) => m.WelcomeScreen),
  },
  {
    path: '/entrar',
    handle: { screen: 'ON03' },
    load: () => onboarding().then((m) => m.LoginScreen),
  },
  {
    path: '/auth/callback',
    handle: { screen: 'ON03' },
    load: () => onboarding().then((m) => m.AuthCallback),
  },
];

/** Instalação (ON02a/b/c): antes do login no iPhone e depois dele no Android (UX §2.3), então sem guarda. */
export const OPEN_SCREENS: readonly ScreenRoute[] = [
  {
    path: '/instalar',
    handle: { screen: installScreen },
    load: () => onboarding().then((m) => m.InstallScreen),
  },
];

/** Onboarding depois do login (UX §2.3): telas cheias, sem abas. */
export const ONBOARDING_SCREENS: readonly ScreenRoute[] = [
  {
    path: '/boas-vindas/lembretes',
    handle: { screen: 'ON04' },
    load: () => onboarding().then((m) => m.OnbRemindersScreen),
  },
  {
    path: '/boas-vindas/renda',
    handle: { screen: 'ON05' },
    load: () => onboarding().then((m) => m.OnbIncomeScreen),
  },
  {
    path: '/boas-vindas/contas',
    handle: { screen: 'ON06' },
    load: () => onboarding().then((m) => m.OnbAccountsScreen),
  },
  {
    path: '/boas-vindas/cartoes',
    handle: { screen: 'ON07' },
    load: () => onboarding().then((m) => m.OnbCardsScreen),
  },
  {
    path: '/boas-vindas/reserva',
    handle: { screen: 'ON07b' },
    load: () => onboarding().then((m) => m.OnbReserveScreen),
  },
  {
    path: '/boas-vindas/pronto',
    handle: { screen: 'ON08' },
    load: () => onboarding().then((m) => m.OnbDoneScreen),
  },
];

/** `/planejar` abre a primeira aba interna (Orçamento, UX §2.1). */
export const PLAN_INDEX = '/planejar/orcamento';

/** Parâmetro do lançamento rápido (Q01 como sheet, UX §3 Q01). */
export const QUICK_ENTRY_PARAM = 'novo';
