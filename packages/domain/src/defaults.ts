// Dados iniciais por usuário (tech §3.8, PRD RN-40 e RN-64). [CONTRATO]
// Criados no aparelho com ids v5 (seedCategoryId/seedRuleId/seedReminderId/reserveGoalId): dois aparelhos não duplicam.
import type { Bucket, CategoryBucket } from './types.ts';

export interface DefaultCategory {
  slug: string;
  name: string;
  kind: 'expense' | 'income' | 'transfer';
  bucket: CategoryBucket;
  feedsReserve: boolean;
  isSystem: boolean;
  icon: string | null; // Phosphor (UX §4.7)
}

const expense = (
  slug: string,
  name: string,
  bucket: Bucket,
  icon: string | null,
): DefaultCategory => ({
  slug,
  name,
  kind: 'expense',
  bucket,
  feedsReserve: bucket === 'savings',
  isSystem: false,
  icon,
});

const other = (
  slug: string,
  name: string,
  kind: DefaultCategory['kind'],
  bucket: CategoryBucket,
  icon: string | null,
  isSystem = false,
): DefaultCategory => ({ slug, name, kind, bucket, feedsReserve: false, isSystem, icon });

/** Lista idêntica à RN-40 (sem subcategorias). */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  expense('moradia', 'Moradia', 'needs', 'HouseLine'),
  expense('contas-da-casa', 'Contas da casa', 'needs', 'Lightning'),
  expense('mercado', 'Mercado', 'needs', 'ShoppingCart'),
  expense('transporte', 'Transporte', 'needs', 'Bus'),
  expense('combustivel', 'Combustível', 'needs', 'GasPump'),
  expense('saude', 'Saúde', 'needs', 'FirstAidKit'),
  expense('farmacia', 'Farmácia', 'needs', 'Pill'),
  expense('educacao', 'Educação', 'needs', 'GraduationCap'),
  expense('seguros', 'Seguros', 'needs', null),
  expense('impostos-taxas', 'Impostos e taxas', 'needs', 'Receipt'),
  expense('pets', 'Pets', 'needs', 'PawPrint'),
  expense('restaurantes-delivery', 'Restaurantes e delivery', 'wants', 'ForkKnife'),
  expense('lazer', 'Lazer', 'wants', 'Ticket'),
  expense('assinaturas', 'Assinaturas', 'wants', 'Repeat'),
  expense('compras', 'Compras e vestuário', 'wants', 'ShoppingBag'),
  expense('beleza-cuidados', 'Beleza e cuidados', 'wants', 'Scissors'),
  expense('viagens', 'Viagens', 'wants', 'AirplaneTilt'),
  expense('presentes', 'Presentes', 'wants', 'Gift'),
  expense('outros', 'Outros', 'wants', 'DotsThreeCircle'),
  expense('reserva-emergencia', 'Reserva de emergência', 'savings', 'ShieldCheck'),
  expense('outros-aportes', 'Outros aportes', 'savings', 'TrendUp'),
  other('salario', 'Salário', 'income', 'income', 'Briefcase'),
  other('renda-extra', 'Renda extra', 'income', 'income', 'Coins'),
  other('beneficios', 'Benefícios (VR/VA)', 'income', 'income', 'ForkKnife'),
  other('reembolsos', 'Reembolsos', 'income', 'income', 'ArrowCounterClockwise'),
  other('outras-receitas', 'Outras receitas', 'income', 'income', 'PlusCircle'),
  other('pagamento-fatura', 'Pagamento de fatura', 'transfer', 'transfer', 'CreditCard'),
  other(
    'transferencia-entre-contas',
    'Transferência entre contas',
    'transfer',
    'transfer',
    'ArrowsLeftRight',
  ),
  other('resgate-reserva', 'Resgate da reserva', 'transfer', 'transfer', 'Vault'),
  other('a-classificar', 'A classificar', 'expense', 'none', null, true),
  other('saldo-credor', 'Saldo credor da fatura anterior', 'expense', 'none', null, true),
];

