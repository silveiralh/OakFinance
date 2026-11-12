// T-117: defeitos sistêmicos de CSS da auditoria de UX (G1, G2, G6). Lê os arquivos de estilo, sem navegador.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) =>
  readFileSync(join(here, '../src', rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const FILES = [
  'styles/tokens.css',
  'styles/base.css',
  'styles/fonts.css',
  'ui/ui.css',
  'app/shell.css',
];
const all = FILES.map(read).join('\n');

describe('T-117: base visual', () => {
  it('UXC-009/UXA-006: todo var(--x) usado nos estilos tem definição (nenhum token do Aero esquecido)', () => {
    const defined = new Set([...all.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...all.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] ?? ''));
    // locais (--_x) são definidos no próprio componente ou têm valor padrão; --tw-* são do Tailwind
    const missing = [...used].filter(
      (name) => !defined.has(name) && !name.startsWith('--_') && !name.startsWith('--tw-'),
    );
    expect(missing).toEqual([]);
    expect(all).not.toContain('--aqua-700');
  });

  it('UXA-005/UXB-014: nenhuma classe própria com nome de utilitário do Tailwind', () => {
    for (const utility of [
      'ring',
      'shadow',
      'table',
      'hidden',
      'grid',
      'flex',
      'border',
      'rounded',
    ]) {
      expect(all, utility).not.toMatch(new RegExp(`(^|[\\s,}])\\.${utility}\\s*[{,:[]`, 'm'));
    }
    expect(read('ui/ui.css')).toContain('.budget-ring {');
  });

  it('UXA-007/UXB-008/UXC-005: os títulos têm peso e entrelinha próprios depois do preflight', () => {
    const base = read('styles/base.css');
    expect(base.indexOf('@import "tailwindcss"')).toBe(0);
    expect(base).toMatch(/h1,\s*h2,\s*h3\s*\{[^}]*font-weight:\s*var\(--font-weight-bold\)/);
    expect(base).toMatch(/h2\s*\{[^}]*font-size:\s*var\(--font-size-heading\)/);
    expect(read('app/shell.css')).toMatch(
      /\.screen-title\s*\{[^}]*line-height:\s*var\(--line-height-snug\)/,
    );
  });

  it('UXA-015/UXB-007: passos numerados e seta no select', () => {
    expect(read('ui/ui.css')).toMatch(/\.install-steps\s*\{[^}]*list-style:\s*decimal/);
    expect(read('ui/ui.css')).toContain('.field-chevron');
  });

  it('D-084 item 3: rótulo das abas com 13 px', () => {
    expect(read('ui/ui.css')).toMatch(
      /\.tab-label\s*\{[^}]*font-size:\s*var\(--font-size-caption\)/,
    );
    expect(read('styles/tokens.css')).toMatch(/--font-size-caption:\s*0\.8125rem/);
  });

  it('pílulas de categoria (D-085): fluem em linhas, nome inteiro e ícone sem encolher', () => {
    const ui = read('ui/ui.css');
    expect(ui).toMatch(/\.chip-grid\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap/);
    expect(ui).not.toMatch(/\.chip-grid\s*\{[^}]*grid-template-columns/);
    expect(ui).toMatch(/\.chip-grid \.chip svg\s*\{[^}]*flex-shrink:\s*0/);
  });

  it('UXD-012: .reconcile-diffs volta à regra da lista da I05', () => {
    expect(read('app/shell.css')).toMatch(/\.reconcile-diffs,\s*\.inbox-list\s*\{/);
  });
});
