// Guard do portão de qualidade (tech §8.6, job `guard`). Compara o PR com a base (origin/main).
// Sem revisão humana, este script impede que um PR enfraqueça o próprio portão.
//
// Variáveis: GUARD_BASE (padrão origin/main), EVENT_NAME, PR_TITLE, PR_BODY, PR_HEAD_REPO, PR_BASE_REPO.
// Caminho protegido: mudanças só com o rótulo needs-owner e merge do dono (CLAUDE.md §4).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

export interface GuardContext {
  cwd: string;
  base: string;
  eventName: string;
  prTitle: string;
  prBody: string;
  prHeadRepo: string;
  prBaseRepo: string;
}

export interface Change {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  path: string;
  oldPath?: string;
}

export interface Violation {
  rule: string;
  detail: string;
}

// ------------------------------------------------------------------ git

function git(ctx: Pick<GuardContext, 'cwd'>, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd: ctx.cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function existsAt(ctx: GuardContext, ref: string, path: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${ref}:${path}`], { cwd: ctx.cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function showAt(ctx: GuardContext, ref: string, path: string): string {
  return git(ctx, ['show', `${ref}:${path}`]);
}

export function changes(ctx: GuardContext): Change[] {
  const out = git(ctx, ['diff', '--name-status', '-z', '-M', `${ctx.base}...HEAD`]);
  const parts = out.split('\0').filter((part) => part !== '');
  const result: Change[] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i++] ?? '';
    const status = code.charAt(0) as Change['status'];
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++] ?? '';
      const path = parts[i++] ?? '';
      result.push({ status, path, oldPath });
    } else {
      result.push({ status, path: parts[i++] ?? '' });
    }
  }
  return result;
}

/** Linhas adicionadas por arquivo (git diff -U0). */
export function addedLines(ctx: GuardContext): Map<string, string[]> {
  const diff = git(ctx, [
    'diff',
    '--unified=0',
    '--no-color',
    '--no-ext-diff',
    `${ctx.base}...HEAD`,
  ]);
  const result = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4);
      current = path === '/dev/null' ? null : [];
      if (current) {
        result.set(path.replace(/^b\//, ''), current);
      }
    } else if (current && line.startsWith('+')) {
      current.push(line.slice(1));
    }
  }
  return result;
}

function filesAt(ctx: GuardContext, ref: string | null): string[] {
  const out = ref
    ? git(ctx, ['ls-tree', '-r', '--name-only', '-z', ref])
    : git(ctx, ['ls-files', '-z']);
  return out.split('\0').filter(Boolean);
}

function readAt(ctx: GuardContext, ref: string | null, path: string): string {
  return ref ? showAt(ctx, ref, path) : git(ctx, ['show', `HEAD:${path}`]);
}

// ------------------------------------------------------------------ regra 1: caminhos protegidos

export const PROTECTED: readonly RegExp[] = [
  /^\.github\//,
  /^biome\.json$/,
  /(^|\/)vitest\.config\.[^/]+$/,
  /(^|\/)playwright\.config\.ts$/,
  /^scripts\/ci-guard\.ts$/,
  /^scripts\/ci-secrets\.ts$/,
  /^\.gitleaks\.toml$/,
  /^supabase\/tests\/database\/000-setup\.test\.sql$/,
  /^lefthook\.yml$/,
];

export function isProtected(path: string): boolean {
  return PROTECTED.some((re) => re.test(path));
}

type Baseline = Record<string, unknown>;

/** Métricas da baseline que caíram (a baseline só sobe). */
export function baselineDecreases(before: Baseline, after: Baseline): string[] {
  const problems: string[] = [];
  for (const [area, metrics] of Object.entries(before)) {
    if (area.startsWith('$') || typeof metrics !== 'object' || metrics === null) {
      continue;
    }
    const later = after[area] as Record<string, unknown> | undefined;
    for (const [metric, value] of Object.entries(metrics as Record<string, number>)) {
      const now = later?.[metric];
      if (typeof now !== 'number' || now < value) {
        problems.push(`${area}.${metric}: ${value} → ${now ?? 'removido'}`);
      }
    }
  }
  return problems;
}

export function checkProtected(ctx: GuardContext, list: readonly Change[]): Violation[] {
  const violations: Violation[] = [];
  for (const change of list) {
    for (const path of [change.path, change.oldPath].filter((p): p is string => !!p)) {
      if (isProtected(path)) {
        violations.push({
          rule: 'caminho-protegido',
          detail: `${path} é protegido: deixe o PR aberto com o rótulo needs-owner (CLAUDE.md §4)`,
        });
      }
    }
    if (change.path === 'coverage-baseline.json') {
      if (change.status === 'D') {
        violations.push({ rule: 'cobertura', detail: 'coverage-baseline.json removido' });
        continue;
      }
      if (!existsAt(ctx, ctx.base, 'coverage-baseline.json')) {
        continue;
      }
      try {
        const before = JSON.parse(showAt(ctx, ctx.base, 'coverage-baseline.json')) as Baseline;
        const after = JSON.parse(readAt(ctx, null, 'coverage-baseline.json')) as Baseline;
        for (const detail of baselineDecreases(before, after)) {
          violations.push({ rule: 'cobertura', detail: `baseline caiu: ${detail}` });
        }
      } catch {
        violations.push({ rule: 'cobertura', detail: 'coverage-baseline.json inválido' });
      }
    }
  }
  return violations;
}

// ------------------------------------------------------------------ regra 2: testes não somem

export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|mts)$/.test(path) || /\.test\.sql$/.test(path);
}

const TS_TEST_CALL = /\b(?:it|test|Deno\.test)(?:\.each\s*(?:\([^)]*\)|`[^`]*`))?\s*\(/g;
const SQL_PLAN = /\bplan\s*\(\s*(\d+)\s*\)/gi;

export function countTests(path: string, content: string): number {
  if (path.endsWith('.sql')) {
    let total = 0;
    for (const match of content.matchAll(SQL_PLAN)) {
      total += Number(match[1]);
    }
    return total;
  }
  return [...content.matchAll(TS_TEST_CALL)].length;
}

export function totalTests(ctx: GuardContext, ref: string | null): number {
  let total = 0;
  for (const path of filesAt(ctx, ref)) {
    if (isTestFile(path) && !path.startsWith('supabase/functions/_shared/domain/')) {
      total += countTests(path, readAt(ctx, ref, path));
    }
  }
  return total;
}

export function checkTestCount(ctx: GuardContext, list: readonly Change[]): Violation[] {
  const violations: Violation[] = [];
  for (const change of list) {
    if (change.status === 'D' && isTestFile(change.path)) {
      violations.push({ rule: 'testes', detail: `arquivo de teste removido: ${change.path}` });
    }
    if (
      change.status === 'R' &&
      change.oldPath &&
      isTestFile(change.oldPath) &&
      !isTestFile(change.path)
    ) {
      violations.push({
        rule: 'testes',
        detail: `arquivo de teste deixou de ser teste: ${change.oldPath}`,
      });
    }
  }
  const before = totalTests(ctx, ctx.base);
  const after = totalTests(ctx, null);
  if (after < before) {
    violations.push({ rule: 'testes', detail: `casos de teste caíram de ${before} para ${after}` });
  }
  return violations;
}

// ------------------------------------------------------------------ regra 3: proibições em linhas novas

const AT = '@';
export const FORBIDDEN_CODE: readonly { re: RegExp; what: string; testsOnly?: boolean }[] = [
  {
    re: /\b(?:it|test|describe|suite|bench)\s*\.\s*(?:only|skip|todo|skipIf|runIf)\b/,
    what: '.only/.skip/.todo',
  },
  { re: /\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/, what: 'xit/xdescribe/fit' },
  { re: /\bDeno\.test\.(?:only|ignore)\b/, what: 'Deno.test.only/ignore' },
  { re: /\b(?:only|ignore)\s*:\s*true\b/, what: 'only/ignore true', testsOnly: true },
  { re: new RegExp(`${AT}ts-nocheck`), what: `${AT}ts-nocheck` },
];

const BIOME_IGNORE = /biome-ignore(?:-all|-start|-end)?\s+([^\s:]+)(.*)$/;

export function biomeIgnoreWithoutReason(line: string): boolean {
  const match = BIOME_IGNORE.exec(line);
  if (!match) {
    return /biome-ignore/.test(line);
  }
  const rest = (match[2] ?? '').trim();
  return !rest.startsWith(':') || rest.slice(1).trim().length < 3;
}

const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

export function checkForbidden(added: ReadonlyMap<string, readonly string[]>): Violation[] {
  const violations: Violation[] = [];
  for (const [path, lines] of added) {
    if (path === 'scripts/ci-guard.ts') {
      continue;
    }
    for (const line of lines) {
      if (CODE_FILE.test(path)) {
        for (const { re, what, testsOnly } of FORBIDDEN_CODE) {
          if ((!testsOnly || isTestFile(path)) && re.test(line)) {
            violations.push({ rule: 'proibido', detail: `${what} em ${path}: ${line.trim()}` });
          }
        }
      }
      if (/biome-ignore/.test(line) && biomeIgnoreWithoutReason(line)) {
        violations.push({ rule: 'proibido', detail: `biome-ignore sem justificativa em ${path}` });
      }
      if (path.endsWith('.sql') && /\bskip\s*\(/i.test(line)) {
        violations.push({ rule: 'proibido', detail: `skip( no pgTAP em ${path}` });
      }
    }
  }
  return violations;
}

// ------------------------------------------------------------------ regra 4: migrações

const DESTRUCTIVE: readonly RegExp[] = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\balter\s+column\s+[\w"]+\s+(?:set\s+data\s+)?type\b/i,
  /\brename\b/i,
  /\btruncate\b/i,
];

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

export function destructiveStatements(sql: string): string[] {
  const clean = stripSqlComments(sql);
  return DESTRUCTIVE.filter((re) => re.test(clean)).map((re) => re.source);
}

const MIGRATION = /^supabase\/migrations\/[^/]+\.sql$/;

export function checkMigrations(ctx: GuardContext, list: readonly Change[]): Violation[] {
  const violations: Violation[] = [];
  for (const change of list) {
    const touched = [change.path, change.oldPath].filter(
      (p): p is string => !!p && MIGRATION.test(p),
    );
    for (const path of touched) {
      if (change.status !== 'A' && existsAt(ctx, ctx.base, path)) {
        violations.push({
          rule: 'migracao',
          detail: `migração já mergeada não pode mudar: ${path}`,
        });
      }
    }
    if (change.status === 'A' && MIGRATION.test(change.path)) {
      for (const re of destructiveStatements(readAt(ctx, null, change.path))) {
        violations.push({
          rule: 'migracao',
          detail: `DDL destrutivo (${re}) em ${change.path}: expand/contract exige needs-owner`,
        });
      }
    }
  }
  return violations;
}

// ------------------------------------------------------------------ regra 5: drift de contrato

/** .d.ts do domínio a partir de packages/domain/src/index.ts, num diretório com a árvore do domínio. */
export function domainDeclarations(srcDir: string): string {
  const entry = join(srcDir, 'index.ts');
  const outputs = new Map<string, string>();
  const program = ts.createProgram([entry], {
    declaration: true,
    emitDeclarationOnly: true,
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmitOnError: false,
    types: [],
  });
  program.emit(undefined, (fileName, text) => {
    outputs.set(fileName.replace(/\\/g, '/').slice(fileName.indexOf('/src/') + 1), text);
  });
  return [...outputs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, text]) => `// ${file}\n${text.trim()}`)
    .join('\n');
}

function extractDomainAt(ctx: GuardContext, ref: string | null, target: string): void {
  for (const path of filesAt(ctx, ref)) {
    if (path.startsWith('packages/domain/src/')) {
      const out = join(target, path.slice('packages/domain/'.length));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, readAt(ctx, ref, path));
    }
  }
}

