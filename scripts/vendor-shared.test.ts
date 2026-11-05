import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COPIES, diffCopy, main } from './vendor-shared.ts';

let base: string;

function write(path: string, content: string): void {
  const full = join(base, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'vendor-'));
  for (const { from } of COPIES) {
    write(join(from, 'index.ts'), 'export const a = 1;\n');
    write(join(from, 'sub/b.ts'), 'export const b = 2;\n');
  }
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('vendor-shared', () => {
  it('--check falha quando a cópia não existe', () => {
    expect(main(['--check'], base)).toBe(1);
  });

  it('grava a cópia e depois --check passa', () => {
    expect(main([], base)).toBe(0);
    expect(main(['--check'], base)).toBe(0);
  });

  it('--check detecta arquivo diferente e arquivo sobrando', () => {
    main([], base);
    const [first] = COPIES;
    write(join(first.to, 'index.ts'), 'export const a = 2;\n');
    write(join(first.to, 'extra.ts'), '');
    const problems = diffCopy(base, first.from, first.to);
    expect(problems).toEqual([
      `diferente: ${join(first.to, 'index.ts')}`,
      `sobrando: ${join(first.to, 'extra.ts')}`,
    ]);
    expect(main(['--check'], base)).toBe(1);
  });
});
