import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregate, main, ratchet } from './coverage-ratchet.ts';

const entry = (lt: number, lc: number, bt: number, bc: number) => ({
  lines: { total: lt, covered: lc },
  branches: { total: bt, covered: bc },
});

describe('coverage-ratchet', () => {
  it('agrega por prefixo, com caminhos absolutos', () => {
    const summary = {
      total: entry(100, 100, 10, 10),
      '/r/apps/web/src/data/db.ts': entry(10, 9, 4, 3),
      '/r/apps/web/src/data/sync/push.ts': entry(10, 10, 4, 4),
      '/r/apps/web/src/app/App.tsx': entry(10, 5, 2, 1),
    };
    expect(aggregate(summary, '/r', 'apps/web/src/data')).toEqual({ lines: 95, branches: 87.5 });
    expect(aggregate(summary, '/r', 'apps/web/src')?.lines).toBeCloseTo(80);
    expect(aggregate(summary, '/r', 'packages/domain')).toBeNull();
  });

  it('só sobe, arredondando para baixo', () => {
    const base = { $comment: 'x', a: { lines: 90, branches: 80 }, b: { lines: 80 } };
    expect(ratchet(base, { a: { lines: 97.8, branches: 70 }, b: null, c: { lines: 100 } })).toEqual(
      { $comment: 'x', a: { lines: 97, branches: 80 }, b: { lines: 80 } },
    );
  });

  it('main grava a baseline nova e não mexe quando nada sobe', () => {
    const root = mkdtempSync(join(tmpdir(), 'ratchet-'));
    try {
      const write = (path: string, data: unknown) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), typeof data === 'string' ? data : JSON.stringify(data));
      };
      write('coverage-baseline.json', {
        'packages/domain': { lines: 95, branches: 90 },
        'supabase/functions/_shared': { lines: 80 },
      });
      write('packages/domain/coverage/coverage-summary.json', {
        [join(root, 'packages/domain/src/index.ts')]: entry(100, 99, 10, 10),
      });
      write(
        'coverage/fn.lcov',
        `SF:${join(root, 'supabase/functions/_shared/http.ts')}\nLF:10\nLH:9\nend_of_record\n`,
      );
      const logs: string[] = [];
      expect(main(root, (l) => logs.push(l))).toBe(0);
      expect(JSON.parse(readFileSync(join(root, 'coverage-baseline.json'), 'utf8'))).toEqual({
        'packages/domain': { lines: 99, branches: 100 },
        'supabase/functions/_shared': { lines: 90 },
      });
      expect(main(root, (l) => logs.push(l))).toBe(0);
      expect(logs.at(-1)).toContain('já está no máximo');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
