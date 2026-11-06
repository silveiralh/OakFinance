import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import {
  DEFAULT_RECON_OPTIONS,
  directionOf,
  importedDedupKey,
  matchWindowDays,
  planMerge,
  type ReconItem,
  reconcile,
} from '../src/reconciliation.ts';

let seq = 0;
function item(over: Partial<ReconItem>): ReconItem {
  seq += 1;
  return {
    id: `tx-${seq}`,
    kind: 'expense',
    amountCents: 1000,
    occurredOn: '2026-11-05',
    accountId: 'acc-bb',
    cardId: null,
    description: null,
    source: 'manual',
    externalId: null,
    installmentNumber: null,
    installmentCount: null,
    matchedExternal: false,
    reviewState: 'ok',
    ...over,
  };
}

const MEIOS = {
  'Crédito Nubank': { accountId: null, cardId: 'card-nu', paymentMethod: 'credit' },
  'Pix BB': { accountId: 'acc-bb', cardId: null, paymentMethod: 'pix' },
  'Débito BB': { accountId: 'acc-bb', cardId: null, paymentMethod: 'debit' },
} as const;

function one(imported: ReconItem, existing: ReconItem[]) {
  const [action] = reconcile([imported], existing, DEFAULT_RECON_OPTIONS);
  return action;
}

