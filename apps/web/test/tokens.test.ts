import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseColor, type Rgba } from '../src/lib/contrast';

// Contraste da UX §4.3 calculado a partir de tokens.css (não de valores copiados no teste). Visual D-023.
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

// Visual menta (D-023): fundo liso, cards sólidos. O pior fundo claro é a própria menta; no escuro, o grafite.
const lightBackdrop = stops(light, 'bg-backdrop')[0] as Rgba;
const darkBackdrop = stops(dark, 'bg-backdrop')[0] as Rgba;

const card = (map: Map<string, string>, level: 1 | 2 | 3, backdrop: Rgba) =>
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

/** Elementos que não são texto (WCAG 1.4.11) e precisam de 3:1 sobre o card. */
const NON_TEXT = [
  'band-needs',
  'band-wants',
  'band-savings',
  'status-warning-fill',
  'status-danger-fill',
  'border-strong',
  'focus-ring-color',
  // UXA-006: preenchimento "info" (barra, faixa do banner, controle) precisa aparecer nos dois temas
  'status-info-fill',
  // G5/UXB-023: contorno da opção escolhida precisa aparecer sobre o card nos dois temas
  'selection-outline',
] as const;

describe('US-62: contraste do tema claro (UX §4.3)', () => {
  const surfaces: Array<[string, Rgba]> = [
    ['card 1', card(light, 1, lightBackdrop)],
    ['card 2', card(light, 2, lightBackdrop)],
    ['card 3', card(light, 3, lightBackdrop)],
    ['fundo menta', lightBackdrop],
    ['branco', WHITE],
  ];

  it('o fundo claro é a menta #EEFDE0, liso', () => {
    expect(lightBackdrop).toEqual(parseColor('#EEFDE0'));
    expect(stops(light, 'bg-backdrop')).toEqual([lightBackdrop, lightBackdrop]);
  });

  for (const token of [...TEXT_TOKENS, 'violet-700']) {
    for (const [surface, bg] of surfaces) {
      it(`texto --${token} sobre ${surface} ≥ 4,5:1`, () => {
        expect(contrastRatio(color(light, token), bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('os números batem com a tabela da §4.3 (método conferido)', () => {
    expect(contrastRatio(color(light, 'text-primary'), WHITE)).toBeCloseTo(19.51, 1);
    expect(contrastRatio(color(light, 'text-primary'), lightBackdrop)).toBeCloseTo(18.36, 1);
    expect(contrastRatio(color(light, 'text-tertiary'), WHITE)).toBeCloseTo(7.61, 1);
    expect(contrastRatio(color(light, 'on-accent'), color(light, 'accent'))).toBeCloseTo(13.47, 1);
  });

  it('direto no fundo menta, todo o texto passa (não há vidro sobre gradiente)', () => {
    for (const token of TEXT_TOKENS) {
      expect(contrastRatio(color(light, token), lightBackdrop), token).toBeGreaterThanOrEqual(4.5);
    }
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
    expect(contrastRatio(color(light, 'on-accent'), color(light, 'accent'))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrastRatio(color(light, 'on-dark'), color(light, 'surface-dark')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(color(light, 'on-dark-muted'), color(light, 'surface-dark')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('não texto sobre o card no pior caso ≥ 3:1 (WCAG 1.4.11)', () => {
    const c2 = surfaces[1]?.[1] as Rgba;
    for (const token of NON_TEXT) {
      expect(contrastRatio(color(light, token), c2), token).toBeGreaterThanOrEqual(3);
    }
    // a lima é preenchimento de seleção: separa do card pelo contorno preto (2 px), não pela cor
    expect(contrastRatio(color(light, 'ink-950'), c2)).toBeGreaterThanOrEqual(3);
  });
});

describe('US-62: contraste do tema escuro (UX §4.3)', () => {
  const surfaces: Array<[string, Rgba]> = [
    ['card 1', card(dark, 1, darkBackdrop)],
    ['card 2', card(dark, 2, darkBackdrop)],
    ['card 3', card(dark, 3, darkBackdrop)],
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
    const c3 = surfaces[2]?.[1] as Rgba;
    for (const token of [...NON_TEXT, 'accent']) {
      expect(contrastRatio(color(dark, token), c3), token).toBeGreaterThanOrEqual(3);
    }
  });

  it('D-084 item 4: o cartão do mês usa superfície elevada (não #000) e o texto dele passa', () => {
    expect(value(dark, 'surface-dark').toLowerCase()).not.toBe('#000000');
    const c2 = surfaces[1]?.[1] as Rgba;
    expect(contrastRatio(color(dark, 'surface-dark'), c2)).toBeGreaterThan(1);
    expect(color(dark, 'surface-dark')).not.toEqual(c2);
    expect(
      contrastRatio(color(dark, 'on-dark'), color(dark, 'surface-dark')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(color(dark, 'on-dark-muted'), color(dark, 'surface-dark')),
    ).toBeGreaterThanOrEqual(4.5);
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
    expect(value(light, 'glass-2-bg')).toBe('#ffffff');
    expect(value(light, 'glass-2-blur')).toBe('0px');
  });

  it('parseColor aceita #RGB, rgb() e recusa o resto', () => {
    expect(parseColor('#fff')).toEqual(WHITE);
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(() => parseColor('azul')).toThrow();
    expect(() => value(light, 'nao-existe')).toThrow();
    expect(() => block(':root[data-x]')).toThrow();
  });
});
