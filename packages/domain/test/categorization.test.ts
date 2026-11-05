import { describe, expect, it } from 'vitest';
import {
  type CategorizeInput,
  type CategoryRule,
  categorize,
  learnFromCorrection,
  merchantKey,
  normalizeDescription,
  ruleMatches,
  similarUnreviewed,
  suggestFromProvider,
  tokenPrefixMatch,
} from '../src/categorization.ts';
import { DEFAULT_CATEGORIES, DEFAULT_REMINDERS, DEFAULT_RULES } from '../src/defaults.ts';
import type { Category, Tx } from '../src/types.ts';

const categories: Category[] = DEFAULT_CATEGORIES.map((c) => ({
  id: c.slug,
  parentId: null,
  kind: c.kind,
  bucket: c.bucket,
  slug: c.slug,
  feedsReserve: c.feedsReserve,
  isSystem: c.isSystem,
}));
categories.push({
  id: 'lanches',
  parentId: null,
  kind: 'expense',
  bucket: 'wants',
  slug: null,
  feedsReserve: false,
  isSystem: false,
});

let n = 0;
function rule(over: Partial<CategoryRule>): CategoryRule {
  n += 1;
  return {
    id: `r-${n}`,
    matchField: 'description',
    matchType: 'token_prefix',
    pattern: 'X',
    categoryId: 'mercado',
    accountId: null,
    cardId: null,
    paymentMethod: null,
    source: 'default',
    priority: 0,
    hits: 0,
    lastHitAt: null,
    enabled: true,
    ...over,
  };
}
const seeds = DEFAULT_RULES.map((r) =>
  rule({ pattern: r.pattern, categoryId: r.slug, id: `seed-${r.pattern}` }),
);
const expense = (description: string, over: Partial<CategorizeInput> = {}): CategorizeInput => ({
  description,
  kind: 'expense',
  ...over,
});
const ctx = { today: '2026-11-05', newId: () => 'nova-regra' };

describe('RN-57/RN-58: normalização', () => {
  it.each([
    ['PAG*PostoIpiranga 1234 - Campo Mourão', 'POSTOIPIRANGA CAMPO MOURAO'],
    ['COMPRA CARTAO - POSTO IPIRANGA 1234 CAMPO MOURAO 05/11', 'POSTO IPIRANGA CAMPO MOURAO'],
    ['Pix enviado - Farmácia São João LTDA', 'FARMACIA SAO JOAO'],
    ['  99APP   corrida  ', 'CORRIDA'],
    ['', ''],
  ])('RN-57: "%s" → "%s"', (raw, normalized) => {
    expect(normalizeDescription(raw)).toBe(normalized);
  });

  it('RN-62: chave do comerciante com 2 tokens, até 30 caracteres, vazia abaixo de 4', () => {
    expect(merchantKey('POSTO IPIRANGA CAMPO MOURAO')).toBe('POSTO IPIRANGA');
    expect(merchantKey('UNIMED PARANA')).toBe('UNIMED PARANA');
    expect(merchantKey('BAR')).toBe('');
    expect(merchantKey('ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF GHI')).toHaveLength(30);
  });
});