export const UNCLASSIFIED_SLUG = 'a-classificar';
export const CARRY_OVER_SLUG = 'saldo-credor';

/** Regras padrão da RN-64 (token_prefix, já normalizadas). "TIM" casa só como token inteiro. */
export const DEFAULT_RULES: ReadonlyArray<{ pattern: string; slug: string }> = [
  ...['POSTO', 'COMBUSTIVEL', 'SHELL', 'IPIRANGA', 'PETROBRAS'].map((pattern) => ({
    pattern,
    slug: 'combustivel',
  })),
  ...['SUPERMERC', 'MERCADO', 'ATACADO', 'ATACADAO', 'ASSAI', 'CONDOR'].map((pattern) => ({
    pattern,
    slug: 'mercado',
  })),
  ...['FARMACIA', 'DROGARIA', 'DROGA', 'PANVEL', 'RAIA', 'NISSEI', 'PAGUE MENOS'].map(
    (pattern) => ({
      pattern,
      slug: 'farmacia',
    }),
  ),
  ...['UBER', 'CABIFY'].map((pattern) => ({ pattern, slug: 'transporte' })),
  ...['IFOOD', 'RAPPI'].map((pattern) => ({ pattern, slug: 'restaurantes-delivery' })),
  ...['NETFLIX', 'SPOTIFY', 'DISNEY', 'PRIME', 'YOUTUBE'].map((pattern) => ({
    pattern,
    slug: 'assinaturas',
  })),
  ...['COPEL', 'SANEPAR', 'VIVO', 'CLARO', 'TIM'].map((pattern) => ({
    pattern,
    slug: 'contas-da-casa',
  })),
];

export interface DefaultReminder {
  kind:
    | 'invoice_due'
    | 'invoice_closed'
    | 'bill_due'
    | 'bill_overdue'
    | 'income_unconfirmed'
    | 'budget_threshold'
    | 'daily_log'
    | 'weekly_summary'
    | 'bank_connection';
  localTime: string; // 'HH:MM'
  daysBefore: readonly number[];
  weekday: number | null;
}

/** Lembretes padrão (RN-86..RN-94). */
export const DEFAULT_REMINDERS: readonly DefaultReminder[] = [
  { kind: 'daily_log', localTime: '20:00', daysBefore: [0], weekday: null },
  { kind: 'invoice_due', localTime: '09:00', daysBefore: [3, 0], weekday: null },
  { kind: 'invoice_closed', localTime: '09:00', daysBefore: [0], weekday: null },
  { kind: 'bill_due', localTime: '09:00', daysBefore: [1], weekday: null },
  { kind: 'bill_overdue', localTime: '09:00', daysBefore: [-1], weekday: null },
  { kind: 'income_unconfirmed', localTime: '09:00', daysBefore: [-1], weekday: null },
  { kind: 'budget_threshold', localTime: '09:00', daysBefore: [0], weekday: null },
  { kind: 'weekly_summary', localTime: '19:00', daysBefore: [0], weekday: 0 },
  { kind: 'bank_connection', localTime: '09:00', daysBefore: [0], weekday: null },
];

/** Silêncio padrão 22:00–07:59. */
export const DEFAULT_QUIET_HOURS = { start: '22:00', end: '08:00' } as const;

/** Orçamento padrão: budgets com month = null, 50/30/20 em basis points. */
export const DEFAULT_BUDGET_PCT_BP: Readonly<Record<Bucket, number>> = {
  needs: 5000,
  wants: 3000,
  savings: 2000,
};

/** Reserva padrão: meta automática = 6 × média das Necessidades dos últimos 6 meses. */
export const DEFAULT_RESERVE = {
  name: 'Reserva de emergência',
  targetMode: 'auto',
  autoFactor: 6,
  autoLookbackMonths: 6,
} as const;
