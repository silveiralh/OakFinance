/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseSignedCents } from '../src/imports/common.ts';
import { CSV_PRESETS, type CsvProfile, mapCsvRows, sniffCsvProfile } from '../src/imports/csv.ts';
import { decodeOfxBytes, ofxToImportRows, parseOfx } from '../src/imports/ofx.ts';
import { importedDedupKey } from '../src/reconciliation.ts';

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

/** Tokenização mínima para as fixtures (sem aspas); no app quem faz isso é o papaparse. */
// Tokenização mínima só para os testes (no app é o papaparse): vírgula como separador e campos entre aspas.
const csvLine = (line: string): string[] =>
  line === ''
    ? ['']
    : [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)]
        .slice(0, -1)
        .map((m) => (m[1] ?? '').replace(/^"(.*)"$/, '$1').replaceAll('""', '"'));
const csvRows = (name: string): string[][] =>
  new TextDecoder().decode(fixture(name)).replace(/\n$/, '').split('\n').map(csvLine);

function domainError(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) {
      return e;
    }
    throw e;
  }
  throw new Error('esperava DomainError');
}

const encode = (text: string) => new TextEncoder().encode(text);

const preset = (id: string): CsvProfile => {
  const p = CSV_PRESETS.find((x) => x.id === id);
  if (!p) {
    throw new Error(`preset ${id}`);
  }
  return p;
};

describe('parseSignedCents (RN-75, RN-76)', () => {
  it.each([
    ['-123.45', 'auto', -12_345],
    ['-123,45', 'auto', -12_345],
    ['1.234,56', 'auto', 123_456],
    ['1,234.56', 'auto', 123_456],
    ['+10', 'auto', 1_000],
    ['10.500', 'auto', 1_050],
    ['R$ 12,5', ',', 1_250],
    ['−7,00', ',', -700],
    ['7,00-', ',', -700],
    ['-R$ 3,00', ',', -300],
    ['1.234.567,89', ',', 123_456_789],
    [',5', ',', 50],
    ['-0,00', ',', 0],
    ['100', '.', 10_000],
  ] as const)('"%s" (%s) → %i', (raw, decimal, expected) => {
    expect(parseSignedCents(raw, decimal)).toBe(expected);
  });

  it.each([
    ['', 'auto'],
    ['abc', 'auto'],
    ['1,2,3', ','],
    ['12.34.56', '.'],
    ['1.23', ','],
    ['12,34,5', '.'],
    ['1,23.4', ','],
    ['10.501', 'auto'],
    ['-', 'auto'],
    ['.', '.'],
    ['99999999999999999999', '.'],
  ] as const)('"%s" (%s) é inválido', (raw, decimal) => {
    expect(parseSignedCents(raw, decimal)).toBeNull();
  });
});

describe('decodeOfxBytes (US-52, RN-75)', () => {
  it('US-52: OFX em Windows-1252 mostra "PAGAMENTO CONTA ÁGUA" com acento correto', () => {
    const text = decodeOfxBytes(fixture('bb-sgml-1252.ofx'));
    expect(text).toContain('PAGAMENTO CONTA ÁGUA');
    expect(text).toContain('SALÁRIO EMPRESA FICTÍCIA');
  });

  it('RN-75: UTF-8 declarado no XML e sem BOM', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...fixture('cartao-ofx2-utf8.ofx')]);
    const text = decodeOfxBytes(bom);
    expect(text.startsWith('<?xml')).toBe(true);
    expect(text).toContain('Pão &amp; Café Fictício');
  });

  it('RN-75: sem codificação útil, tenta UTF-8 e cai para Windows-1252', () => {
    const utf8 = encode('ENCODING:USASCII\nCHARSET:NONE\n<OFX><MEMO>ÁGUA</OFX>');
    expect(decodeOfxBytes(utf8)).toContain('ÁGUA');
    const latin = new Uint8Array([...encode('CHARSET:NONE\n<OFX><MEMO>'), 0xc1, ...encode('GUA')]);
    expect(decodeOfxBytes(latin)).toContain('ÁGUA');
    expect(decodeOfxBytes(encode('ENCODING:UTF-8\n<OFX>ação'))).toContain('ação');
    expect(decodeOfxBytes(new Uint8Array([...encode('CHARSET:ISO-8859-1\n'), 0xe7]))).toContain(
      'ç',
    );
  });

  it('US-52: arquivo com mais de 5 MB é recusado', () => {
    const big = new Uint8Array(MAX_IMPORT_BYTES + 1);
    expect(domainError(() => decodeOfxBytes(big)).code).toBe('IMPORT_TOO_LARGE');
    expect(() => decodeOfxBytes(new Uint8Array(MAX_IMPORT_BYTES))).not.toThrow();
  });
});

