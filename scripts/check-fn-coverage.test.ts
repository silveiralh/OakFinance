import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check, isCounted, main, sumLcov } from './check-fn-coverage.ts';

const record = (file: string, found: number, hit: number) =>
  `SF:${file}\nLF:${found}\nLH:${hit}\nend_of_record`;

describe('check-fn-coverage', () => {
  it('conta só _shared, sem as cópias vendorizadas e sem testes', () => {
    expect(isCounted('supabase/functions/_shared/http.ts')).toBe(true);
    expect(isCounted('supabase/functions/_shared/domain/index.ts')).toBe(false);
    expect(isCounted('supabase/functions/_shared/nfce/index.ts')).toBe(false);
    expect(isCounted('supabase/functions/_shared/http.test.ts')).toBe(false);
    expect(isCounted('supabase/functions/nfce-fetch/index.ts')).toBe(false);
  });

  it('soma LF/LH com caminhos absolutos e file://', () => {
    const lcov = [
      record('file:///repo/supabase/functions/_shared/http.ts', 10, 9),
      record('/repo/supabase/functions/_shared/errors.ts', 10, 7),
      record('/repo/supabase/functions/_shared/domain/index.ts', 100, 0),
    ].join('\n');
    expect(sumLcov(lcov, '/repo')).toEqual({ found: 20, hit: 16 });
  });

  it('aplica o limiar', () => {
    expect(check({ found: 10, hit: 8 }, 80)).toEqual({ ok: true, pct: 80 });
    expect(check({ found: 10, hit: 7 }, 80).ok).toBe(false);
    expect(check({ found: 0, hit: 0 }, 80).ok).toBe(true);
  });

  it('main lê a baseline e o lcov', () => {
    const root = mkdtempSync(join(tmpdir(), 'fncov-'));
    try {
      writeFileSync(
        join(root, 'coverage-baseline.json'),
        JSON.stringify({ 'supabase/functions/_shared': { lines: 80 } }),
      );
      const lcov = join(root, 'fn.lcov');
      writeFileSync(lcov, record(join(root, 'supabase/functions/_shared/http.ts'), 10, 9));
      expect(main(lcov, root)).toBe(0);
      writeFileSync(lcov, record(join(root, 'supabase/functions/_shared/http.ts'), 10, 5));
      expect(main(lcov, root)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
