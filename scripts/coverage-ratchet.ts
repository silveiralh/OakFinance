// Catraca de cobertura (tech §8.6 item 4): sobe coverage-baseline.json até a cobertura medida
// (arredondada para baixo) e nunca desce. Rode depois de `pnpm test` e `pnpm test:fn`.
// Uso: pnpm coverage:ratchet
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sumLcov } from './check-fn-coverage.ts';

export type Baseline = Record<string, unknown>;

export interface Measured {
  lines: number;
  branches?: number;
}

interface SummaryEntry {
  lines: { total: number; covered: number };
  branches: { total: number; covered: number };
}

function pct(covered: number, total: number): number {
  return total === 0 ? 100 : (covered / total) * 100;
}

/** Cobertura agregada dos arquivos do summary do Vitest cujo caminho começa com `prefix`. */
export function aggregate(
  summary: Record<string, SummaryEntry>,
  root: string,
  prefix: string,
): Measured | null {
  let lt = 0;
  let lc = 0;
  let bt = 0;
  let bc = 0;
  let files = 0;
  for (const [file, entry] of Object.entries(summary)) {
    if (file === 'total') {
      continue;
    }
    const rel = file.startsWith('/') ? relative(root, file) : file;
    if (rel === prefix || rel.startsWith(`${prefix}/`)) {
      files++;
      lt += entry.lines.total;
      lc += entry.lines.covered;
      bt += entry.branches.total;
      bc += entry.branches.covered;
    }
  }
  return files === 0 ? null : { lines: pct(lc, lt), branches: pct(bc, bt) };
}

/** Nova baseline: cada métrica vira max(atual, floor(medido)). Nunca desce. */
export function ratchet(baseline: Baseline, measured: Record<string, Measured | null>): Baseline {
  const next: Baseline = { ...baseline };
  for (const [area, value] of Object.entries(measured)) {
    const current = baseline[area];
    if (!value || typeof current !== 'object' || current === null) {
      continue;
    }
    const metrics = { ...(current as Record<string, number>) };
    for (const [metric, old] of Object.entries(metrics)) {
      const got = value[metric as keyof Measured];
      if (typeof got === 'number') {
        metrics[metric] = Math.max(old, Math.floor(got));
      }
    }
    next[area] = metrics;
  }
  return next;
}

const SUMMARIES: Record<string, string> = {
  'packages/domain': 'packages/domain/coverage/coverage-summary.json',
  'packages/nfce-parser': 'packages/nfce-parser/coverage/coverage-summary.json',
  'apps/web/src': 'apps/web/coverage/coverage-summary.json',
  'apps/web/src/data': 'apps/web/coverage/coverage-summary.json',
};

export function measure(root: string): Record<string, Measured | null> {
  const measured: Record<string, Measured | null> = {};
  for (const [area, file] of Object.entries(SUMMARIES)) {
    const path = join(root, file);
    if (!existsSync(path)) {
      measured[area] = null;
      continue;
    }
    const summary = JSON.parse(readFileSync(path, 'utf8')) as Record<string, SummaryEntry>;
    measured[area] = aggregate(summary, root, area);
  }
  const lcov = join(root, 'coverage/fn.lcov');
  if (existsSync(lcov)) {
    const totals = sumLcov(readFileSync(lcov, 'utf8'), root);
    measured['supabase/functions/_shared'] =
      totals.found === 0 ? null : { lines: pct(totals.hit, totals.found) };
  }
  return measured;
}

export function main(root: string, log = console.log): number {
  const path = join(root, 'coverage-baseline.json');
  const baseline = JSON.parse(readFileSync(path, 'utf8')) as Baseline;
  const next = ratchet(baseline, measure(root));
  const before = JSON.stringify(baseline);
  const after = JSON.stringify(next);
  if (before === after) {
    log('coverage:ratchet: baseline já está no máximo medido');
    return 0;
  }
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  log('coverage:ratchet: baseline atualizada (só sobe); faça commit de coverage-baseline.json');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(fileURLToPath(new URL('..', import.meta.url)));
}