describe('parseOfx (US-52, RN-75)', () => {
  it('US-52 (T-085): OFX real do BB anonimizado — tags com fechamento, LF, DTPOSTED com [-3:BRT], FITID de 15 dígitos e MEMO "dd/mm hh:mm nome"', () => {
    const bytes = fixture('bb-real-anon.ofx');
    // o arquivo real vem com LF (não CRLF) e tags fechadas
    expect(bytes.includes(13)).toBe(false);
    const [st, ...rest] = parseOfx(decodeOfxBytes(bytes));
    expect(rest).toEqual([]);
    expect(st).toMatchObject({
      kind: 'bank',
      bankId: '1',
      acctIdMasked: '****00-0',
      currency: 'BRL',
      startOn: '2024-10-01',
      endOn: '2024-10-28',
      ledgerBalanceCents: 0,
    });
    expect(st?.transactions).toEqual([
      {
        fitId: '174527591210774',
        trnType: 'DEBIT',
        postedOn: '2024-10-05',
        amountCents: -15_000,
        memo: '13/10 13:27 Maria Ficticia Souza',
        name: 'Pix - Enviado',
        checkNum: '191280',
      },
      {
        fitId: '124519483131075',
        trnType: 'DEBIT',
        postedOn: '2024-10-12',
        amountCents: -3_790,
        memo: '17/10 12:19 Mercado Exemplo Ltda',
        name: 'Pix - Enviado',
        checkNum: '976416',
      },
    ]);
    const rows = ofxToImportRows(st as NonNullable<typeof st>, { accountId: 'bb' });
    expect(rows.map((r) => [r.kind, r.amountCents, r.occurredOn, r.description])).toEqual([
      ['expense', 15_000, '2024-10-05', '13/10 13:27 Maria Ficticia Souza'],
      ['expense', 3_790, '2024-10-12', '17/10 12:19 Mercado Exemplo Ltda'],
    ]);
    // RN-65: a chave vem do FITID, com data e valor com sinal
    expect(rows.map((r) => r.externalKey)).toEqual([
      '174527591210774|2024-10-05|-15000',
      '124519483131075|2024-10-12|-3790',
    ]);
    expect(rows[0]?.extra).toMatchObject({ name: 'Pix - Enviado', checkNum: '191280' });
  });

  it('RN-75 (T-085): OFX real do BB de um mês sem movimento — BANKTRANLIST só com o período, sem erro', () => {
    const [st, ...rest] = parseOfx(decodeOfxBytes(fixture('bb-real-anon-sem-movimento.ofx')));
    expect(rest).toEqual([]);
    expect(st).toMatchObject({
      kind: 'bank',
      bankId: '1',
      startOn: '2024-10-01',
      endOn: '2024-10-28',
    });
    expect(st?.transactions).toEqual([]);
    expect(ofxToImportRows(st as NonNullable<typeof st>, { accountId: 'bb' })).toEqual([]);
  });

  it('RN-75: SGML "Money 2000+" do BB — conta, saldo, período e transações', () => {
    const [st, ...rest] = parseOfx(decodeOfxBytes(fixture('bb-sgml-1252.ofx')));
    expect(rest).toEqual([]);
    expect(st).toMatchObject({
      kind: 'bank',
      bankId: '001',
      acctIdMasked: '****00-X',
      currency: 'BRL',
      startOn: '2026-11-01',
      endOn: '2026-11-05',
      ledgerBalanceCents: 139_260,
    });
    expect(st?.transactions).toEqual([
      {
        fitId: 'FX-0001',
        trnType: 'DEBIT',
        postedOn: '2026-11-03',
        amountCents: -8_790,
        memo: 'PAGAMENTO CONTA ÁGUA',
        name: null,
        checkNum: '000001',
      },
      {
        fitId: 'FX-0001',
        trnType: 'DEBIT',
        postedOn: '2026-11-03',
        amountCents: -1_250,
        memo: '',
        name: 'PIX ENVIADO PADARIA FICTÍCIA',
        checkNum: null,
      },
      {
        fitId: 'FX-0001',
        trnType: 'DEBIT',
        postedOn: '2026-11-03',
        amountCents: -700,
        memo: '',
        name: 'PIX ENVIADO PADARIA FICTÍCIA',
        checkNum: null,
      },
      {
        fitId: 'FX-0002',
        trnType: 'CREDIT',
        postedOn: '2026-11-05',
        amountCents: 150_000,
        memo: '',
        name: 'SALÁRIO EMPRESA FICTÍCIA',
        checkNum: null,
      },
    ]);
  });

  it('RN-75: DTPOSTED "20261105235959[-3:BRT]" fica em 05/11 (data local, sem converter para UTC)', () => {
    const [st] = parseOfx(decodeOfxBytes(fixture('bb-sgml-1252.ofx')));
    expect(st?.transactions.at(-1)?.postedOn).toBe('2026-11-05');
  });

  it('RN-75: XML 2.x de cartão com entidades e MEMO vazio fechado', () => {
    const [st] = parseOfx(decodeOfxBytes(fixture('cartao-ofx2-utf8.ofx')));
    expect(st).toMatchObject({
      kind: 'creditcard',
      bankId: null,
      acctIdMasked: '****0000',
      startOn: '2026-11-02',
      endOn: '2026-12-01',
      ledgerBalanceCents: -14_590,
    });
    expect(st?.transactions.map((t) => [t.name, t.memo, t.amountCents])).toEqual([
      ['Pão & Café Fictício', '', -4_590],
      [null, 'LOJA X 02/10', -10_000],
      [null, 'Pagamento recebido', 98_000],
      [null, 'Ajuste zerado', 0],
    ]);
  });

  it('US-52: arquivo que não é OFX dá OFX_INVALID na linha 1', () => {
    const err = domainError(() => parseOfx('date,title,amount\n2026-11-03,X,1.00'));
    expect(err.code).toBe('OFX_INVALID');
    expect(err.line).toBe(1);
  });

  it('RN-75: OFX_INVALID aponta a linha do valor ou da data com problema', () => {
    const base = (amount: string, date: string) =>
      `OFXHEADER:100\n\n<OFX>\n<BANKMSGSRSV1><STMTTRNRS><STMTRS>\n<BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>${date}\n<TRNAMT>${amount}\n<FITID>1\n</STMTTRN>\n</BANKTRANLIST>\n</STMTRS></STMTTRNRS></BANKMSGSRSV1>\n</OFX>`;
    const amount = domainError(() => parseOfx(base('doze', '20261103')));
    expect([amount.code, amount.line]).toEqual(['OFX_INVALID', 9]);
    expect(amount.message).toContain('linha 9');
    const date = domainError(() => parseOfx(base('-1.00', '20261340')));
    expect([date.code, date.line]).toEqual(['OFX_INVALID', 8]);
    expect(domainError(() => parseOfx(base('-1.00', 'ontem'))).line).toBe(8);
    const ok = parseOfx(base('-1.00', '20261103'));
    expect(ok[0]).toMatchObject({
      bankId: null,
      acctIdMasked: null,
      currency: 'BRL',
      startOn: null,
      ledgerBalanceCents: null,
    });
    expect(ok[0]?.transactions[0]).toMatchObject({ fitId: '1', memo: '', name: null });
  });

  it('RN-75: fechamento sem abertura e OFX sem extrato são inválidos', () => {
    const stray = domainError(() => parseOfx('<OFX>\n<SONRS>\n</STMTRS>\n</OFX>'));
    expect([stray.code, stray.line]).toEqual(['OFX_INVALID', 3]);
    const empty = domainError(() =>
      parseOfx('\n\n<OFX>\n<SIGNONMSGSRSV1>\n</SIGNONMSGSRSV1>\n</OFX>'),
    );
    expect([empty.code, empty.line]).toEqual(['OFX_INVALID', 3]);
  });

  it('RN-75: datas opcionais inválidas viram null; tags auto-fechadas e TRNTYPE ausente', () => {
    const [st] = parseOfx(
      '<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID/></CCACCTFROM>' +
        '<BANKTRANLIST><DTSTART>x</DTSTART><DTEND>20260231</DTEND>' +
        '<STMTTRN><DTPOSTED>20261103</DTPOSTED><TRNAMT>-1.00</TRNAMT><NAME/></STMTTRN>' +
        '</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>',
    );
    expect(st).toMatchObject({
      kind: 'creditcard',
      acctIdMasked: null,
      startOn: null,
      endOn: null,
    });
    expect(st?.transactions[0]).toMatchObject({ trnType: 'OTHER', fitId: '', name: '' });
  });

  it('RN-75: mais de 5.000 transações é recusado', () => {
    const tx = '<STMTTRN><DTPOSTED>20261103<TRNAMT>-1.00</STMTTRN>';
    const doc = (n: number) =>
      `<OFX><STMTRS><BANKTRANLIST>${tx.repeat(n)}</BANKTRANLIST></STMTRS></OFX>`;
    expect(parseOfx(doc(MAX_IMPORT_ROWS))[0]?.transactions).toHaveLength(MAX_IMPORT_ROWS);
    expect(domainError(() => parseOfx(doc(MAX_IMPORT_ROWS + 1))).code).toBe('IMPORT_TOO_LARGE');
    const two = `<OFX>${`<STMTRS><BANKTRANLIST>${tx.repeat(2_501)}</BANKTRANLIST></STMTRS>`.repeat(2)}</OFX>`;
    expect(domainError(() => parseOfx(two)).code).toBe('IMPORT_TOO_LARGE');
  });
});