describe('reconcile (US-48, RN-66, RN-67)', () => {
  it.each([
    ['Crédito Nubank', 4590, '2026-11-05', 4590, '2026-11-07', 'auto_merge'],
    ['Crédito Nubank', 4590, '2026-11-05', 4590, '2026-11-09', 'new'],
    ['Pix BB', 12000, '2026-11-05', 12000, '2026-11-06', 'auto_merge'],
    ['Pix BB', 12000, '2026-11-05', 12000, '2026-11-07', 'new'],
    ['Débito BB', 5000, '2026-11-05', 5150, '2026-11-05', 'suggest'],
    ['Débito BB', 30000, '2026-11-05', 30600, '2026-11-06', 'suggest'],
    ['Débito BB', 30000, '2026-11-05', 30601, '2026-11-06', 'new'],
  ] as const)(
    'US-48: %s, L=%i em %s, T=%i em %s → %s',
    (meio, valorL, dataL, valorT, dataT, esperado) => {
      const m = MEIOS[meio];
      const manual = item({ ...m, amountCents: valorL, occurredOn: dataL });
      const bank = item({
        accountId: m.accountId,
        cardId: m.cardId,
        amountCents: valorT,
        occurredOn: dataT,
        source: 'pluggy',
        externalId: 'ext-1',
        reviewState: 'new',
      });
      const action = one(bank, [manual]);
      expect(action?.action).toBe(esperado);
      if (action?.action === 'auto_merge') {
        expect(action.matchId).toBe(manual.id);
      }
      if (action?.action === 'suggest') {
        expect(action).toEqual({
          importedId: bank.id,
          action: 'suggest',
          matchIds: [manual.id],
          reason: 'approx',
        });
      }
    },
  );

  it('US-48: dois cafés — concilia com o de menor diferença de data, depois com o outro', () => {
    const cafe5 = item({
      cardId: 'card-nu',
      accountId: null,
      amountCents: 500,
      occurredOn: '2026-11-05',
    });
    const cafe6 = item({
      cardId: 'card-nu',
      accountId: null,
      amountCents: 500,
      occurredOn: '2026-11-06',
    });
    const t1 = item({
      cardId: 'card-nu',
      accountId: null,
      amountCents: 500,
      occurredOn: '2026-11-06',
      source: 'pluggy',
    });
    const t2 = item({
      cardId: 'card-nu',
      accountId: null,
      amountCents: 500,
      occurredOn: '2026-11-06',
      source: 'pluggy',
    });
    const actions = reconcile([t1, t2], [cafe5, cafe6], DEFAULT_RECON_OPTIONS);
    expect(actions).toEqual([
      { importedId: t1.id, action: 'auto_merge', matchId: cafe6.id },
      { importedId: t2.id, action: 'auto_merge', matchId: cafe5.id },
    ]);
  });

  it('US-48: empate verdadeiro fica pendente com os dois candidatos', () => {
    const a = item({
      cardId: 'card-nu',
      accountId: null,
      amountCents: 500,
      occurredOn: '2026-11-05',
    });
    const b = item({
      cardId: 'card-nu',
      accountId: null,
      amountCents: 500,
      occurredOn: '2026-11-05',
    });
    const t = item({
      cardId: 'card-nu',
      accountId: null,
      amountCents: 500,
      occurredOn: '2026-11-06',
      source: 'pluggy',
    });
    expect(one(t, [a, b])).toEqual({
      importedId: t.id,
      action: 'suggest',
      matchIds: [a.id, b.id].sort(),
      reason: 'tie',
    });
  });

  it('RN-67: um empate não reserva os candidatos para a próxima transação', () => {
    const a = item({ amountCents: 700, occurredOn: '2026-11-05', paymentMethod: 'debit' });
    const b = item({ amountCents: 700, occurredOn: '2026-11-05', paymentMethod: 'debit' });
    const t1 = item({ amountCents: 700, occurredOn: '2026-11-06', source: 'ofx' });
    const t2 = item({ amountCents: 700, occurredOn: '2026-11-07', source: 'ofx' });
    const [r1, r2] = reconcile([t1, t2], [a, b], DEFAULT_RECON_OPTIONS);
    expect(r1?.action).toBe('suggest');
    expect(r2?.action).toBe('suggest');
  });

  it('RN-67: processa os importados em ordem de data, mesmo fora de ordem na entrada', () => {
    const l = item({ amountCents: 900, occurredOn: '2026-11-05', paymentMethod: 'debit' });
    const tarde = item({ amountCents: 900, occurredOn: '2026-11-08', source: 'csv' });
    const cedo = item({ amountCents: 900, occurredOn: '2026-11-06', source: 'csv' });
    const [rTarde, rCedo] = reconcile([tarde, cedo], [l], DEFAULT_RECON_OPTIONS);
    expect(rCedo).toEqual({ importedId: cedo.id, action: 'auto_merge', matchId: l.id });
    expect(rTarde?.action).toBe('new');
  });

  it('RN-66: só candidatos manuais, não conciliados, não cancelados, mesma direção e mesma conta', () => {
    const base = { amountCents: 2500, occurredOn: '2026-11-05', paymentMethod: 'debit' as const };
    const t = item({ ...base, source: 'pluggy' });
    const candidatos = [
      item({ ...base, matchedExternal: true }),
      item({ ...base, cancelled: true }),
      item({ ...base, kind: 'income' }),
      item({ ...base, accountId: 'acc-outra' }),
      item({ ...base, source: 'ofx' as const, kind: 'income' }),
      item({ ...base, occurredOn: '2026-07-01' }),
    ];
    expect(one(t, candidatos)?.action).toBe('new');
  });

  it('RN-66: janela de 5 dias para recorrência, 1 dia para NFC-e em qualquer conta', () => {
    const rec = item({ source: 'recurrence', amountCents: 15000, occurredOn: '2026-11-01' });
    const t = item({ source: 'pluggy', amountCents: 15000, occurredOn: '2026-11-06' });
    expect(one(t, [rec])).toEqual({ importedId: t.id, action: 'auto_merge', matchId: rec.id });

    const manual = item({ accountId: 'acc-nu', amountCents: 3299, occurredOn: '2026-11-05' });
    const nota = item({
      source: 'nfce',
      accountId: null,
      amountCents: 3299,
      occurredOn: '2026-11-06',
    });
    expect(one(nota, [manual])).toEqual({
      importedId: nota.id,
      action: 'auto_merge',
      matchId: manual.id,
    });
    expect(matchWindowDays(nota, manual, DEFAULT_RECON_OPTIONS)).toBe(1);
  });

  it('RN-66: sem meio informado, PIX/TED/BOLETO na descrição dão janela de 1 dia; o resto, 3', () => {
    const o = DEFAULT_RECON_OPTIONS;
    const t = item({ source: 'pluggy' });
    expect(
      matchWindowDays(item({ source: 'pluggy', description: 'PIX ENVIADO JOAO' }), item({}), o),
    ).toBe(1);
    expect(
      matchWindowDays(item({ source: 'pluggy', description: 'TED 001 MARIA' }), item({}), o),
    ).toBe(1);
    expect(
      matchWindowDays(item({ source: 'pluggy', description: 'PAGTO BOLETO' }), item({}), o),
    ).toBe(1);
    expect(matchWindowDays(t, item({ paymentMethod: 'transfer' }), o)).toBe(1);
    expect(matchWindowDays(t, item({ paymentMethod: 'boleto' }), o)).toBe(1);
    expect(
      matchWindowDays(item({ source: 'pluggy', description: 'COMPRA CARTAO' }), item({}), o),
    ).toBe(3);
  });

  it('RN-67.3: aproximado só vale fora do valor exato; o mais próximo vem primeiro', () => {
    const longe = item({ amountCents: 10000, occurredOn: '2026-11-05', paymentMethod: 'debit' });
    const perto = item({ amountCents: 10050, occurredOn: '2026-11-05', paymentMethod: 'debit' });
    const t = item({ amountCents: 10100, occurredOn: '2026-11-07', source: 'pluggy' });
    expect(one(t, [longe, perto])).toEqual({
      importedId: t.id,
      action: 'suggest',
      matchIds: [perto.id, longe.id],
      reason: 'approx',
    });
  });

  it('transferências não entram na conciliação (RN-71 cuida delas)', () => {
    const l = item({ kind: 'transfer', amountCents: 800 });
    const t = item({ kind: 'transfer', amountCents: 800, source: 'pluggy' });
    expect(one(t, [l])?.action).toBe('new');
    expect(directionOf('transfer')).toBeNull();
    expect(directionOf('refund')).toBe('in');
    expect(directionOf('adjust_out')).toBe('out');
  });
});