describe('RN-59: casamento por início de token (US-28)', () => {
  it.each([
    ['POSTO', 'PAG*PostoIpiranga 1234 - Campo Mourão', true],
    ['POSTO', 'AUTO POSTO SÃO JOSÉ', true],
    ['POSTO', 'IMPOSTO MUNICIPAL', false],
    ['MERCADO', 'SUPERMERCADO BOM PRECO', false],
  ] as const)('US-28: termo "%s" e "%s" → %s', (term, description, expected) => {
    expect(tokenPrefixMatch(term, normalizeDescription(description))).toBe(expected);
  });

  it('RN-64: "TIM" casa só como token inteiro', () => {
    expect(tokenPrefixMatch('TIM', 'TIM CELULAR')).toBe(true);
    expect(tokenPrefixMatch('TIM', 'RECARGA TIM')).toBe(true);
    expect(tokenPrefixMatch('TIM', 'TIMBRE MUSICAL')).toBe(false);
    expect(tokenPrefixMatch('', 'X')).toBe(false);
  });

  it('outros tipos de casamento, regex inválida e restrições', () => {
    expect(
      ruleMatches(rule({ matchType: 'contains', pattern: 'PIRANGA' }), expense('POSTO IPIRANGA')),
    ).toBe(true);
    expect(
      ruleMatches(rule({ matchType: 'starts_with', pattern: 'POSTO' }), expense('AUTO POSTO')),
    ).toBe(false);
    expect(ruleMatches(rule({ matchType: 'equals', pattern: 'UBER' }), expense('UBER'))).toBe(true);
    expect(ruleMatches(rule({ matchType: 'regex', pattern: '^UB.R$' }), expense('UBER'))).toBe(
      true,
    );
    expect(ruleMatches(rule({ matchType: 'regex', pattern: '(' }), expense('UBER'))).toBe(false);
    expect(ruleMatches(rule({ pattern: 'UBER', enabled: false }), expense('UBER'))).toBe(false);
    expect(
      ruleMatches(rule({ pattern: 'UBER', accountId: 'bb' }), expense('UBER', { accountId: 'nu' })),
    ).toBe(false);
    expect(
      ruleMatches(rule({ pattern: 'UBER', cardId: 'c1' }), expense('UBER', { cardId: 'c1' })),
    ).toBe(true);
    expect(
      ruleMatches(
        rule({ pattern: 'UBER', paymentMethod: 'pix' }),
        expense('UBER', { paymentMethod: 'credit' }),
      ),
    ).toBe(false);
    expect(ruleMatches(rule({ pattern: 'UBER' }), expense(''))).toBe(false);
    expect(
      ruleMatches(
        rule({ matchField: 'merchant_cnpj', pattern: '11222333000144' }),
        expense('', { merchantCnpj: '11222333000144' }),
      ),
    ).toBe(true);
  });
});

describe('RN-60: precedência', () => {
  it('US-28: o termo mais longo vence ("POSTO SHELL SELECT" → Lanches)', () => {
    const rules = [
      ...seeds,
      rule({ pattern: 'POSTO SHELL SELECT', categoryId: 'lanches', source: 'manual' }),
    ];
    expect(categorize(expense('POSTO SHELL SELECT MOURAO'), rules, categories)?.categoryId).toBe(
      'lanches',
    );
  });

  it('regra da conta vence a sem conta; CNPJ vence tudo', () => {
    const rules = [
      rule({ pattern: 'POSTO IPIRANGA', categoryId: 'combustivel', source: 'learned' }),
      rule({ pattern: 'POSTO', categoryId: 'transporte', accountId: 'bb', source: 'manual' }),
    ];
    expect(
      categorize(expense('POSTO IPIRANGA', { accountId: 'bb' }), rules, categories)?.categoryId,
    ).toBe('transporte');
    const withCnpj = [
      ...rules,
      rule({
        matchField: 'merchant_cnpj',
        matchType: 'equals',
        pattern: '11222333000144',
        categoryId: 'mercado',
        source: 'learned',
      }),
    ];
    expect(
      categorize(
        expense('POSTO IPIRANGA', { accountId: 'bb', merchantCnpj: '11222333000144' }),
        withCnpj,
        categories,
      ),
    ).toMatchObject({ categoryId: 'mercado', confidence: 'high' });
  });

  it('empate de tamanho: aprendida vence padrão; depois o uso mais recente', () => {
    const rules = [
      rule({ pattern: 'UBER', categoryId: 'transporte' }),
      rule({ pattern: 'UBER', categoryId: 'lazer', source: 'learned' }),
    ];
    expect(categorize(expense('UBER TRIP'), rules, categories)?.categoryId).toBe('lazer');
    const recent = [
      rule({
        pattern: 'UBER',
        categoryId: 'transporte',
        source: 'learned',
        lastHitAt: '2026-10-01T00:00:00Z',
      }),
      rule({
        pattern: 'UBER',
        categoryId: 'lazer',
        source: 'learned',
        lastHitAt: '2026-11-01T00:00:00Z',
      }),
    ];
    expect(categorize(expense('UBER TRIP'), recent, categories)?.categoryId).toBe('lazer');
  });

  it('só categorias compatíveis com o tipo e que não são de sistema', () => {
    const rules = [rule({ pattern: 'SALARIO', categoryId: 'salario' })];
    expect(categorize(expense('SALARIO EMPRESA'), rules, categories)).toBeNull();
    expect(
      categorize({ description: 'SALARIO EMPRESA', kind: 'income' }, rules, categories)?.categoryId,
    ).toBe('salario');
    expect(
      categorize(expense('X'), [rule({ pattern: 'X', categoryId: 'a-classificar' })], categories),
    ).toBeNull();
    expect(categorize({ description: 'TRANSF', kind: 'transfer' }, [], categories)).toBeNull();
  });
});