describe('ofxToImportRows (US-52, RN-65, RN-75)', () => {
  const bb = () => {
    const [st] = parseOfx(decodeOfxBytes(fixture('bb-sgml-1252.ofx')));
    if (!st) {
      throw new Error('extrato');
    }
    return st;
  };

  it('RN-75: negativo = saída; descrição = MEMO, senão NAME; extras do OFX', () => {
    const st = bb();
    const rows = ofxToImportRows(st, { accountId: 'acc-bb' });
    expect(rows.map((r) => [r.kind, r.amountCents, r.occurredOn, r.description])).toEqual([
      ['expense', 8_790, '2026-11-03', 'PAGAMENTO CONTA ÁGUA'],
      ['expense', 1_250, '2026-11-03', 'PIX ENVIADO PADARIA FICTÍCIA'],
      ['expense', 700, '2026-11-03', 'PIX ENVIADO PADARIA FICTÍCIA'],
      ['income', 150_000, '2026-11-05', 'SALÁRIO EMPRESA FICTÍCIA'],
    ]);
    expect(rows[0]?.extra).toEqual({ trnType: 'DEBIT', fitId: 'FX-0001', checkNum: '000001' });
    expect(rows[1]?.extra).toEqual({
      trnType: 'DEBIT',
      fitId: 'FX-0001',
      name: 'PIX ENVIADO PADARIA FICTÍCIA',
    });
    expect(rows[0]?.descriptionRaw).toBe('PAGAMENTO CONTA ÁGUA');
  });

  it('RN-65: FITID repetido pelo BB não colide (chave FITID|data|valor)', () => {
    const st = bb();
    const keys = ofxToImportRows(st, { accountId: 'acc-bb' }).map((r) => r.externalKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe('FX-0001|2026-11-03|-8790');
  });

  it('US-52: reimportar o mesmo arquivo gera as mesmas chaves ("0 novas · N já existiam")', () => {
    const once = ofxToImportRows(bb(), { accountId: 'acc-bb' });
    const again = ofxToImportRows(bb(), { accountId: 'acc-bb' });
    expect(again.map((r) => r.externalKey)).toEqual(once.map((r) => r.externalKey));
  });

  it('RN-65: sem FITID usa o hash com a ordem das linhas idênticas', () => {
    const st = {
      ...bb(),
      transactions: [1, 2].map(() => ({
        fitId: '',
        trnType: 'DEBIT',
        postedOn: '2026-11-03',
        amountCents: -500,
        memo: 'CAFE',
        name: null,
        checkNum: null,
      })),
    };
    const [a, b] = ofxToImportRows(st, { cardId: 'card-nu' });
    expect(a?.externalKey).toBe(
      importedDedupKey('ofx', {
        date: '2026-11-03',
        amountCents: -500,
        description: 'CAFE',
        ordinal: 0,
      }),
    );
    expect(b?.externalKey).not.toBe(a?.externalKey);
    expect(a?.extra).toEqual({ trnType: 'DEBIT' });
  });

  it('RN-75: cartão — crédito entra como receita e valor zero é descartado; destino é conta ou cartão', () => {
    const [st] = parseOfx(decodeOfxBytes(fixture('cartao-ofx2-utf8.ofx')));
    if (!st) {
      throw new Error('extrato');
    }
    const rows = ofxToImportRows(st, { cardId: 'card-nu' });
    expect(rows.map((r) => [r.kind, r.amountCents, r.description])).toEqual([
      ['expense', 4_590, 'Pão & Café Fictício'],
      ['expense', 10_000, 'LOJA X 02/10'],
      ['income', 98_000, 'Pagamento recebido'],
    ]);
    expect(domainError(() => ofxToImportRows(st, {})).code).toBe('INVALID_ARGUMENT');
    expect(domainError(() => ofxToImportRows(st, { accountId: 'a', cardId: 'c' })).code).toBe(
      'INVALID_ARGUMENT',
    );
  });
});

describe('sniffCsvProfile (US-53, RN-76)', () => {
  it('US-53: cabeçalho "date,title,amount" sugere "Nubank — fatura"', () => {
    expect(sniffCsvProfile(['date', 'title', 'amount'])?.id).toBe('nubank-fatura');
    expect(sniffCsvProfile(['﻿Date ', 'TITLE', 'amount'])?.id).toBe('nubank-fatura');
  });

  it('US-53: cabeçalho "Data,Valor,Identificador,Descrição" sugere "Nubank — conta"', () => {
    expect(sniffCsvProfile(['Data', 'Valor', 'Identificador', 'Descrição'])?.id).toBe(
      'nubank-conta',
    );
    expect(sniffCsvProfile(['Descricao', 'Identificador', 'Valor', 'Data'])?.id).toBe(
      'nubank-conta',
    );
  });

  it('US-53: CSV desconhecido não tem preset (mapeamento manual)', () => {
    expect(sniffCsvProfile(['Data', 'Descrição', 'Valor'])).toBeNull();
    expect(sniffCsvProfile(['date', 'title', 'amount', 'category'])).toBeNull();
    expect(sniffCsvProfile([])).toBeNull();
  });

  it('RN-76: presets provisórios do Nubank e o genérico', () => {
    expect(CSV_PRESETS.map((p) => [p.id, p.name, p.target, p.amountSign])).toEqual([
      ['nubank-fatura', 'Nubank — fatura', 'card', 'expense_positive'],
      ['nubank-conta', 'Nubank — conta', 'account', 'expense_negative'],
      ['generico-br', 'Outro banco', 'account', 'expense_negative'],
    ]);
  });
});

describe('mapCsvRows (US-53, RN-65, RN-76)', () => {
  it('US-53: preset da fatura — positivos entram como compras; negativo é crédito', () => {
    const rows = csvRows('nubank-fatura.csv');
    const result = mapCsvRows(rows, preset('nubank-fatura'));
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.kind, r.amountCents, r.occurredOn, r.description])).toEqual([
      ['expense', 1_250, '2026-11-03', 'Padaria Fictícia'],
      ['expense', 10_000, '2026-11-04', 'Loja X - Parcela 2/10'],
      ['expense', 10_000, '2026-11-04', 'Loja X - Parcela 2/10'],
      ['income', 98_000, '2026-11-05', 'Pagamento recebido'],
    ]);
  });

  it('RN-65: linhas idênticas no mesmo arquivo têm chaves diferentes pelo ordinal; reimportar repete as chaves', () => {
    const rows = csvRows('nubank-fatura.csv');
    const first = mapCsvRows(rows, preset('nubank-fatura')).rows.map((r) => r.externalKey);
    expect(new Set(first).size).toBe(4);
    expect(mapCsvRows(rows, preset('nubank-fatura')).rows.map((r) => r.externalKey)).toEqual(first);
  });

  it('issue #128 (RN-76): a fatura real do Nubank — valor entre aspas com vírgula decimal, ponto de milhar e "- 29,90"', () => {
    const rows = csvRows('nubank-fatura-real-anon.csv');
    expect(sniffCsvProfile(rows[0] ?? [])?.id).toBe('nubank-fatura');
    const result = mapCsvRows(rows, preset('nubank-fatura'));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(rows.length - 1);
    const by = (description: string) => result.rows.filter((r) => r.description === description);
    expect(by('Padaria Ficticia').map((r) => [r.kind, r.amountCents, r.occurredOn])).toEqual([
      ['expense', 1_890, '2026-10-02'],
    ]);
    expect(by('Supermercado Ficticio').map((r) => [r.kind, r.amountCents])).toEqual([
      ['expense', 145_620],
    ]);
    // estorno, crédito, IOF de estorno e pagamento vêm negativos, com espaço depois do sinal
    expect(by('Estorno de Compra Exemplo').map((r) => [r.kind, r.amountCents])).toEqual([
      ['income', 2_990],
    ]);
    expect(by('Pagamento recebido').map((r) => [r.kind, r.amountCents])).toEqual([
      ['income', 123_456],
    ]);
    expect(result.rows.filter((r) => r.kind === 'income')).toHaveLength(4);
    // RN-65: as duas linhas idênticas do mesmo dia têm chaves diferentes
    expect(new Set(by('Mercado Teste').map((r) => r.externalKey)).size).toBe(2);
    expect(new Set(result.rows.map((r) => r.externalKey)).size).toBe(result.rows.length);
  });

  it('issue #128 (RN-76): com ponto decimal (formato antigo do preset) a linha da fatura vira erro visível, não some', () => {
    const result = mapCsvRows(
      [
        ['date', 'title', 'amount'],
        ['2026-10-02', 'Padaria Ficticia', '18.90'],
        ['2026-10-02', 'Posto Exemplo', '150,00'],
      ],
      preset('nubank-fatura'),
    );
    expect(result.errors).toEqual([{ line: 2, code: 'CSV_AMOUNT_INVALID' }]);
    expect(result.rows.map((r) => r.amountCents)).toEqual([15_000]);
  });

  it('issue #128 (US-53): o extrato real da conta Nubank — DD/MM/AAAA, ponto decimal, sinal colado e Identificador UUID', () => {
    const rows = csvRows('nubank-conta-real-anon.csv');
    expect(sniffCsvProfile(rows[0] ?? [])?.id).toBe('nubank-conta');
    const result = mapCsvRows(rows, preset('nubank-conta'));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(rows.length - 1);
    expect(result.rows[0]).toMatchObject({
      kind: 'expense',
      amountCents: 15_000,
      occurredOn: '2026-01-02',
      extra: { line: '2', externalId: '77ed1c80-7c2f-42d6-8109-d013dce52bef' },
    });
    expect(result.rows[1]).toMatchObject({ kind: 'income', amountCents: 250_000 });
    expect(result.rows.every((r) => /^[0-9a-f-]{36}$/.test(r.extra.externalId ?? ''))).toBe(true);
  });

  it('US-53: preset da conta — negativos são saídas e "Identificador" é o external_id; erros por linha', () => {
    const result = mapCsvRows(csvRows('nubank-conta.csv'), preset('nubank-conta'));
    expect(result.rows.map((r) => [r.kind, r.amountCents, r.occurredOn])).toEqual([
      ['expense', 8_790, '2026-11-03'],
      ['income', 150_000, '2026-11-05'],
    ]);
    expect(result.rows[0]?.externalKey).toBe('id-ficticio-0001|2026-11-03|-8790');
    expect(result.rows[0]?.extra).toEqual({ line: '2', externalId: 'id-ficticio-0001' });
    expect(result.rows[1]?.description).toBe('Transferência recebida pelo Pix - FICTÍCIO');
    expect(result.errors).toEqual([
      { line: 5, code: 'CSV_DATE_INVALID' },
      { line: 6, code: 'CSV_AMOUNT_INVALID' },
    ]);
  });

  it('US-53: mapeamento manual — separador ";", vírgula decimal, DD/MM/YY, sem cabeçalho e débito/crédito', () => {
    const profile: CsvProfile = {
      ...preset('generico-br'),
      headerRow: -1,
      columns: { date: '0', description: '1', debit: '2', credit: '3' },
      dateFormat: 'DD/MM/YY',
    };
    const result = mapCsvRows(
      [
        ['03/11/26', 'MERCADO  FICTÍCIO ', '1.234,56', ''],
        ['04/11/26', 'ESTORNO', '', '10,00'],
        ['05/11/26', 'DOIS', '1,00', '2,00'],
        ['06/11/26', 'NADA', '', ''],
        ['07/11/26', 'DEBITO NEGATIVO', '-5,00', ''],
      ],
      profile,
    );
    expect(result.rows.map((r) => [r.kind, r.amountCents, r.occurredOn, r.description])).toEqual([
      ['expense', 123_456, '2026-11-03', 'MERCADO FICTÍCIO'],
      ['income', 1_000, '2026-11-04', 'ESTORNO'],
      ['expense', 500, '2026-11-07', 'DEBITO NEGATIVO'],
    ]);
    expect(result.rows[0]?.descriptionRaw).toBe('MERCADO  FICTÍCIO ');
    expect(result.errors).toEqual([
      { line: 3, code: 'CSV_AMOUNT_INVALID' },
      { line: 4, code: 'CSV_AMOUNT_ZERO' },
    ]);
  });

  it('RN-76: datas fora do formato, valor zero ou acima do limite são erros da linha', () => {
    const profile: CsvProfile = { ...preset('generico-br') };
    const result = mapCsvRows(
      [
        ['Data', 'Descrição', 'Valor'],
        ['2026-11-03', 'ISO NO PERFIL BR', '-1,00'],
        ['31/02/2026', 'INEXISTENTE', '-1,00'],
        ['03/11/2026', 'ZERO', '0,00'],
        ['03/11/2026', 'ENORME', '-1.000.000,00'],
        ['03/11/2026', 'OK', '-1,00'],
      ],
      profile,
    );
    expect(result.errors).toEqual([
      { line: 2, code: 'CSV_DATE_INVALID' },
      { line: 3, code: 'CSV_DATE_INVALID' },
      { line: 4, code: 'CSV_AMOUNT_ZERO' },
      { line: 5, code: 'CSV_AMOUNT_INVALID' },
    ]);
    expect(result.rows).toHaveLength(1);
    const iso = mapCsvRows(
      [
        ['date', 'title', 'amount'],
        ['2026-11-03T10:00:00', 'X', '1,00'],
        ['03/11/2026', 'Y', '1,00'],
      ],
      preset('nubank-fatura'),
    );
    expect(iso.rows.map((r) => r.occurredOn)).toEqual(['2026-11-03']);
    expect(iso.errors).toEqual([{ line: 3, code: 'CSV_DATE_INVALID' }]);
  });

  it('UX I03: coluna obrigatória ou de valor ausente vira um erro no cabeçalho', () => {
    const header = [['Data', 'Descrição']];
    const profile = preset('generico-br');
    expect(mapCsvRows(header, profile)).toEqual({
      rows: [],
      errors: [{ line: 1, code: 'CSV_AMOUNT_COLUMN_MISSING' }],
    });
    expect(
      mapCsvRows([['Data', 'Descrição', 'Debito']], {
        ...profile,
        columns: { ...profile.columns, debit: 'Debito' },
      }).errors,
    ).toEqual([{ line: 1, code: 'CSV_COLUMN_MISSING' }]);
    expect(
      mapCsvRows(header, { ...profile, columns: { date: 'Data', description: 'Descrição' } })
        .errors,
    ).toEqual([{ line: 1, code: 'CSV_AMOUNT_COLUMN_MISSING' }]);
    expect(
      mapCsvRows([['Data', 'Valor']], { ...profile, columns: { ...profile.columns } }).errors,
    ).toEqual([{ line: 1, code: 'CSV_COLUMN_MISSING' }]);
    expect(
      mapCsvRows([['Data', 'Descrição', 'Valor']], {
        ...profile,
        columns: { ...profile.columns, externalId: 'Id' },
      }).errors,
    ).toEqual([{ line: 1, code: 'CSV_COLUMN_MISSING' }]);
    expect(
      mapCsvRows([['a']], {
        ...profile,
        headerRow: -1,
        columns: { date: 'x', description: '1', amount: '2' },
      }).errors,
    ).toEqual([{ line: 1, code: 'CSV_COLUMN_MISSING' }]);
    expect(
      mapCsvRows([['a']], {
        ...profile,
        headerRow: -1,
        columns: { date: '0', description: '1', amount: ' ' },
      }).errors,
    ).toEqual([{ line: 1, code: 'CSV_AMOUNT_COLUMN_MISSING' }]);
  });

  it('RN-76: linhas curtas não quebram e mais de 5.000 linhas é recusado', () => {
    const profile = preset('generico-br');
    expect(mapCsvRows([['Data', 'Descrição', 'Valor'], ['03/11/2026']], profile).errors).toEqual([
      { line: 2, code: 'CSV_AMOUNT_INVALID' },
    ]);
    expect(mapCsvRows([['Data', 'Descrição', 'Valor'], []], profile)).toEqual({
      rows: [],
      errors: [],
    });
    const many = (n: number) => [
      ['Data', 'Descrição', 'Valor'],
      ...Array.from({ length: n }, () => ['03/11/2026', 'X', '-1,00']),
    ];
    expect(mapCsvRows(many(MAX_IMPORT_ROWS), profile).rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(domainError(() => mapCsvRows(many(MAX_IMPORT_ROWS + 1), profile)).code).toBe(
      'IMPORT_TOO_LARGE',
    );
  });
});
