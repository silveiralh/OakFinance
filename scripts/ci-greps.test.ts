import { describe, expect, it } from 'vitest';
import { grepContent } from './ci-greps.ts';

// Montado em partes para o próprio arquivo de teste não cair na regra.
const newDate = ['new', 'Date'].join(' ');

const rules = (file: string, content: string) => grepContent(file, content).map((f) => f.rule);

describe('greps proibidos', () => {
  it('parseFloat/toFixed: proibido no domínio e nas features, livre em money.ts', () => {
    expect(rules('packages/domain/src/budget.ts', 'x.toFixed(2)')).toEqual(['money-float']);
    expect(rules('apps/web/src/features/a/B.tsx', 'parseFloat(v)')).toEqual(['money-float']);
    expect(rules('packages/domain/src/money.ts', 'x.toFixed(2)')).toEqual([]);
    expect(rules('apps/web/src/lib/format.ts', 'x.toFixed(2)')).toEqual([]);
  });

  it("new Date('YYYY-MM-DD') literal é proibido; com horário não", () => {
    expect(rules('packages/domain/test/a.test.ts', `${newDate}('2026-11-05')`)).toEqual([
      'date-literal',
    ]);
    expect(rules('apps/web/src/x.ts', `${newDate}("2026-11-05")`)).toEqual(['date-literal']);
    expect(rules('apps/web/src/x.ts', `${newDate}('2026-11-05T12:00:00Z')`)).toEqual([]);
    expect(rules('supabase/functions/_shared/domain/x.ts', `${newDate}('2026-11-05')`)).toEqual([]);
  });

  it('console.log proibido em src/', () => {
    expect(rules('apps/web/src/main.tsx', 'console.log(1)')).toEqual(['console-log']);
    expect(rules('packages/domain/src/a.ts', 'console.log(1)')).toEqual(['console-log']);
    expect(rules('scripts/x.ts', 'console.log(1)')).toEqual([]);
    expect(rules('apps/web/src/a.ts', 'console.error(1)')).toEqual([]);
  });

  it('localStorage só em lib/', () => {
    expect(rules('apps/web/src/features/x.ts', 'localStorage.getItem("a")')).toEqual([
      'local-storage',
    ]);
    expect(rules('apps/web/src/lib/storage.ts', 'localStorage.getItem("a")')).toEqual([]);
  });

  it('workflows: set -x e echo de secrets', () => {
    expect(rules('.github/workflows/ci.yml', '  run: set -euxo pipefail')).toEqual([
      'workflow-set-x',
    ]);
    expect(rules('.github/workflows/ci.yml', '  run: set -euo pipefail')).toEqual([]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: texto de workflow do GitHub Actions
    expect(rules('.github/workflows/d.yml', 'echo "${{ secrets.TOKEN }}"')).toEqual([
      'workflow-echo-secret',
    ]);
    expect(rules('.github/workflows/d.yml', 'echo "ok"')).toEqual([]);
  });

  it('arquivos fora das regras não são lidos linha a linha', () => {
    expect(grepContent('README.md', 'console.log(1) parseFloat(2)')).toEqual([]);
  });
});
