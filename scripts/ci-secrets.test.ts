import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkFixtureReadmes,
  cpfValid,
  emailAllowed,
  luhnValid,
  main,
  nfceKeyValid,
  parseAddedLines,
  scanFile,
  scanLine,
  scanRepository,
} from './ci-secrets.ts';

// Os casos positivos são gerados em tempo de execução: nenhum dado que o scanner
// reprovaria fica escrito neste arquivo (CLAUDE.md §4).

function cpfDigit(base: string): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * (base.length + 1 - i);
  }
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

function makeCpf(seed: string): string {
  const d1 = cpfDigit(seed);
  const d2 = cpfDigit(seed + d1);
  return `${seed}${d1}${d2}`;
}

function formatCpf(cpf: string): string {
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function luhnCheckDigit(partial: string): number {
  for (let d = 0; d <= 9; d++) {
    if (luhnValid(partial + d)) {
      return d;
    }
  }
  throw new Error('sem dígito');
}

function makeCard(prefix: string, length: number): string {
  const body = (prefix + '7319028465'.repeat(2)).slice(0, length - 1);
  return body + luhnCheckDigit(body);
}

function makeNfceKey(body43: string): string {
  for (let d = 0; d <= 9; d++) {
    if (nfceKeyValid(body43 + d)) {
      return body43 + d;
    }
  }
  throw new Error('sem DV');
}

function flip(digits: string): string {
  const last = Number(digits.at(-1));
  return digits.slice(0, -1) + ((last + 1) % 10);
}

const email = (local: string, domain: string) => [local, domain].join('@');

describe('validadores', () => {
  it('CPF: aceita DV válido e recusa DV inválido e sequências repetidas', () => {
    const cpf = makeCpf('529982247');
    expect(cpfValid(cpf)).toBe(true);
    expect(cpfValid(formatCpf(cpf))).toBe(true);
    expect(cpfValid(flip(cpf))).toBe(false);
    expect(cpfValid('1'.repeat(11))).toBe(false);
    expect(cpfValid('123')).toBe(false);
  });

  it('Luhn: aceita e recusa', () => {
    const card = makeCard('4', 16);
    expect(luhnValid(card)).toBe(true);
    expect(luhnValid(flip(card))).toBe(false);
    expect(luhnValid('7')).toBe(false);
  });

  it('chave NFC-e: DV módulo 11', () => {
    const key = makeNfceKey('4126110000000000000065001000000001100000001'.slice(0, 43));
    expect(nfceKeyValid(key)).toBe(true);
    expect(nfceKeyValid(flip(key))).toBe(false);
    expect(nfceKeyValid('1'.repeat(43))).toBe(false);
  });

  it('e-mails permitidos', () => {
    expect(emailAllowed(email('ana', 'example.test'))).toBe(true);
    expect(emailAllowed(email('ana', 'example.com'))).toBe(true);
    expect(emailAllowed(email('noreply', 'qualquer.org'))).toBe(true);
    expect(emailAllowed(email('1+bot', 'users.noreply.github.com'))).toBe(true);
    expect(emailAllowed(email('ana', 'gmail.com'))).toBe(false);
    expect(emailAllowed(email('ana', 'example.com.br'))).toBe(false);
  });
});

describe('scanLine', () => {
  it('reprova e-mail real e aceita @example.test', () => {
    expect(scanLine('a.ts', `const e = '${email('pessoa', 'gmail.com')}';`, 3)).toEqual([
      expect.objectContaining({ file: 'a.ts', line: 3, rule: 'email' }),
    ]);
    expect(scanLine('a.ts', `const e = '${email('a', 'example.test')}';`, 1)).toEqual([]);
  });

  it('não confunde pacote com versão nem escopo npm com e-mail', () => {
    expect(scanLine('p.json', '"vitest@5.1.0", "@oakfinance/web", "react@19.3.1"', 1)).toEqual([]);
  });

  it('reprova CPF válido, com e sem máscara, e aceita CPF com DV inválido', () => {
    const cpf = makeCpf('390533447');
    expect(scanLine('a.ts', `cpf ${cpf}`, 1).map((f) => f.rule)).toEqual(['cpf']);
    expect(scanLine('a.ts', `cpf ${formatCpf(cpf)}`, 1).map((f) => f.rule)).toEqual(['cpf']);
    expect(scanLine('a.ts', `cpf ${flip(cpf)}`, 1)).toEqual([]);
  });

  it('reprova cartão Luhn de 13 a 19 dígitos com bandeira, inclusive com espaços', () => {
    for (const [prefix, length] of [
      ['4', 16],
      ['51', 16],
      ['37', 15],
      ['6062', 16],
      ['4', 13],
      ['4', 19],
    ] as const) {
      const card = makeCard(prefix, length);
      expect(scanLine('a.ts', `n=${card};`, 1).map((f) => f.rule)).toContain('cartao');
    }
    const spaced = makeCard('52', 16).replace(/(\d{4})(?=\d)/g, '$1 ');
    expect(scanLine('a.ts', spaced, 1).map((f) => f.rule)).toContain('cartao');
  });

  it('aceita número Luhn sem bandeira, com DV inválido ou dentro de hash', () => {
    const timestamp = makeCard('20', 14); // timestamp de migração, sem bandeira
    expect(scanLine('m.sql', timestamp, 1)).toEqual([]);
    expect(scanLine('a.ts', flip(makeCard('4', 16)), 1)).toEqual([]);
    expect(scanLine('l.yaml', `sha512-Ab${makeCard('4', 16)}Xy`, 1)).toEqual([]);
  });

  it('reprova chave de NFC-e válida fora de fixtures e aceita dentro', () => {
    const key = makeNfceKey('4126110000000000000065001000000001100000001'.slice(0, 43));
    expect(scanLine('src/a.ts', key, 1).map((f) => f.rule)).toContain('chave-nfce');
    expect(scanLine('test/fixtures/a.html', key, 1).map((f) => f.rule)).not.toContain('chave-nfce');
    expect(scanLine('src/a.ts', flip(key), 1).map((f) => f.rule)).not.toContain('chave-nfce');
  });

  it('fixtures também passam pelas regras de CPF e e-mail', () => {
    const rules = scanLine(
      'packages/domain/test/fixtures/x.csv',
      `${email('a', 'gmail.com')};${makeCpf('111444777')}`,
      1,
    ).map((f) => f.rule);
    expect(rules).toEqual(['email', 'cpf']);
  });
});

describe('scanFile', () => {
  it('.env* só .env.example e supabase/.env.test', () => {
    expect(scanFile('.env', '')).toHaveLength(1);
    expect(scanFile('apps/web/.env.local', '')).toHaveLength(1);
    expect(scanFile('.env.example', '')).toEqual([]);
    expect(scanFile('supabase/.env.test', '')).toEqual([]);
  });

  it('OFX e CSV só em fixtures/', () => {
    expect(scanFile('extrato.ofx', '')).toHaveLength(1);
    expect(scanFile('docs/nubank.CSV', '')).toHaveLength(1);
    expect(scanFile('packages/domain/test/fixtures/bb.ofx', '')).toEqual([]);
  });

  it('HTML de NFC-e e JSON da Pluggy só em fixtures/', () => {
    expect(scanFile('tmp/nota.html', '<title>NFC-e</title>')).toHaveLength(1);
    expect(scanFile('tmp/sefaz-pr.html', '')).toHaveLength(1);
    expect(scanFile('apps/web/index.html', '<title>OakFinance</title>')).toEqual([]);
    expect(scanFile('tmp/resp.json', '{"itemId": "x"}')).toHaveLength(1);
    expect(scanFile('scripts/fixtures/resp.json', '{"itemId": "x"}')).toEqual([]);
    expect(scanFile('package.json', '{"name": "x"}')).toEqual([]);
  });
});

describe('checkFixtureReadmes', () => {
  it('exige README.md em cada pasta fixtures/', () => {
    expect(
      checkFixtureReadmes([
        'a/fixtures/x.ofx',
        'a/fixtures/README.md',
        'b/test/fixtures/sub/y.html',
      ]),
    ).toEqual([expect.objectContaining({ file: 'b/test/fixtures', rule: 'fixtures-readme' })]);
  });
});

describe('parseAddedLines', () => {
  it('lê arquivo e número das linhas adicionadas', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,0 +2,2 @@',
      '+linha dois',
      '+linha três',
      'diff --git a/y.ts b/y.ts',
      '--- a/y.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-apagada',
    ].join('\n');
    expect(parseAddedLines(diff)).toEqual(
      new Map([
        [
          'x.ts',
          [
            { line: 2, text: 'linha dois' },
            { line: 3, text: 'linha três' },
          ],
        ],
      ]),
    );
  });
});

