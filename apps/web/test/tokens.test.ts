import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseColor, type Rgba } from '../src/lib/contrast';

// Contraste da UX §4.3 calculado a partir de tokens.css (não de valores copiados no teste).
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '../src/styles/tokens.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) {
    throw new Error(`bloco ${selector} ausente`);
  }
  const body = css.slice(start + selector.length + 2, css.indexOf('\n}', start));
  const map = new Map<string, string>();
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(m[1] ?? '', (m[2] ?? '').replace(/\s+/g, ' ').trim());
  }
  return map;
}

const light = block(':root');
const darkOnly = block(':root[data-theme="dark"]');
const dark = new Map([...light, ...darkOnly]);

function value(map: Map<string, string>, name: string): string {
  const raw = map.get(name);
  if (raw === undefined) {
    throw new Error(`token --${name} ausente`);
  }
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  return ref ? value(map, ref[1] ?? '') : raw;
}

const color = (map: Map<string, string>, name: string): Rgba => parseColor(value(map, name));

/** Cores das paradas de um gradiente (hex). */
function stops(map: Map<string, string>, name: string): Rgba[] {
  return [...value(map, name).matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => parseColor(m[0]));
}

const WHITE = parseColor('#ffffff');

// Pior pixel do fundo: claro = topo do gradiente; escuro = base #0E3A57 + realce aqua + 6% de brilho.
const lightBackdrop = stops(light, 'bg-backdrop')[0] as Rgba;
const darkBackdrop = (() => {
  const gradient = value(dark, 'bg-backdrop');
  const glow = /rgba\(47, 182, 238, ([\d.]+)\)/.exec(gradient);
  const base = stops(dark, 'bg-backdrop').at(-1) as Rgba;
  const withGlow = composite({ ...parseColor('rgb(47, 182, 238)'), a: Number(glow?.[1]) }, base);
  return composite({ ...WHITE, a: 0.06 }, withGlow);
})();

const glass = (map: Map<string, string>, level: 1 | 2 | 3, backdrop: Rgba) =>
  composite(color(map, `glass-${level}-bg`), backdrop);

const TEXT_TOKENS = [
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'text-link',
  'money-income',
  'status-warning-fg',
  'status-danger-fg',
] as const;