describe('RN-62/RN-63: aprendizado', () => {
  it('§5.8: posto Ipiranga vira combustível pela padrão; a correção cria a aprendida que passa a vencer', () => {
    const description = 'COMPRA CARTAO - POSTO IPIRANGA 1234 CAMPO MOURAO 05/11';
    const first = categorize(expense(description), seeds, categories);
    expect(first).toMatchObject({
      categoryId: 'combustivel',
      ruleId: 'seed-IPIRANGA', // POSTO e IPIRANGA casam; o termo mais longo decide (RN-60)
      confidence: 'medium',
    });
    const change = learnFromCorrection(expense(description), 'transporte', first, seeds, ctx);
    expect(change.upsert).toMatchObject({
      id: 'nova-regra',
      pattern: 'POSTO IPIRANGA',
      categoryId: 'transporte',
      source: 'learned',
      matchType: 'token_prefix',
    });
    expect(change.previousRule).toBeNull();
    const rules = [...seeds, change.upsert as CategoryRule];
    expect(categorize(expense(description), rules, categories)?.categoryId).toBe('transporte');
  });

  it('US-28: "UNIMED PARANA 0001" corrigido para Saúde cria "UNIMED PARANA"', () => {
    expect(
      learnFromCorrection(expense('UNIMED PARANA 0001'), 'saude', null, [], ctx).upsert?.pattern,
    ).toBe('UNIMED PARANA');
  });

  it('US-28: termo curto ("BAR") não cria regra', () => {
    expect(learnFromCorrection(expense('BAR'), 'lazer', null, [], ctx)).toEqual({});
  });

  it('escolha igual à sugestão só soma acerto', () => {
    expect(
      learnFromCorrection(
        expense('UBER'),
        'transporte',
        { categoryId: 'transporte', ruleId: 'r', confidence: 'medium' },
        [],
        ctx,
      ),
    ).toEqual({ bumpHitsOf: 'r' });
  });

  it('RN-63: a última correção vence e guarda a anterior para Desfazer; manual nunca muda', () => {
    const learned = rule({
      id: 'aprendida',
      pattern: 'POSTO IPIRANGA',
      categoryId: 'transporte',
      source: 'learned',
    });
    const change = learnFromCorrection(
      expense('POSTO IPIRANGA'),
      'combustivel',
      null,
      [learned],
      ctx,
    );
    expect(change.upsert).toMatchObject({ id: 'aprendida', categoryId: 'combustivel' });
    expect(change.previousRule).toEqual(learned);
    const manual = rule({ pattern: 'POSTO IPIRANGA', categoryId: 'transporte', source: 'manual' });
    expect(
      learnFromCorrection(expense('POSTO IPIRANGA'), 'combustivel', null, [manual], ctx),
    ).toEqual({});
  });

  it('com CNPJ, aprende por CNPJ', () => {
    expect(
      learnFromCorrection(
        expense('X', { merchantCnpj: '11222333000144' }),
        'mercado',
        null,
        [],
        ctx,
      ).upsert,
    ).toMatchObject({
      matchField: 'merchant_cnpj',
      matchType: 'equals',
      pattern: '11222333000144',
    });
  });

  it('RN-62: "Aplicar a mais N parecidos" pega não revisados e "A classificar"', () => {
    const r = rule({ pattern: 'UNIMED PARANA', categoryId: 'saude', source: 'learned' });
    const base = {
      kind: 'expense',
      status: 'posted',
      paymentMethod: 'pix',
      accountId: 'bb',
      cardId: null,
      merchantCnpj: null,
      deletedAt: null,
    } as const;
    const txs = [
      {
        ...base,
        id: 'a',
        description: 'UNIMED PARANA 0002',
        reviewState: 'new',
        categoryId: 'a-classificar',
      },
      {
        ...base,
        id: 'b',
        description: 'UNIMED PARANA 0003',
        reviewState: 'ok',
        categoryId: 'a-classificar',
      },
      {
        ...base,
        id: 'c',
        description: 'UNIMED PARANA 0004',
        reviewState: 'ok',
        categoryId: 'mercado',
      },
      {
        ...base,
        id: 'd',
        description: 'OUTRA COISA',
        reviewState: 'new',
        categoryId: 'a-classificar',
      },
      { ...base, id: 'e', description: 'UNIMED PARANA', reviewState: 'new', categoryId: 'saude' },
    ] as unknown as Tx[];
    expect(similarUnreviewed(r, txs, 'a-classificar')).toEqual(['a', 'b']);
    expect(similarUnreviewed(r, txs)).toEqual(['a']);
  });
});

