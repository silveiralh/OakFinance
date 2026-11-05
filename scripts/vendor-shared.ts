// Copia packages/domain/src e packages/nfce-parser/src para supabase/functions/_shared (ADR-14).
// Uso: `pnpm vendor` grava a cópia; `pnpm vendor --check` só compara e falha se houver diferença.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const COPIES = [
  { from: 'packages/domain/src', to: 'supabase/functions/_shared/domain' },
  { from: 'packages/nfce-parser/src', to: 'supabase/functions/_shared/nfce' },
] as const;

export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full).map((child) => join(name, child)));
    } else {
      out.push(name);
    }
  }
  return out;
}

/** Diferenças entre a origem e a cópia, em caminhos relativos à raiz. */
export function diffCopy(base: string, from: string, to: string): string[] {
  const src = join(base, from);
  const dst = join(base, to);
  const srcFiles = listFiles(src);
  const dstFiles = listFiles(dst);
  const problems: string[] = [];
  for (const file of srcFiles) {
    const copy = join(dst, file);
    if (!existsSync(copy)) {
      problems.push(`ausente: ${relative(base, copy)}`);
    } else if (!readFileSync(join(src, file)).equals(readFileSync(copy))) {
      problems.push(`diferente: ${relative(base, copy)}`);
    }
  }
  for (const file of dstFiles) {
    if (!srcFiles.includes(file)) {
      problems.push(`sobrando: ${relative(base, join(dst, file))}`);
    }
  }
  return problems;
}

export function writeCopy(base: string, from: string, to: string): void {
  const dst = join(base, to);
  rmSync(dst, { recursive: true, force: true });
  cpSync(join(base, from), dst, { recursive: true });
}

export function main(argv: readonly string[], base = root): number {
  const check = argv.includes('--check');
  const problems: string[] = [];
  for (const { from, to } of COPIES) {
    if (check) {
      problems.push(...diffCopy(base, from, to));
    } else {
      writeCopy(base, from, to);
    }
  }
  if (problems.length > 0) {
    console.error('Cópia vendorizada desatualizada. Rode `pnpm vendor` e faça commit:');
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    return 1;
  }
  console.log(check ? 'vendor: cópias em dia' : 'vendor: cópias atualizadas');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(process.argv.slice(2));
}
