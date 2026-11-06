// Gera `apps/web/src/data/schemas.ts` (zod das linhas sincronizadas, tech §4.2) a partir dos tipos `Row` de
// `apps/web/src/data/db-types.ts`. Uso: `node scripts/gen-schemas.ts` grava; `--check` só compara (exit 1 se o
// arquivo estiver desatualizado). O teste `scripts/gen-schemas.test.ts` faz a mesma comparação no job unit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Column {
  name: string;
  type: string;
}

export interface TableRow {
  table: string;
  columns: Column[];
}

/** Tabelas `public` e as colunas do `Row` de cada uma, na ordem do arquivo gerado pelo Supabase. */
export function parseRows(dbTypes: string): TableRow[] {
  const publicStart = dbTypes.indexOf('  public: {');
  const tablesStart = dbTypes.indexOf('    Tables: {', publicStart);
  const viewsStart = dbTypes.indexOf('    Views: {', tablesStart);
  if (publicStart < 0 || tablesStart < 0 || viewsStart < 0) {
    throw new Error('gen-schemas: bloco public.Tables não encontrado em db-types.ts');
  }
  const section = dbTypes.slice(tablesStart, viewsStart);
  const out: TableRow[] = [];
  for (const match of section.matchAll(/^ {6}([a-z_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\};/gm)) {
    const columns: Column[] = [];
    for (const line of (match[2] ?? '').split('\n')) {
      const column = /^ {10}([a-z_0-9]+): (.+);$/.exec(line);
      if (!column) {
        throw new Error(`gen-schemas: linha inesperada em ${match[1]}: ${line.trim()}`);
      }
      columns.push({ name: column[1] ?? '', type: column[2] ?? '' });
    }
    out.push({ table: match[1] ?? '', columns });
  }
  return out;
}

const BASE: Record<string, string> = {
  string: 'z.string()',
  number: 'z.number()',
  boolean: 'z.boolean()',
  Json: 'json',
  'NonNullable<Json>': 'jsonValue',
  'string[]': 'z.array(z.string())',
  'number[]': 'z.array(z.number())',
};

/** Tipo TypeScript de uma coluna → expressão zod. `bigint`/`integer` chegam como `number` (inteiro). */
export function zodFor(column: Column): string {
  const parts = column.type.split(' | ').map((part) => part.trim());
  const nullable = parts.includes('null');
  const rest = parts.filter((part) => part !== 'null');
  if (rest.length !== 1 || !rest[0] || !(rest[0] in BASE)) {
    throw new Error(`gen-schemas: tipo não suportado em ${column.name}: ${column.type}`);
  }
  let expr = BASE[rest[0]] ?? '';
  if (
    rest[0] === 'number' &&
    (column.name.endsWith('_cents') || column.name === 'server_version')
  ) {
    expr = 'z.number().int()';
  }
  return nullable ? `${expr}.nullable()` : expr;
}

function pascal(table: string): string {
  return table.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());
}

export function renderSchemas(rows: readonly TableRow[]): string {
  const lines = [
    '// ARQUIVO GERADO por scripts/gen-schemas.ts a partir de db-types.ts. Não edite à mão: rode `pnpm db:schemas`.',
    "import { z } from 'zod';",
    "import type { Json } from './db-types';",
    '',
    "// Sem JIT: a CSP não tem 'unsafe-eval' (tech §7.1, E14).",
    'z.config({ jitless: true });',
    '',
    'const json: z.ZodType<Json> = z.lazy(() =>',
    '  z.union([',
    '    z.string(),',
    '    z.number(),',
    '    z.boolean(),',
    '    z.null(),',
    '    z.array(json),',
    '    z.record(z.string(), json.optional()),',
    '  ]),',
    ');',
    'const jsonValue = json.refine((value) => value !== null);',
    '',
  ];
  for (const { table, columns } of rows) {
    lines.push(`export const ${pascal(table)}Row = z.object({`);
    for (const column of columns) {
      lines.push(`  ${column.name}: ${zodFor(column)},`);
    }
    lines.push('});', '');
  }
  lines.push('/** Schema de cada tabela `public`, pelo nome da tabela. */');
  lines.push('export const rowSchemas = {');
  for (const { table } of rows) {
    lines.push(`  ${table}: ${pascal(table)}Row,`);
  }
  lines.push('} as const;', '', 'export type RowTable = keyof typeof rowSchemas;', '');
  return lines.join('\n');
}

const root = fileURLToPath(new URL('..', import.meta.url));
export const DB_TYPES_PATH = join(root, 'apps/web/src/data/db-types.ts');
export const SCHEMAS_PATH = join(root, 'apps/web/src/data/schemas.ts');

export function generate(): string {
  return renderSchemas(parseRows(readFileSync(DB_TYPES_PATH, 'utf8')));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = generate();
  if (process.argv.includes('--check')) {
    const current = readFileSync(SCHEMAS_PATH, 'utf8');
    if (current !== text) {
      console.error(
        'gen-schemas: apps/web/src/data/schemas.ts desatualizado; rode `pnpm db:schemas`',
      );
      process.exitCode = 1;
    }
  } else {
    writeFileSync(SCHEMAS_PATH, text);
    console.log(`gen-schemas: ${SCHEMAS_PATH}`);
  }
}