describe('US-62: contraste do tema claro (UX §4.3)', () => {
  const surfaces: Array<[string, Rgba]> = [
    ['vidro 1', glass(light, 1, lightBackdrop)],
    ['vidro 2', glass(light, 2, lightBackdrop)],
    ['vidro 3', glass(light, 3, lightBackdrop)],
    ['sólido', color(light, 'surface-solid-2')],
    ['branco', WHITE],
  ];

  it('o pior pixel do fundo claro é #4FB6EC', () => {
    expect(lightBackdrop).toEqual(parseColor('#4FB6EC'));
  });

  for (const token of [...TEXT_TOKENS, 'violet-700']) {
    for (const [surface, bg] of surfaces) {
      it(`texto --${token} sobre ${surface} ≥ 4,5:1`, () => {
        expect(contrastRatio(color(light, token), bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('os números batem com a tabela da §4.3 (método conferido)', () => {
    const g1 = surfaces[0]?.[1] as Rgba;
    expect(contrastRatio(color(light, 'text-primary'), g1)).toBeCloseTo(10.36, 1);
    expect(contrastRatio(color(light, 'text-tertiary'), g1)).toBeCloseTo(4.67, 1);
    expect(contrastRatio(color(light, 'text-primary'), lightBackdrop)).toBeCloseTo(6.83, 1);
    expect(contrastRatio(color(light, 'text-primary'), WHITE)).toBeCloseTo(15.54, 1);
  });

  it('direto no fundo, só --text-primary passa', () => {
    expect(contrastRatio(color(light, 'text-primary'), lightBackdrop)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color(light, 'text-secondary'), lightBackdrop)).toBeLessThan(4.5);
  });

  it('pares de componente ≥ 4,5:1', () => {
    for (const stop of stops(light, 'grad-primary')) {
      expect(contrastRatio(color(light, 'text-on-primary'), stop)).toBeGreaterThanOrEqual(4.5);
    }
    for (const stop of stops(light, 'grad-success')) {
      expect(contrastRatio(color(light, 'text-on-success'), stop)).toBeGreaterThanOrEqual(4.5);
    }
    for (const stop of stops(light, 'grad-danger')) {
      expect(contrastRatio(color(light, 'text-on-danger'), stop)).toBeGreaterThanOrEqual(4.5);
    }
    for (const status of ['info', 'success', 'warning', 'danger']) {
      expect(
        contrastRatio(color(light, `status-${status}-fg`), color(light, `status-${status}-bg`)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrastRatio(color(light, 'text-primary'), color(light, 'status-info-bg')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('não texto sobre vidro 2 no pior caso ≥ 3:1 (WCAG 1.4.11)', () => {
    const g2 = surfaces[1]?.[1] as Rgba;
    for (const token of [
      'band-needs',
      'band-wants',
      'band-savings',
      'status-warning-fill',
      'status-danger-fill',
      'border-strong',
      'aqua-650',
      'focus-ring-color',
    ]) {
      expect(contrastRatio(color(light, token), g2), token).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('US-62: contraste do Aero noturno (UX §4.3)', () => {
  const surfaces: Array<[string, Rgba]> = [
    ['vidro 1', glass(dark, 1, darkBackdrop)],
    ['vidro 2', glass(dark, 2, darkBackdrop)],
    ['vidro 3', glass(dark, 3, darkBackdrop)],
    ['sólido', color(dark, 'surface-solid-2')],
    ['fundo base', color(dark, 'bg-base')],
  ];

  for (const token of [...TEXT_TOKENS, 'violet-300']) {
    for (const [surface, bg] of surfaces) {
      it(`texto --${token} sobre ${surface} ≥ 4,5:1`, () => {
        expect(contrastRatio(color(dark, token), bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('pares de componente ≥ 4,5:1 e não texto ≥ 3:1', () => {
    for (const [grad, on] of [
      ['grad-primary', 'text-on-primary'],
      ['grad-success', 'text-on-success'],
      ['grad-danger', 'text-on-danger'],
    ] as const) {
      for (const stop of stops(dark, grad)) {
        expect(contrastRatio(color(dark, on), stop), grad).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const status of ['info', 'success', 'warning', 'danger']) {
      expect(
        contrastRatio(color(dark, `status-${status}-fg`), color(dark, `status-${status}-bg`)),
      ).toBeGreaterThanOrEqual(4.5);
    }
    const g2 = surfaces[1]?.[1] as Rgba;
    for (const token of [
      'band-needs',
      'band-wants',
      'band-savings',
      'status-warning-fill',
      'status-danger-fill',
      'border-strong',
      'aqua-500',
      'focus-ring-color',
    ]) {
      expect(contrastRatio(color(dark, token), g2), token).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('tokens.css', () => {
  it('US-62: alvos de toque ≥ 48 px e campos com fonte ≥ 16 px', () => {
    expect(value(light, 'touch-min')).toBe('48px');
    expect(value(light, 'font-size-body')).toBe('1rem');
  });

  it('US-62: alternativa sólida, desempenho e movimento reduzido da §4.2', () => {
    expect(css).toContain(':root[data-glass="solid"]');
    expect(css).toContain(':root[data-perf="low"]');
    expect(css).toContain(':root[data-motion="reduced"]');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(value(light, 'glass-2-bg')).toBe('rgba(255, 255, 255, 0.72)');
  });

  it('parseColor aceita #RGB, rgb() e recusa o resto', () => {
    expect(parseColor('#fff')).toEqual(WHITE);
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(() => parseColor('azul')).toThrow();
    expect(() => value(light, 'nao-existe')).toThrow();
    expect(() => block(':root[data-x]')).toThrow();
  });
});
