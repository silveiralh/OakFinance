// Categorização por regras determinísticas (tech §5.8, PRD RN-57..RN-64). Sem IA, sem serviço externo. [CONTRATO]
import type { Category, DomainCtx, PaymentMethod, Tx, TxKind } from './types.ts';

/** Stopwords da RN-58. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'PAG',
  'PAGTO',
  'PGTO',
  'PAGAMENTO',
  'COMPRA',
  'COMPRAS',
  'CARTAO',
  'CREDITO',
  'DEBITO',
  'DEB',
  'CRED',
  'PIX',
  'ENVIADO',
  'RECEBIDO',
  'TRANSF',
  'TRANSFERENCIA',
  'TED',
  'DOC',
  'BOLETO',
  'NU',
  'BB',
  'EC',
  'ELO',
  'VISA',
  'MASTER',
  'MASTERCARD',
  'LTDA',
  'ME',
  'EIRELI',
  'SA',
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
]);

/**
 * RN-57: maiúsculas; sem acento (NFD); não alfanumérico → espaço; remove tokens com dígito; remove stopwords;
 * colapsa espaços. "PAG*PostoIpiranga 1234 - Campo Mourão" → "POSTOIPIRANGA CAMPO MOURAO".
 */
export function normalizeDescription(raw: string): string {
  return raw
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t !== '' && !/\d/.test(t) && !STOPWORDS.has(t))
    .join(' ');
}

/** RN-62: 2 primeiros tokens (ou 1), máx. 30 caracteres; "" se o termo tiver menos de 4 caracteres. */
export function merchantKey(normalized: string): string {
  const key = normalized.split(' ').filter(Boolean).slice(0, 2).join(' ').slice(0, 30).trim();
  return key.length >= 4 ? key : '';
}

export interface CategoryRule {
  id: string;
  matchField: 'description' | 'merchant_cnpj';
  matchType: 'token_prefix' | 'contains' | 'starts_with' | 'equals' | 'regex';
  pattern: string;
  categoryId: string;
  accountId: string | null;
  cardId: string | null;
  paymentMethod: PaymentMethod | null;
  source: 'default' | 'learned' | 'manual';
  priority: number;
  hits: number;
  lastHitAt: string | null;
  enabled: boolean;
}

export interface CategorizeInput {
  description: string | null;
  merchantCnpj?: string | null;
  paymentMethod?: PaymentMethod;
  kind: TxKind;
  accountId?: string | null; // regra restrita à conta (RN-59/RN-60)
  cardId?: string | null;
}

