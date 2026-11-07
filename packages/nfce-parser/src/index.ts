// Parser da página da NFC-e da SEFAZ-PR (tech §6.2.3; RN-82, RN-84). **Defensivo**: tira as tags e procura por
// rótulo ("Qtde.:", "UN:", "Vl. Unit.:", "Valor total R$", "Descontos R$") dentro de cada linha de item; se não
// reconhecer o layout, se houver captcha ou se Σ itens − desconto não fechar com o total (1 centavo de tolerância
// por item), devolve `fallback`, e o app pede o valor ao usuário. Sem dependências: o mesmo arquivo roda no Node
// (testes) e no Deno (copiado para `supabase/functions/_shared/nfce`). Os seletores serão confirmados com páginas
// reais anonimizadas na T-090.
export const NFCE_PARSER_PACKAGE = '@oakfinance/nfce-parser';

export interface NfceItem {
  description: string;
  code: string | null;
  /** Quantidade em milésimos (1,234 kg = 1234). */
  quantityMilli: number;
  unit: string | null;
  unitCents: number;
  totalCents: number;
}

export interface NfceParsed {
  issuerName: string | null;
  issuerCnpj: string | null;
  /** "AAAA-MM-DDTHH:mm:ss" no horário local da emissão. */
  issuedAt: string | null;
  items: NfceItem[];
  discountCents: number;
  totalCents: number;
}

export type NfceFallbackCode = 'NFCE_LAYOUT' | 'NFCE_CAPTCHA';

export type NfceParseResult =
  | { status: 'full'; receipt: NfceParsed }
  | { status: 'fallback'; errorCode: NfceFallbackCode };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const ACCENTS: Record<string, string> = {
  acute: '\u0301',
  grave: '\u0300',
  circ: '\u0302',
  tilde: '\u0303',
  cedil: '\u0327',
  uml: '\u0308',
};
const ACCENT_RE = /^([a-z])(acute|grave|circ|tilde|cedil|uml)$/i;

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith('#')) {
      return String.fromCodePoint(Number(name.slice(1)));
    }
    const accented = ACCENT_RE.exec(name);
    if (accented) {
      // "&eacute;" → "é": letra + acento combinante, normalizado
      return `${accented[1]}${ACCENTS[(accented[2] ?? '').toLowerCase()] ?? ''}`.normalize('NFC');
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Texto visível de um trecho de HTML, com espaços normalizados. */
export function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1.234,56" → 123456 (aritmética inteira; sem parseFloat). `null` se não for um valor. */
export function brlToCents(raw: string): number | null {
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(raw.trim());
  if (!m) {
    return null;
  }
  const reais = Number((m[1] ?? '').replace(/\./g, ''));
  const cents = Number(`${m[2] ?? ''}00`.slice(0, 2));
  return reais * 100 + cents;
}

/** "1,234" → 1234 milésimos; "2" → 2000. */
export function quantityToMilli(raw: string): number | null {
  const m = /^(\d+)(?:,(\d{1,3}))?$/.exec(raw.trim().replace(/\./g, ''));
  if (!m) {
    return null;
  }
  return Number(m[1]) * 1000 + Number(`${m[2] ?? ''}000`.slice(0, 3));
}

function classText(html: string, cls: string): string | null {
  const re = new RegExp(
    `<[^>]+class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/(?:span|td|div|strong|label)>`,
    'i',
  );
  const m = re.exec(html);
  return m ? textOf(m[1] ?? '') : null;
}

function idText(html: string, id: string): string | null {
  const re = new RegExp(`<([a-z0-9]+)[^>]*id="${id}"[^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  const m = re.exec(html);
  return m ? textOf(m[2] ?? '') : null;
}

const MONEY = '(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d+,\\d{2})';

function labeled(text: string, label: string, value = MONEY): string | null {
  const m = new RegExp(`${label}\\s*:?\\s*${value}`, 'i').exec(text);
  return m ? (m[1] ?? null) : null;
}

function parseItem(rowHtml: string): NfceItem | null {
  const text = textOf(rowHtml);
  const description = classText(rowHtml, 'txtTit') ?? text.split(/\(C[óo]digo/i)[0]?.trim() ?? '';
  const code = /C[óo]digo\s*:\s*([\w.-]+)/i.exec(text)?.[1] ?? null;
  const qty = labeled(text, 'Qtde\\.?', '(\\d+(?:[.,]\\d{1,3})?)');
  const unit = /UN\s*:\s*([A-Za-z]{1,6})/.exec(text)?.[1] ?? null;
  const unitRaw = labeled(text, 'Vl\\.?\\s*Unit\\.?');
  const totalRaw = classText(rowHtml, 'valor') ?? labeled(text, 'Vl\\.?\\s*Total');
  const quantityMilli = qty ? quantityToMilli(qty.replace('.', ',')) : null;
  const unitCents = unitRaw ? brlToCents(unitRaw) : null;
  const totalCents = totalRaw ? brlToCents(totalRaw.replace(/^R\$\s*/, '')) : null;
  if (!description || quantityMilli === null || totalCents === null) {
    return null;
  }
  return {
    description: description.slice(0, 120),
    code,
    quantityMilli,
    unit: unit ? unit.toUpperCase() : null,
    unitCents: unitCents ?? Math.round((totalCents * 1000) / Math.max(quantityMilli, 1)),
    totalCents,
  };
}

/** Lê a página de consulta da NFC-e. Nunca lança: layout desconhecido vira `fallback`. */
export function parseNfcePage(html: string): NfceParseResult {
  if (/captcha|recaptcha|hcaptcha/i.test(html)) {
    return { status: 'fallback', errorCode: 'NFCE_CAPTCHA' };
  }
  const table = /<table[^>]*id="tabResult"[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] ?? '';
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1] ?? '');
  const items: NfceItem[] = [];
  for (const row of rows) {
    const item = parseItem(row);
    if (!item) {
      return { status: 'fallback', errorCode: 'NFCE_LAYOUT' };
    }
    items.push(item);
  }
  const text = textOf(html);
  const totalRaw =
    labeled(text, 'Valor a pagar R\\$') ??
    labeled(text, 'Valor total R\\$') ??
    classText(html, 'totalNumb');
  const totalCents = totalRaw ? brlToCents(totalRaw) : null;
  if (items.length === 0 || totalCents === null) {
    return { status: 'fallback', errorCode: 'NFCE_LAYOUT' };
  }
  const discountRaw = labeled(text, 'Descontos R\\$');
  const discountCents = discountRaw ? (brlToCents(discountRaw) ?? 0) : 0;
  const sum = items.reduce((acc, item) => acc + item.totalCents, 0);
  if (Math.abs(sum - discountCents - totalCents) > items.length) {
    return { status: 'fallback', errorCode: 'NFCE_LAYOUT' };
  }
  const cnpj = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/.exec(text)?.[1]?.replace(/\D/g, '') ?? null;
  const when = /(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/.exec(text);
  return {
    status: 'full',
    receipt: {
      issuerName: idText(html, 'u20') ?? classText(html, 'txtTopo'),
      issuerCnpj: cnpj,
      issuedAt: when ? `${when[3]}-${when[2]}-${when[1]}T${when[4]}:${when[5]}:${when[6]}` : null,
      items,
      discountCents,
      totalCents,
    },
  };
}
