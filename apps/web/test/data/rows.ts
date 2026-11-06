// Linhas completas e sintéticas para os testes do data layer (sem dado real): cada coluna recebe um valor neutro
// do tipo do schema zod, e o teste sobrescreve só o que importa.
import { z } from 'zod';
import type { LocalRow, SyncedTable } from '../../src/data/db';
import { rowSchemas } from '../../src/data/schemas';

const USER = '00000000-0000-7000-8000-000000000001';
const STAMP = '2026-11-06T12:00:00.000Z';

function neutral(name: string, schema: z.ZodType): unknown {
  if (schema instanceof z.ZodNullable) {
    return null;
  }
  if (schema instanceof z.ZodBoolean) {
    return false;
  }
  if (schema instanceof z.ZodNumber) {
    return name.endsWith('_day') ? 1 : 0;
  }
  if (schema instanceof z.ZodArray) {
    return [];
  }
  if (name === 'user_id') {
    return USER;
  }
  if (name.endsWith('_at')) {
    return STAMP;
  }
  if (name.endsWith('_on') || name === 'month') {
    return '2026-11-01';
  }
  return 'x';
}

export function makeRow<T extends SyncedTable>(
  table: T,
  overrides: Partial<LocalRow<T>> & { id: string },
): LocalRow<T> {
  const shape = (rowSchemas[table] as unknown as z.ZodObject).shape as Record<string, z.ZodType>;
  const row: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(shape)) {
    row[name] = neutral(name, schema);
  }
  return { ...row, ...overrides } as unknown as LocalRow<T>;
}

export function tx(
  id: string,
  overrides: Partial<LocalRow<'transactions'>> = {},
): LocalRow<'transactions'> {
  return makeRow('transactions', {
    id,
    kind: 'expense',
    status: 'posted',
    payment_method: 'pix',
    source: 'manual',
    review_state: 'ok',
    category_source: 'user',
    occurred_on: '2026-11-05',
    amount_cents: 1000,
    ...overrides,
  });
}