export function domainApiChanged(ctx: GuardContext): boolean {
  const cache = join(ctx.cwd, 'node_modules', '.cache');
  mkdirSync(cache, { recursive: true });
  const work = mkdtempSync(join(cache, 'guard-'));
  try {
    const before = join(work, 'base');
    const after = join(work, 'head');
    extractDomainAt(ctx, ctx.base, before);
    extractDomainAt(ctx, null, after);
    const hasBefore = filesAt(ctx, ctx.base).includes('packages/domain/src/index.ts');
    const a = hasBefore ? domainDeclarations(join(before, 'src')) : '';
    const b = domainDeclarations(join(after, 'src'));
    return a !== b;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function checkContractDrift(ctx: GuardContext, list: readonly Change[]): Violation[] {
  const paths = list.flatMap((c) => [c.path, c.oldPath ?? '']);
  const specChanged = paths.includes('docs/specs/02-tech-spec.md');
  if (specChanged) {
    return [];
  }
  const violations: Violation[] = [];
  if (paths.some((p) => MIGRATION.test(p))) {
    violations.push({
      rule: 'contrato',
      detail: 'migração mudou sem linha no Apêndice A da 02-tech-spec.md (D-001)',
    });
  }
  if (paths.some((p) => p.startsWith('packages/domain/src/')) && domainApiChanged(ctx)) {
    violations.push({
      rule: 'contrato',
      detail:
        'API pública de packages/domain mudou sem linha no Apêndice A da 02-tech-spec.md (D-001)',
    });
  }
  return violations;
}

// ------------------------------------------------------------------ regras 6, 7 e 8: PR

export const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];
export const SCOPES = [
  'web',
  'domain',
  'nfce',
  'db',
  'sync',
  'fn',
  'pluggy',
  'push',
  'ci',
  'docs',
  'deps',
];

export function conventionalTitle(title: string): boolean {
  const re = new RegExp(`^(?:${TYPES.join('|')})(?:\\((?:${SCOPES.join('|')})\\))?!?: \\S.*[^.]$`);
  return title.length <= 100 && re.test(title);
}

export function checkPullRequest(ctx: GuardContext, list: readonly Change[]): Violation[] {
  if (ctx.eventName !== 'pull_request') {
    return [];
  }
  const violations: Violation[] = [];
  if (!ctx.prHeadRepo || ctx.prHeadRepo !== ctx.prBaseRepo) {
    violations.push({
      rule: 'origem',
      detail: `PR de fork (${ctx.prHeadRepo || 'desconhecido'}) não passa no portão: só o dono revisa e faz o merge`,
    });
  }
  if (!conventionalTitle(ctx.prTitle)) {
    violations.push({
      rule: 'titulo',
      detail: `título fora do Conventional Commits (tech §2.5): "${ctx.prTitle}"`,
    });
  }
  if (!/\bT-\d+\b/.test(ctx.prBody)) {
    violations.push({ rule: 'corpo', detail: 'corpo do PR sem o ID da tarefa (T-xxx)' });
  }
  if (
    /^fix(?:\([^)]*\))?!?:/.test(ctx.prTitle) &&
    !list.some((c) => c.status !== 'D' && isTestFile(c.path))
  ) {
    violations.push({
      rule: 'fix-sem-teste',
      detail: 'PR fix: precisa adicionar ou alterar um teste',
    });
  }
  return violations;
}