describe('RN-72: duplicidade entre fontes', () => {
  it('US-48: OFX igual a uma transação do Open Finance vira duplicada', () => {
    const pluggy = item({
      source: 'pluggy',
      externalId: 'p-1',
      amountCents: 8900,
      reviewState: 'ok',
    });
    const ofx = item({ source: 'ofx', externalId: 'FIT9', amountCents: 8900 });
    expect(one(ofx, [pluggy])).toEqual({
      importedId: ofx.id,
      action: 'duplicate',
      ofImportedId: pluggy.id,
    });
  });

  it('RN-72: pareamento 1:1 — duas compras iguais no mesmo dia só se anulam par a par', () => {
    const p1 = item({ source: 'pluggy', amountCents: 1200 });
    const p2 = item({ source: 'pluggy', amountCents: 1200 });
    const o1 = item({ source: 'ofx', amountCents: 1200 });
    const o2 = item({ source: 'ofx', amountCents: 1200 });
    const o3 = item({ source: 'ofx', amountCents: 1200 });
    const actions = reconcile([o1, o2, o3], [p1, p2], DEFAULT_RECON_OPTIONS);
    expect(actions.map((a) => a.action)).toEqual(['duplicate', 'duplicate', 'new']);
    const dupOf = actions.flatMap((a) => (a.action === 'duplicate' ? [a.ofImportedId] : []));
    expect(new Set(dupOf)).toEqual(new Set([p1.id, p2.id]));
  });

  it('RN-72: mesma fonte, outra conta, valor diferente ou mais de 1 dia não é duplicata; NFC-e nunca é', () => {
    const p = item({ source: 'pluggy', amountCents: 4000, occurredOn: '2026-11-05' });
    expect(one(item({ source: 'pluggy', amountCents: 4000 }), [p])?.action).toBe('new');
    expect(one(item({ source: 'ofx', amountCents: 4000, accountId: 'acc-x' }), [p])?.action).toBe(
      'new',
    );
    expect(one(item({ source: 'ofx', amountCents: 4001 }), [p])?.action).toBe('new');
    expect(
      one(item({ source: 'ofx', amountCents: 4000, occurredOn: '2026-11-07' }), [p])?.action,
    ).toBe('new');
    expect(one(item({ source: 'nfce', amountCents: 4000 }), [p])?.action).toBe('new');
  });
});

