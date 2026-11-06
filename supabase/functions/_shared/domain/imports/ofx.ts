// OFX — parser próprio, tolerante a SGML (OFX 1.02 "Money 2000+" do BB) e a XML (OFX 2.x). Tech §5.10, PRD RN-75.
import { isISODate } from '../dates.ts';
import { DomainError } from '../errors.ts';
import { importedDedupKey } from '../reconciliation.ts';
import type { ISODate } from '../types.ts';
import {
  assertImportSize,
  type ImportedRow,
  MAX_IMPORT_BYTES,
  ordinalKey,
  parseSignedCents,
  tidyText,
} from './common.ts';

export interface OfxTransaction {
  fitId: string;
  trnType: string;
  postedOn: ISODate;
  amountCents: number; // com sinal: negativo = saída
  memo: string;
  name: string | null;
  checkNum: string | null;
}

export interface OfxStatement {
  kind: 'bank' | 'creditcard';
  bankId: string | null;
  acctIdMasked: string | null;
  currency: string;
  startOn: ISODate | null;
  endOn: ISODate | null;
  ledgerBalanceCents: number | null;
  transactions: OfxTransaction[];
}

// ─── Decodificação ───────────────────────────────────────────────────────────────────────────────

function decoderFor(label: 'utf-8' | 'windows-1252', fatal = false) {
  return new TextDecoder(label, { fatal });
}

/**
 * RN-75: usa a codificação declarada no cabeçalho (`CHARSET:1252`, `ENCODING:UTF-8`, `<?xml encoding=…?>`);
 * sem declaração útil (ex.: `ENCODING:USASCII` + `CHARSET:NONE`), tenta UTF-8 e cai para Windows-1252.
 */
export function decodeOfxBytes(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new DomainError('IMPORT_TOO_LARGE', 'arquivo maior que 5 MB');
  }
  const head = decoderFor('windows-1252')
    .decode(bytes.subarray(0, Math.min(bytes.byteLength, 1024)))
    .toUpperCase();
  const charset = /CHARSET\s*:\s*([A-Z0-9-]+)/.exec(head)?.[1] ?? null;
  const encoding =
    /ENCODING\s*:\s*([A-Z0-9-]+)/.exec(head)?.[1] ??
    /<\?XML[^>]*ENCODING\s*=\s*["']([A-Z0-9-]+)["']/.exec(head)?.[1] ??
    null;
  let label: 'utf-8' | 'windows-1252' | null = null;
  if (encoding === 'UTF-8' || encoding === 'UTF8' || charset === 'UTF-8') {
    label = 'utf-8';
  } else if (
    charset === '1252' ||
    charset === 'WINDOWS-1252' ||
    charset === 'ISO-8859-1' ||
    encoding === 'WINDOWS-1252' ||
    encoding === 'ISO-8859-1'
  ) {
    label = 'windows-1252';
  }
  if (label === null) {
    try {
      return stripBom(decoderFor('utf-8', true).decode(bytes));
    } catch {
      label = 'windows-1252';
    }
  }
  return stripBom(decoderFor(label).decode(bytes));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ─── Árvore SGML/XML ─────────────────────────────────────────────────────────────────────────────

interface OfxNode {
  name: string;
  line: number;
  value: string | null; // folha (SGML ou XML)
  children: OfxNode[];
}

function invalid(message: string, line: number): DomainError {
  return new DomainError('OFX_INVALID', `${message} (linha ${line})`, { line });
}

function lineAt(text: string, index: number, cache: { index: number; line: number }): number {
  let { index: from, line } = cache;
  if (index < from) {
    from = 0;
    line = 1;
  }
  for (let i = from; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  cache.index = index;
  cache.line = line;
  return line;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Elementos que são sempre folhas: vazios no SGML não podem virar agregado e engolir os irmãos. */
const LEAVES: ReadonlySet<string> = new Set([
  'TRNTYPE',
  'DTPOSTED',
  'DTUSER',
  'DTAVAIL',
  'TRNAMT',
  'FITID',
  'CHECKNUM',
  'REFNUM',
  'NAME',
  'MEMO',
  'PAYEEID',
  'SIC',
  'BANKID',
  'BRANCHID',
  'ACCTID',
  'ACCTTYPE',
  'CURDEF',
  'DTSTART',
  'DTEND',
  'BALAMT',
  'DTASOF',
  'CODE',
  'SEVERITY',
  'MESSAGE',
  'DTSERVER',
  'LANGUAGE',
  'TRNUID',
  'ORG',
  'FID',
]);

const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9_.]*)\s*(\/?)>/g;

/**
 * Tags seguidas de texto são folhas (fechamento opcional, como no SGML); tags seguidas de outra tag são agregados.
 * Fechamento de agregado desempilha folhas e agregados SGML abertos até ele; fechamento sem par é erro.
 */
function parseTree(text: string, offset: number): OfxNode {
  const root: OfxNode = { name: '#root', line: 1, value: null, children: [] };
  const stack: OfxNode[] = [root];
  const cache = { index: 0, line: 1 };
  let lastLeaf: OfxNode | null = null;
  TAG_RE.lastIndex = offset;
  let match = TAG_RE.exec(text);
  while (match) {
    const [whole, closing, rawName, selfClosing] = match;
    const name = (rawName ?? '').toUpperCase();
    const line = lineAt(text, match.index, cache);
    const end = match.index + whole.length;
    const parent = stack[stack.length - 1] ?? root;
    TAG_RE.lastIndex = end;
    const next = TAG_RE.exec(text);
    const between = text.slice(end, next ? next.index : text.length);
    if (closing === '/') {
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) {
        stack.length = at;
      } else if (lastLeaf?.name !== name) {
        throw invalid(`fechamento </${name}> sem abertura`, line);
      }
      lastLeaf = null;
    } else if (selfClosing === '/') {
      parent.children.push({ name, line, value: '', children: [] });
      lastLeaf = null;
    } else {
      const value = between.trim();
      if (value !== '' || LEAVES.has(name)) {
        lastLeaf = { name, line, value: decodeEntities(value), children: [] };
        parent.children.push(lastLeaf);
      } else {
        const node: OfxNode = { name, line, value: null, children: [] };
        parent.children.push(node);
        stack.push(node);
        lastLeaf = null;
      }
    }
    match = next;
  }
  return root;
}

