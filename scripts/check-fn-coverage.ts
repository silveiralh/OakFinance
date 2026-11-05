// Limiar de cobertura das Edge Functions (tech §8.1: ≥ 80% de linhas em supabase/functions/_shared).
// Lê o lcov gerado por `deno coverage --lcov` e compara com coverage-baseline.json.
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface LcovTotals {
  found: number;
  hit: number;
}

export const SHARED_DIR = 'supabase/functions/_shared/';

export function isCounted(file: string): boolean {
  return (
    file.startsWith(SHARED_DIR) &&
    !file.startsWith(`${SHARED_DIR}domain/`) &&
    !file.startsWith(`${SHARED_DIR}nfce/`) &&
    !/\.test\.ts$/.test(file)
  );
}

export function sumLcov(lcov: string, root: string): LcovTotals {
  let current: string | null = null;
  const totals: LcovTotals = { found: 0, hit: 0 };
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      const path = line.slice(3).replace(/^file:\/\//, '');
      const rel = path.startsWith('/') ? relative(root, path) : path;
      current = isCounted(rel) ? rel : null;
    } else if (current && line.startsWith('LF:')) {
      totals.found += Number(line.slice(3));
    } else if (current && line.startsWith('LH:')) {
      totals.hit += Number(line.slice(3));
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return totals;
}

export function check(totals: LcovTotals, minLines: number): { ok: boolean; pct: number } {
  const pct = totals.found === 0 ? 100 : (totals.hit / totals.found) * 100;
  return { ok: pct >= minLines, pct };
}

export function main(lcovPath: string, root: string): number {
  const baseline = JSON.parse(readFileSync(join(root, 'coverage-baseline.json'), 'utf8')) as Record<
    string,
    { lines: number }
  >;
  const min = baseline['supabase/functions/_shared']?.lines ?? 80;
  const totals = sumLcov(readFileSync(lcovPath, 'utf8'), root);
  const { ok, pct } = check(totals, min);
  const text = `fn coverage: ${pct.toFixed(2)}% de linhas em _shared (mínimo ${min}%)`;
  if (!ok) {
    console.error(`${text}: reprovado`);
    return 1;
  }
  console.log(text);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  process.exitCode = main(process.argv[2] ?? join(root, 'coverage/fn.lcov'), root);
}
