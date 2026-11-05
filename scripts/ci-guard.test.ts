import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  baselineDecreases,
  biomeIgnoreWithoutReason,
  checkForbidden,
  conventionalTitle,
  countTests,
  destructiveStatements,
  type GuardContext,
  isProtected,
  main,
  runGuard,
} from './ci-guard.ts';

// Trechos proibidos montados em partes: este arquivo também passa pelo guard.
const dot = (a: string, b: string) => `${a}.${b}`;
const ONLY = dot('it', 'only');
const SKIP = dot('describe', 'skip');
const NOCHECK = ['@ts', 'nocheck'].join('-');
const BI = ['biome', 'ignore'].join('-');
const XIT = ['x', 'it'].join('');
const IGNORE_TRUE = ['ignore', 'true'].join(': ');

let dir: string;

function write(path: string, content: string): void {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

function commit(message = 'x'): void {
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', message);
}

const GOOD_BODY = 'Tarefa: T-006 — guard';

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    cwd: dir,
    base: 'main',
    eventName: 'pull_request',
    prTitle: 'feat(ci): cria o guard',
    prBody: GOOD_BODY,
    prHeadRepo: 'dono/repo',
    prBaseRepo: 'dono/repo',
    ...overrides,
  };
}

function rules(c = ctx()): string[] {
  return runGuard(c).violations.map((v) => v.rule);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'guard-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'ci@example.test');
  git('config', 'user.name', 'ci');
  write('scripts/ci-guard.ts', '// guard\n');
  write('biome.json', '{}\n');
  write(
    'coverage-baseline.json',
    JSON.stringify({ 'packages/domain': { lines: 95, branches: 90 } }),
  );
  write('packages/domain/src/index.ts', 'export const a = 1;\n');
  write('packages/domain/test/a.test.ts', "it('um', () => {});\nit('dois', () => {});\n");
  write('supabase/tests/database/001-x.test.sql', 'select plan(3);\n');
  write('supabase/migrations/20261105000001_base.sql', 'create table t (id int);\n');
  write('docs/specs/02-tech-spec.md', '# spec\n');
  commit('base');
  git('switch', '-q', '-c', 'pr');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('funções puras', () => {
  it('caminhos protegidos', () => {
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/dependabot.yml',
      'biome.json',
      'apps/web/vitest.config.ts',
      'vitest.config.ts',
      'apps/web/playwright.config.ts',
      'scripts/ci-guard.ts',
      'scripts/ci-secrets.ts',
      '.gitleaks.toml',
      'supabase/tests/database/000-setup.test.sql',
      'lefthook.yml',
    ]) {
      expect(isProtected(path), path).toBe(true);
    }
    for (const path of ['scripts/ci-greps.ts', 'apps/web/src/a.ts', 'coverage-baseline.json']) {
      expect(isProtected(path), path).toBe(false);
    }
  });

  it('baseline só sobe', () => {
    const before = { $comment: 'x', a: { lines: 90, branches: 80 } };
    expect(baselineDecreases(before, { a: { lines: 91, branches: 80 } })).toEqual([]);
    expect(baselineDecreases(before, { a: { lines: 89.5, branches: 80 } })).toEqual([
      'a.lines: 90 → 89.5',
    ]);
    expect(baselineDecreases(before, {})).toHaveLength(2);
  });

  it('conta casos de teste em TS, Deno e pgTAP', () => {
    expect(countTests('a.test.ts', "it('a', f); test('b', f); it.each([1])('c', f);")).toBe(3);
    expect(countTests('a.test.ts', "Deno.test('x', f);\nDeno.test({ name: 'y', fn });")).toBe(2);
    expect(countTests('a.test.sql', 'select plan(4);\nselect plan( 2 );')).toBe(6);
    expect(countTests('a.test.ts', 'const split = 1; // nada')).toBe(0);
  });

  it('proibições em linhas adicionadas', () => {
    const found = checkForbidden(
      new Map([
        ['a.test.ts', [`${ONLY}('x', f)`, `${SKIP}('y', f)`, `${XIT}('z', f)`, `// ${NOCHECK}`]],
        ['b.test.ts', [`Deno.test({ name: 'a', ${IGNORE_TRUE}, fn })`]],
        ['c.ts', [`// ${BI} lint/style/noX`]],
        ['d.test.sql', ["select skip('motivo', 1);"]],
        ['e.ts', [`const options = { ${IGNORE_TRUE} };`, `// ${BI} lint/a/b: motivo claro`]],
      ]),
    ).map((v) => v.detail.split(' em ')[0]);
    expect(found).toEqual([
      '.only/.skip/.todo',
      '.only/.skip/.todo',
      'xit/xdescribe/fit',
      NOCHECK,
      'only/ignore true',
      `${BI} sem justificativa`,
      'skip( no pgTAP',
    ]);
  });

  it('ignore do Biome precisa de motivo depois dos dois-pontos', () => {
    expect(biomeIgnoreWithoutReason(`// ${BI} lint/a/b: texto do workflow`)).toBe(false);
    expect(biomeIgnoreWithoutReason(`// ${BI} lint/a/b:`)).toBe(true);
    expect(biomeIgnoreWithoutReason(`// ${BI} lint/a/b`)).toBe(true);
    expect(biomeIgnoreWithoutReason(`// ${BI}`)).toBe(true);
  });

  it('DDL destrutivo, ignorando comentários', () => {
    expect(destructiveStatements('DROP TABLE x;')).toHaveLength(1);
    expect(destructiveStatements('alter table t alter column c type text;')).toHaveLength(1);
    expect(destructiveStatements('alter table t rename to u;')).toHaveLength(1);
    expect(destructiveStatements('truncate t;')).toHaveLength(1);
    expect(destructiveStatements('alter table t drop column c;')).toHaveLength(1);
    expect(destructiveStatements('-- drop table x\n/* truncate */ create table y();')).toEqual([]);
  });

  it('título Conventional Commits com escopos da tech §2.5', () => {
    expect(conventionalTitle('feat(domain): atribui compra à fatura')).toBe(true);
    expect(conventionalTitle('docs: bloqueia T-010')).toBe(true);
    expect(conventionalTitle('revert: volta o commit x')).toBe(true);
    expect(conventionalTitle('[WIP] feat(ci): algo')).toBe(false);
    expect(conventionalTitle('feat(outro): algo')).toBe(false);
    expect(conventionalTitle('feat: termina com ponto.')).toBe(false);
    expect(conventionalTitle(`feat: ${'a'.repeat(100)}`)).toBe(false);
  });
});