function child(node: OfxNode, name: string): OfxNode | undefined {
  return node.children.find((c) => c.name === name);
}

function leaf(node: OfxNode | undefined, name: string): string | null {
  const found = node ? child(node, name) : undefined;
  if (!found) {
    return null;
  }
  // `<MEMO></MEMO>` vira agregado vazio
  return found.value ?? (found.children.length === 0 ? '' : null);
}

function findAll(node: OfxNode, names: ReadonlySet<string>, out: OfxNode[] = []): OfxNode[] {
  for (const c of node.children) {
    if (names.has(c.name)) {
      out.push(c);
    } else {
      findAll(c, names, out);
    }
  }
  return out;
}

// ─── Campos ──────────────────────────────────────────────────────────────────────────────────────

/** RN-75: primeiros 8 dígitos AAAAMMDD, na data local declarada (nunca converte para UTC). */
function ofxDate(raw: string | null, line: number, required: true): ISODate;
function ofxDate(raw: string | null, line: number, required: false): ISODate | null;
function ofxDate(raw: string | null, line: number, required: boolean): ISODate | null {
  const digits = /^\s*(\d{4})(\d{2})(\d{2})/.exec(raw ?? '');
  if (!digits) {
    if (required) {
      throw invalid('data inválida', line);
    }
    return null;
  }
  const date = `${digits[1]}-${digits[2]}-${digits[3]}`;
  if (!isISODate(date)) {
    if (required) {
      throw invalid('data inválida', line);
    }
    return null;
  }
  return date;
}

function maskAccount(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const clean = raw.replace(/\s+/g, '');
  return `****${clean.slice(-4)}`;
}

function transactionOf(node: OfxNode): OfxTransaction {
  const amount = parseSignedCents(leaf(node, 'TRNAMT') ?? '', 'auto');
  if (amount === null) {
    throw invalid('valor inválido', child(node, 'TRNAMT')?.line ?? node.line);
  }
  const posted = child(node, 'DTPOSTED');
  return {
    fitId: (leaf(node, 'FITID') ?? '').trim(),
    trnType: (leaf(node, 'TRNTYPE') ?? 'OTHER').trim().toUpperCase(),
    postedOn: ofxDate(leaf(node, 'DTPOSTED'), posted?.line ?? node.line, true),
    amountCents: amount,
    memo: leaf(node, 'MEMO') ?? '',
    name: leaf(node, 'NAME'),
    checkNum: leaf(node, 'CHECKNUM'),
  };
}