describe('scanRepository em repositório git temporário', () => {
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', email('ci', 'example.test'));
    run('config', 'user.name', 'ci');
    writeFileSync(join(dir, 'ok.ts'), 'export const a = 1;\n');
    run('add', '.');
    run('commit', '-q', '-m', 'base');
    run('switch', '-q', '-c', 'pr');
    return dir;
  }

  function commit(dir: string): void {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'pr'], { cwd: dir });
  }

  it('passa quando o diff está limpo e reprova quando adiciona dados pessoais', () => {
    const dir = repo();
    try {
      writeFileSync(join(dir, 'b.ts'), `export const e = '${email('a', 'example.test')}';\n`);
      commit(dir);
      expect(scanRepository(dir, 'main')).toEqual([]);
      expect(main(['--base', 'main'], dir)).toBe(0);

      mkdirSync(join(dir, 'fixtures'));
      writeFileSync(join(dir, 'fixtures', 'c.csv'), `x;${makeCpf('987654321')}\n`);
      writeFileSync(join(dir, '.env.local'), 'X=1\n');
      commit(dir);
      const rules = scanRepository(dir, 'main')
        .map((f) => f.rule)
        .sort();
      expect(rules).toEqual(['cpf', 'env', 'fixtures-readme']);
      expect(main(['--base', 'main'], dir)).toBe(1);
      expect(main(['--all'], dir)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
