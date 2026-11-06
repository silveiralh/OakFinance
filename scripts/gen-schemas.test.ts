import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generate, parseRows, renderSchemas, SCHEMAS_PATH, zodFor } from './gen-schemas.ts';

describe('gen-schemas (tech §4.2: zod gerado de db-types.ts)', () => {
  it('schemas.ts está em dia com db-types.ts (rode pnpm db:schemas)', () => {
    expect(readFileSync(SCHEMAS_PATH, 'utf8')).toBe(generate());
  });

  it('tipos das colunas viram zod; centavos e server_version inteiros', () => {
    expect(zodFor({ name: 'name', type: 'string' })).toBe('z.string()');
    expect(zodFor({ name: 'deleted_at', type: 'string | null' })).toBe('z.string().nullable()');
    expect(zodFor({ name: 'amount_cents', type: 'number' })).toBe('z.number().int()');
    expect(zodFor({ name: 'server_version', type: 'number' })).toBe('z.number().int()');
    expect(zodFor({ name: 'sort_order', type: 'number' })).toBe('z.number()');
    expect(zodFor({ name: 'tags', type: 'string[]' })).toBe('z.array(z.string())');
    expect(zodFor({ name: 'meta', type: 'Json | null' })).toBe('json.nullable()');
    expect(zodFor({ name: 'stats', type: 'NonNullable<Json>' })).toBe('jsonValue');
    expect(() => zodFor({ name: 'x', type: 'Date' })).toThrow(/não suportado/);
    expect(() => zodFor({ name: 'x', type: 'string | number' })).toThrow(/não suportado/);
  });

  it('lê só public.Tables e recusa arquivo inesperado', () => {
    const sample = [
      'export type Database = {',
      '  public: {',
      '    Tables: {',
      '      cards: {',
      '        Row: {',
      '          id: string;',
      '          limit_cents: number | null;',
      '        };',
      '      };',
      '    };',
      '    Views: {',
    ].join('\n');
    const rows = parseRows(sample);
    expect(rows).toEqual([
      {
        table: 'cards',
        columns: [
          { name: 'id', type: 'string' },
          { name: 'limit_cents', type: 'number | null' },
        ],
      },
    ]);
    expect(renderSchemas(rows)).toContain('limit_cents: z.number().int().nullable(),');
    expect(() => parseRows('nada')).toThrow(/public.Tables/);
    expect(() => parseRows(sample.replace('id: string;', 'id string'))).toThrow(/linha inesperada/);
  });
});