describe('dados padrão (RN-40, RN-64)', () => {
  it('RN-40: categorias padrão, faixas e categorias de sistema', () => {
    const bySlug = new Map(DEFAULT_CATEGORIES.map((c) => [c.slug, c]));
    expect(DEFAULT_CATEGORIES.filter((c) => c.bucket === 'needs')).toHaveLength(11);
    expect(DEFAULT_CATEGORIES.filter((c) => c.bucket === 'wants')).toHaveLength(8);
    expect(
      DEFAULT_CATEGORIES.filter((c) => c.bucket === 'savings').every((c) => c.feedsReserve),
    ).toBe(true);
    expect(DEFAULT_CATEGORIES.filter((c) => c.kind === 'income')).toHaveLength(5);
    expect(bySlug.get('a-classificar')).toMatchObject({ isSystem: true, bucket: 'none' });
    expect(bySlug.get('saldo-credor')).toMatchObject({ isSystem: true, bucket: 'none' });
    expect(new Set(DEFAULT_CATEGORIES.map((c) => c.slug)).size).toBe(DEFAULT_CATEGORIES.length);
  });

  it('RN-64: regras padrão apontam para categorias existentes', () => {
    const slugs = new Set(DEFAULT_CATEGORIES.map((c) => c.slug));
    expect(DEFAULT_RULES).toHaveLength(32);
    expect(
      DEFAULT_RULES.every(
        (r) => slugs.has(r.slug) && normalizeDescription(r.pattern) === r.pattern,
      ),
    ).toBe(true);
    expect(DEFAULT_REMINDERS.find((r) => r.kind === 'daily_log')?.localTime).toBe('20:00');
  });

  it('mapa da Pluggy → slug', () => {
    expect(suggestFromProvider('Groceries', categories)).toBe('mercado');
    expect(suggestFromProvider('Desconhecida', categories)).toBeNull();
    expect(suggestFromProvider(null, categories)).toBeNull();
  });
});