describe('guard em repositório git temporário', () => {
  it('PR limpo passa', () => {
    write('packages/domain/test/b.test.ts', "it('três', () => {});\n");
    commit();
    expect(rules()).toEqual([]);
    expect(
      main(
        ctx(),
        () => {},
        () => {},
      ),
    ).toBe(0);
  });

  it('caminho protegido reprova, exceto no modo bootstrap', () => {
    write('biome.json', '{"x":1}\n');
    write('.github/workflows/ci.yml', 'name: ci\n');
    commit();
    expect(rules()).toEqual(['caminho-protegido', 'caminho-protegido']);
    git('switch', '-q', '-c', 'base-sem-guard', 'main');
    git('rm', '-q', 'scripts/ci-guard.ts');
    commit('sem guard');
    git('switch', '-q', 'pr');
    const result = runGuard(ctx({ base: 'base-sem-guard' }));
    expect(result.bootstrap).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('baseline de cobertura pode subir e não pode descer', () => {
    write(
      'coverage-baseline.json',
      JSON.stringify({ 'packages/domain': { lines: 96, branches: 90 } }),
    );
    commit();
    expect(rules()).toEqual([]);
    write(
      'coverage-baseline.json',
      JSON.stringify({ 'packages/domain': { lines: 94, branches: 90 } }),
    );
    commit();
    expect(rules()).toEqual(['cobertura']);
  });

  it('teste removido ou caso a menos reprova', () => {
    write('packages/domain/test/a.test.ts', "it('um', () => {});\n");
    commit();
    expect(rules()).toEqual(['testes']);
    unlinkSync(join(dir, 'packages/domain/test/a.test.ts'));
    commit();
    expect(rules()).toEqual(['testes', 'testes']);
  });

  it('pgTAP com plano menor reprova', () => {
    write('supabase/tests/database/001-x.test.sql', 'select plan(2);\n');
    commit();
    expect(rules()).toEqual(['testes']);
  });

  it('.only adicionado reprova', () => {
    write('packages/domain/test/a.test.ts', `it('um', () => {});\n${ONLY}('dois', () => {});\n`);
    commit();
    expect(rules()).toContain('proibido');
  });

  it('migração mergeada não muda; migração nova sem DDL destrutivo e com Apêndice A', () => {
    write('supabase/migrations/20261105000001_base.sql', 'create table t (id bigint);\n');
    write('docs/specs/02-tech-spec.md', '# spec\n| linha |\n');
    commit();
    expect(rules()).toEqual(['migracao']);
  });

  it('migração nova destrutiva reprova; sem spec, também drift de contrato', () => {
    write('supabase/migrations/20261105000002_x.sql', 'drop table t;\n');
    commit();
    expect(rules().sort()).toEqual(['contrato', 'migracao']);
  });

  it('migração nova aditiva com Apêndice A passa', () => {
    write('supabase/migrations/20261105000002_x.sql', 'create table u (id int);\n');
    write('docs/specs/02-tech-spec.md', '# spec\n| apêndice |\n');
    commit();
    expect(rules()).toEqual([]);
  });

  it('API pública do domínio mudou sem spec reprova; mudança interna passa', () => {
    write('packages/domain/src/internal.ts', 'const x = 2;\nexport {};\n');
    commit();
    expect(rules()).toEqual([]);
    write(
      'packages/domain/src/index.ts',
      'export const a = 1;\nexport function b(): number { return 2; }\n',
    );
    commit();
    expect(rules()).toEqual(['contrato']);
    write('docs/specs/02-tech-spec.md', '# spec\n| apêndice |\n');
    commit();
    expect(rules()).toEqual([]);
  });

  it('PR: título, corpo, fork e fix sem teste', () => {
    commit();
    expect(rules(ctx({ prTitle: '[WIP] feat(ci): x' }))).toEqual(['titulo']);
    expect(rules(ctx({ prBody: 'sem tarefa' }))).toEqual(['corpo']);
    expect(rules(ctx({ prHeadRepo: 'outro/repo' }))).toEqual(['origem']);
    expect(rules(ctx({ prTitle: 'fix(domain): corrige x' }))).toEqual(['fix-sem-teste']);
    expect(rules(ctx({ eventName: 'push', prTitle: '', prBody: '' }))).toEqual([]);
  });

  it('fix com teste passa', () => {
    write(
      'packages/domain/test/a.test.ts',
      "it('um', () => {});\nit('dois', () => {});\nit('três', () => {});\n",
    );
    commit();
    expect(rules(ctx({ prTitle: 'fix(domain): corrige x' }))).toEqual([]);
  });

  it('main imprime as violações e devolve 1', () => {
    write('lefthook.yml', 'x: 1\n');
    commit();
    const errors: string[] = [];
    expect(
      main(
        ctx(),
        () => {},
        (line) => errors.push(line),
      ),
    ).toBe(1);
    expect(errors.join('\n')).toContain('lefthook.yml é protegido');
  });
});