export interface CategorizeResult {
  categoryId: string;
  ruleId: string;
  confidence: 'high' | 'medium';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * RN-59: o termo aparece em d começando no início de um token ("POSTO" casa "AUTO POSTO", não "IMPOSTO").
 * Termo com menos de 4 caracteres (só seeds, ex.: "TIM") casa apenas como token inteiro (RN-64).
 */
export function tokenPrefixMatch(pattern: string, normalized: string): boolean {
  if (pattern === '') {
    return false;
  }
  const end = pattern.length < 4 ? '(?: |$)' : '';
  return new RegExp(`(?:^| )${escapeRegExp(pattern)}${end}`).test(normalized);
}

export function ruleMatches(
  rule: CategoryRule,
  input: CategorizeInput,
  normalized = normalizeDescription(input.description ?? ''),
): boolean {
  if (!rule.enabled) {
    return false;
  }
  if (rule.accountId !== null && rule.accountId !== (input.accountId ?? null)) {
    return false;
  }
  if (rule.cardId !== null && rule.cardId !== (input.cardId ?? null)) {
    return false;
  }
  if (
    rule.paymentMethod !== null &&
    input.paymentMethod !== undefined &&
    rule.paymentMethod !== input.paymentMethod
  ) {
    return false;
  }
  if (rule.matchField === 'merchant_cnpj') {
    return !!input.merchantCnpj && rule.pattern === input.merchantCnpj;
  }
  if (normalized === '') {
    return false;
  }
  switch (rule.matchType) {
    case 'token_prefix':
      return tokenPrefixMatch(rule.pattern, normalized);
    case 'contains':
      return normalized.includes(rule.pattern);
    case 'starts_with':
      return normalized.startsWith(rule.pattern);
    case 'equals':
      return normalized === rule.pattern;
    case 'regex':
      try {
        return new RegExp(rule.pattern).test(normalized);
      } catch {
        return false; // regex inválida é ignorada
      }
  }
}

function categoryKind(kind: TxKind): Category['kind'] {
  if (kind === 'income' || kind === 'adjust_in') {
    return 'income';
  }
  return kind === 'transfer' ? 'transfer' : 'expense';
}

const SOURCE_RANK: Record<CategoryRule['source'], number> = { manual: 2, learned: 2, default: 1 };

/** RN-60: CNPJ > conta/cartão da transação > termo mais longo > manual/learned > default > uso mais recente. */
export function compareRules(a: CategoryRule, b: CategoryRule): number {
  const keys = (r: CategoryRule) =>
    [
      r.matchField === 'merchant_cnpj' ? 1 : 0,
      r.accountId !== null || r.cardId !== null ? 1 : 0,
      r.pattern.length,
      SOURCE_RANK[r.source],
      r.priority,
    ] as const;
  const ka = keys(a);
  const kb = keys(b);
  for (let i = 0; i < ka.length; i++) {
    const diff = (kb[i] ?? 0) - (ka[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return (b.lastHitAt ?? '').localeCompare(a.lastHitAt ?? '');
}

export function categorize(
  input: CategorizeInput,
  rules: readonly CategoryRule[],
  categories: readonly Category[],
): CategorizeResult | null {
  const normalized = normalizeDescription(input.description ?? '');
  const wanted = categoryKind(input.kind);
  const usable = new Set(
    categories.filter((c) => c.kind === wanted && !c.isSystem).map((c) => c.id),
  );
  const best = rules
    .filter((r) => usable.has(r.categoryId) && ruleMatches(r, input, normalized))
    .sort(compareRules)[0];
  if (!best) {
    return null;
  }
  return {
    categoryId: best.categoryId,
    ruleId: best.id,
    confidence: best.source === 'default' && best.matchField === 'description' ? 'medium' : 'high',
  };
}

export interface RuleChange {
  upsert?: CategoryRule;
  bumpHitsOf?: string;
  previousRule?: CategoryRule | null; // para Desfazer
}

/**
 * RN-62/RN-63: escolha igual à sugestão → bumpHits. Senão cria/atualiza regra 'learned' (token_prefix com a chave do
 * comerciante; com CNPJ, regra por CNPJ). A última correção vence; 'manual' nunca é alterada; termo < 4 caracteres
 * não gera regra.
 */
export function learnFromCorrection(
  input: CategorizeInput,
  chosenCategoryId: string,
  previous: CategorizeResult | null,
  rules: readonly CategoryRule[],
  ctx: DomainCtx,
): RuleChange {
  if (previous && previous.categoryId === chosenCategoryId) {
    return { bumpHitsOf: previous.ruleId };
  }
  const byCnpj = !!input.merchantCnpj;
  const pattern = byCnpj
    ? (input.merchantCnpj as string)
    : merchantKey(normalizeDescription(input.description ?? ''));
  if (pattern === '') {
    return {};
  }
  const matchField: CategoryRule['matchField'] = byCnpj ? 'merchant_cnpj' : 'description';
  const same = rules.find(
    (r) =>
      r.matchField === matchField &&
      r.pattern === pattern &&
      r.accountId === null &&
      r.cardId === null &&
      r.source !== 'default',
  );
  if (same?.source === 'manual') {
    return {};
  }
  if (same) {
    return { upsert: { ...same, categoryId: chosenCategoryId, enabled: true }, previousRule: same };
  }
  return {
    upsert: {
      id: ctx.newId(),
      matchField,
      matchType: byCnpj ? 'equals' : 'token_prefix',
      pattern,
      categoryId: chosenCategoryId,
      accountId: null,
      cardId: null,
      paymentMethod: null,
      source: 'learned',
      priority: 0,
      hits: 0,
      lastHitAt: null,
      enabled: true,
    },
    previousRule: null,
  };
}

/** "Aplicar a mais N parecidos" (RN-62): não revisados ou em "A classificar" que casam com a regra. */
export function similarUnreviewed(
  rule: CategoryRule,
  txs: readonly Tx[],
  unclassifiedCategoryId: string | null = null,
): string[] {
  return txs
    .filter(
      (t) =>
        t.deletedAt === null &&
        t.categoryId !== rule.categoryId &&
        (t.reviewState === 'new' ||
          (unclassifiedCategoryId !== null && t.categoryId === unclassifiedCategoryId)) &&
        ruleMatches(rule, {
          description: t.description,
          merchantCnpj: t.merchantCnpj,
          paymentMethod: t.paymentMethod,
          kind: t.kind,
          accountId: t.accountId,
          cardId: t.cardId,
        }),
    )
    .map((t) => t.id);
}

/** Mapa inicial categoria da Pluggy → slug (tech §6.1.6); conferir com GET /categories na integração. */
export const PROVIDER_CATEGORY_MAP: Readonly<Record<string, string>> = {
  Groceries: 'mercado',
  'Gas stations': 'combustivel',
  Pharmacy: 'saude',
  'Eating out': 'restaurantes-delivery',
  'Food delivery': 'restaurantes-delivery',
  'Taxi and ride-hailing': 'transporte',
  'Video streaming': 'assinaturas',
  'Music streaming': 'assinaturas',
  Electricity: 'contas-da-casa',
  Water: 'contas-da-casa',
  Internet: 'contas-da-casa',
  Telecommunications: 'contas-da-casa',
  Rent: 'moradia',
  Salary: 'salario',
  'Credit card payment': 'pagamento-fatura',
  'Same person transfer': 'transferencia-entre-contas',
};

export function suggestFromProvider(
  providerCategory: string | null,
  categories: readonly Category[],
): string | null {
  const slug = providerCategory ? PROVIDER_CATEGORY_MAP[providerCategory] : undefined;
  return (slug && categories.find((c) => c.slug === slug)?.id) || null;
}