describe('planMerge (RN-68)', () => {
  it('US-48: o resultado preserva a descrição do manual', () => {
    const manual = item({ description: 'Mercado do Zé', amountCents: 5000 });
    const bank = item({
      source: 'pluggy',
      description: 'SUPERMERC ZE LTDA 4432',
      amountCents: 5000,
    });
    expect(planMerge(bank, manual, { approx: false })).toEqual({
      importedPatch: { reviewState: 'merged', duplicateOf: manual.id },
      manualPatch: { matchedExternal: true, status: 'posted' },
    });
  });

  it('RN-68: manual sem descrição recebe a do banco; aproximado recebe o valor do banco', () => {
    const manual = item({ description: '  ', amountCents: 5000 });
    const bank = item({ source: 'pluggy', description: 'SUPERMERC ZE', amountCents: 5150 });
    expect(planMerge(bank, manual, { approx: true }).manualPatch).toEqual({
      matchedExternal: true,
      status: 'posted',
      description: 'SUPERMERC ZE',
      amountCents: 5150,
    });
  });

  it('RN-68/RN-19: a fatura informada pelo banco prevalece e fica fixada', () => {
    const manual = item({ cardId: 'card-nu', amountCents: 999 });
    const bank = item({ source: 'pluggy', cardId: 'card-nu', amountCents: 999, description: null });
    expect(planMerge(bank, manual, { approx: true, bankInvoiceId: 'inv-1' }).manualPatch).toEqual({
      matchedExternal: true,
      status: 'posted',
      invoiceId: 'inv-1',
      invoicePinned: true,
    });
  });
});

describe('importedDedupKey (RN-65)', () => {
  const base = {
    date: '2026-11-05',
    amountCents: -4590,
    description: 'Padaria São João',
    ordinal: 0,
  };

  it('RN-65: Open Finance usa o id do agregador', () => {
    expect(importedDedupKey('pluggy', { ...base, externalId: 'abc-123' })).toBe('abc-123');
    expect(() => importedDedupKey('pluggy', base)).toThrow(DomainError);
  });

  it('RN-65: OFX usa FITID|data|valor (o BB repete FITID)', () => {
    expect(importedDedupKey('ofx', { ...base, fitId: ' 0001 ' })).toBe('0001|2026-11-05|-4590');
    expect(importedDedupKey('ofx', { ...base, fitId: '0001', amountCents: 100 })).toBe(
      '0001|2026-11-05|100',
    );
  });

  it('RN-65: CSV sem id usa hash determinístico com ordinal para linhas idênticas', () => {
    const k0 = importedDedupKey('csv', base);
    const k1 = importedDedupKey('csv', { ...base, ordinal: 1 });
    expect(k0).toMatch(/^[0-9a-f-]{36}$/);
    expect(importedDedupKey('csv', base)).toBe(k0);
    expect(k1).not.toBe(k0);
    expect(importedDedupKey('csv', { ...base, description: '  padaria   sao joao ' })).toBe(k0);
    expect(importedDedupKey('csv', { ...base, amountCents: -4591 })).not.toBe(k0);
    expect(importedDedupKey('csv', { ...base, externalId: 'id-7' })).toBe('id-7|2026-11-05|-4590');
  });

  it('RN-65: OFX sem FITID cai no hash de data, valor, descrição e ordem', () => {
    const semFit = importedDedupKey('ofx', base);
    expect(semFit).toMatch(/^[0-9a-f-]{36}$/);
    expect(semFit).not.toBe(importedDedupKey('csv', base));
    expect(() => importedDedupKey('csv', { ...base, ordinal: -1 })).toThrow(DomainError);
    expect(() => importedDedupKey('csv', { ...base, ordinal: 1.5 })).toThrow(DomainError);
  });
});
