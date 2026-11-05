// Greps proibidos do job `lint-types` (tech §8.6 item 3 e §2.3).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GrepRule {
  id: string;
  message: string;
  pattern: RegExp;
  applies: (file: string) => boolean;
}

const isCode = (file: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs)$/.test(file);
const isVendored = (file: string) => /^supabase\/functions\/_shared\/(domain|nfce)\//.test(file);
const isAppSource = (file: string) =>
  isCode(file) && (file.startsWith('apps/web/src/') || /^packages\/[^/]+\/src\//.test(file));

export const RULES: readonly GrepRule[] = [
  {
    id: 'money-float',
    message: 'parseFloat/toFixed só em money.ts (dinheiro em centavos inteiros)',
    pattern: /\b(?:parseFloat|toFixed)\s*\(/,
    applies: (file) =>
      isCode(file) &&
      ((file.startsWith('packages/domain/src/') && !file.endsWith('/money.ts')) ||
        file.startsWith('apps/web/src/features/')),
  },
  {
    id: 'date-literal',
    message: "new Date('YYYY-MM-DD') é interpretado em UTC; use as funções de dates.ts",
    pattern: /new Date\(\s*['"`]\d{4}-\d{2}-\d{2}['"`]/,
    applies: (file) => isCode(file) && !isVendored(file) && !file.startsWith('node_modules/'),
  },
  {
    id: 'console-log',
    message: 'console.log não entra em src/ (use a telemetria ou console.error em erro real)',
    pattern: /\bconsole\.log\s*\(/,
    applies: isAppSource,
  },
  {
    id: 'local-storage',
    message: 'localStorage só em apps/web/src/lib/',
    pattern: /\blocalStorage\b/,
    applies: (file) =>
      isCode(file) && file.startsWith('apps/web/src/') && !file.startsWith('apps/web/src/lib/'),
  },
  {
    id: 'workflow-set-x',
    message: 'set -x em workflow pode vazar segredos no log',
    pattern: /\bset\s+-[a-wyz]*x/,
    applies: (file) => /^\.github\/workflows\/.+\.ya?ml$/.test(file),
  },
  {
    id: 'workflow-echo-secret',
    message: 'echo de secrets.* em workflow',
    pattern: /\becho\b.*\$\{\{\s*secrets\./,
    applies: (file) => /^\.github\/workflows\/.+\.ya?ml$/.test(file),
  },
];

export interface GrepFinding {
  file: string;
  line: number;
  rule: string;
  message: string;
}

export function grepContent(file: string, content: string): GrepFinding[] {
  const findings: GrepFinding[] = [];
  const rules = RULES.filter((rule) => rule.applies(file));
  if (rules.length === 0) {
    return findings;
  }
  content.split('\n').forEach((text, index) => {
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        findings.push({ file, line: index + 1, rule: rule.id, message: rule.message });
      }
    }
  });
  return findings;
}

export function grepFiles(cwd: string, files: readonly string[]): GrepFinding[] {
  return files.flatMap((file) =>
    RULES.some((rule) => rule.applies(file))
      ? grepContent(file, readFileSync(join(cwd, file), 'utf8'))
      : [],
  );
}

export function main(cwd = process.cwd()): number {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const findings = grepFiles(cwd, files);
  if (findings.length > 0) {
    console.error(`greps proibidos: ${findings.length} achado(s)`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.message}`);
    }
    return 1;
  }
  console.log('greps proibidos: nenhum achado');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