// ------------------------------------------------------------------ execução

export function isBootstrap(ctx: GuardContext): boolean {
  return !existsAt(ctx, ctx.base, 'scripts/ci-guard.ts');
}

export function runGuard(ctx: GuardContext): { violations: Violation[]; bootstrap: boolean } {
  const list = changes(ctx);
  const bootstrap = isBootstrap(ctx);
  const violations = [
    ...(bootstrap ? [] : checkProtected(ctx, list)),
    ...checkTestCount(ctx, list),
    ...checkForbidden(addedLines(ctx)),
    ...checkMigrations(ctx, list),
    ...checkContractDrift(ctx, list),
    ...checkPullRequest(ctx, list),
  ];
  return { violations, bootstrap };
}

export function contextFromEnv(env: NodeJS.ProcessEnv, cwd: string): GuardContext {
  return {
    cwd,
    base: env.GUARD_BASE || 'origin/main',
    eventName: env.EVENT_NAME ?? '',
    prTitle: env.PR_TITLE ?? '',
    prBody: env.PR_BODY ?? '',
    prHeadRepo: env.PR_HEAD_REPO ?? '',
    prBaseRepo: env.PR_BASE_REPO ?? '',
  };
}

export function main(ctx: GuardContext, log = console.log, error = console.error): number {
  const { violations, bootstrap } = runGuard(ctx);
  if (bootstrap) {
    log(
      'guard: modo bootstrap (scripts/ci-guard.ts ainda não está na base; caminhos protegidos liberados, D-004)',
    );
  }
  if (violations.length > 0) {
    error(`guard: ${violations.length} violação(ões)`);
    for (const v of violations) {
      error(`  [${v.rule}] ${v.detail}`);
    }
    return 1;
  }
  log(`guard: ok (base ${ctx.base})`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main(contextFromEnv(process.env, process.cwd()));
}