function statementOf(node: OfxNode): OfxStatement {
  const card = node.name === 'CCSTMTRS';
  const from = child(node, card ? 'CCACCTFROM' : 'BANKACCTFROM');
  const list = child(node, 'BANKTRANLIST');
  const balance = child(node, 'LEDGERBAL');
  const balanceRaw = leaf(balance, 'BALAMT');
  const transactions = (list?.children ?? [])
    .filter((c) => c.name === 'STMTTRN')
    .map(transactionOf);
  assertImportSize(transactions.length);
  return {
    kind: card ? 'creditcard' : 'bank',
    bankId: card ? null : (leaf(from, 'BANKID')?.trim() ?? null),
    acctIdMasked: maskAccount(leaf(from, 'ACCTID')),
    currency: (leaf(node, 'CURDEF') ?? 'BRL').trim().toUpperCase(),
    startOn: list ? ofxDate(leaf(list, 'DTSTART'), list.line, false) : null,
    endOn: list ? ofxDate(leaf(list, 'DTEND'), list.line, false) : null,
    ledgerBalanceCents: balanceRaw === null ? null : parseSignedCents(balanceRaw, 'auto'),
    transactions,
  };
}

const STATEMENTS: ReadonlySet<string> = new Set(['STMTRS', 'CCSTMTRS']);

/** Lê os extratos (conta e cartão) de um OFX 1.x ou 2.x. Lança DomainError('OFX_INVALID') com a linha. */
export function parseOfx(text: string): OfxStatement[] {
  const start = text.search(/<OFX>/i);
  if (start === -1) {
    throw invalid('arquivo sem <OFX>', 1);
  }
  const tree = parseTree(text, start);
  const statements = findAll(tree, STATEMENTS).map(statementOf);
  if (statements.length === 0) {
    throw invalid('nenhum extrato no arquivo', lineAt(text, start, { index: 0, line: 1 }));
  }
  assertImportSize(statements.reduce((n, s) => n + s.transactions.length, 0));
  return statements;
}

/**
 * Linhas para conciliar (RN-65/RN-75): negativo = saída; descrição = MEMO se existir, senão NAME; valor zero é
 * descartado. Chave de deduplicação pelo FITID|data|valor com sinal (o BB repete FITID entre lançamentos).
 */
export function ofxToImportRows(
  st: OfxStatement,
  target: { accountId?: string; cardId?: string },
): ImportedRow[] {
  if ((target.accountId === undefined) === (target.cardId === undefined)) {
    throw new DomainError('INVALID_ARGUMENT', 'informe conta ou cartão (só um)');
  }
  const seen = new Map<string, number>();
  const rows: ImportedRow[] = [];
  for (const t of st.transactions) {
    if (t.amountCents === 0) {
      continue;
    }
    const descriptionRaw = t.memo.trim() !== '' ? t.memo : (t.name ?? '');
    const description = tidyText(descriptionRaw);
    const key = ordinalKey(t.postedOn, t.amountCents, description);
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    const extra: Record<string, string> = { trnType: t.trnType };
    if (t.fitId !== '') {
      extra.fitId = t.fitId;
    }
    if (t.name !== null && t.name.trim() !== '') {
      extra.name = tidyText(t.name);
    }
    if (t.checkNum !== null && t.checkNum.trim() !== '') {
      extra.checkNum = t.checkNum.trim();
    }
    rows.push({
      externalKey: importedDedupKey('ofx', {
        fitId: t.fitId,
        date: t.postedOn,
        amountCents: t.amountCents,
        description,
        ordinal,
      }),
      occurredOn: t.postedOn,
      amountCents: Math.abs(t.amountCents),
      kind: t.amountCents < 0 ? 'expense' : 'income',
      description,
      descriptionRaw,
      extra,
    });
  }
  return rows;
}
