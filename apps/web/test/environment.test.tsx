import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENV_ATTRIBUTES,
  ENV_STORAGE_KEY,
  readEnvironment,
  readEnvironmentPrefs,
  setEnvironmentPrefs,
  subscribeEnvironment,
} from '../src/lib/environment';
import { useEnvironment } from '../src/lib/useEnvironment';

const here = dirname(fileURLToPath(import.meta.url));
const envScript = readFileSync(join(here, '../public/env.js'), 'utf8');

interface Device {
  dark?: boolean;
  reducedMotion?: boolean;
  reducedTransparency?: boolean;
  blur?: boolean;
  memory?: number;
  cores?: number;
}

const listeners: Array<() => void> = [];

function device(d: Device) {
  const media: Record<string, boolean> = {
    '(prefers-color-scheme: dark)': d.dark ?? false,
    '(prefers-reduced-motion: reduce)': d.reducedMotion ?? false,
    '(prefers-reduced-transparency: reduce)': d.reducedTransparency ?? false,
  };
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: media[query] ?? false,
        addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      }) as unknown as MediaQueryList,
  );
  vi.stubGlobal('CSS', { supports: () => d.blur ?? true });
  Object.defineProperty(navigator, 'deviceMemory', { value: d.memory ?? 8, configurable: true });
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    value: d.cores ?? 8,
    configurable: true,
  });
}

/** Executa o public/env.js real, como o navegador faria no <head>. */
const runEnvScript = new Function(envScript) as () => void;

const root = document.documentElement;
const attrs = () => Object.fromEntries(ENV_ATTRIBUTES.map((a) => [a, root.getAttribute(a)]));

beforeEach(() => {
  for (const a of ENV_ATTRIBUTES) {
    root.removeAttribute(a);
  }
  document.head.innerHTML =
    '<meta name="theme-color" content="#EEFDE0" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#0B0D0A" media="(prefers-color-scheme: dark)">';
  localStorage.clear();
  listeners.length = 0;
  delete window.oakEnv;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public/env.js (UX §4.1, §4.10)', () => {
  it('US-62: sem preferência, segue o sistema claro; vidro, movimento completo, desempenho normal, valores visíveis', () => {
    device({});
    runEnvScript();
    expect(attrs()).toEqual({
      'data-theme': 'light',
      'data-glass': 'glass',
      'data-motion': 'full',
      'data-perf': 'normal',
      'data-values': 'shown',
    });
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(metas.map((m) => m.getAttribute('content'))).toEqual(['#EEFDE0', '#EEFDE0']);
  });

  it('D-025: com o sistema escuro e sem preferência salva, o app abre no claro', () => {
    device({ dark: true });
    runEnvScript();
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#EEFDE0',
    );
  });

  it('US-62: tema Automático com sistema escuro, movimento e transparência reduzidos, aparelho modesto', () => {
    device({ dark: true, reducedMotion: true, reducedTransparency: true, memory: 4, cores: 8 });
    localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify({ theme: 'auto' }));
    runEnvScript();
    expect(attrs()).toMatchObject({
      'data-theme': 'dark',
      'data-glass': 'solid',
      'data-motion': 'reduced',
      'data-perf': 'low',
    });
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(
      '#0B0D0A',
    );
  });

  it('RN-103/US-62: a preferência salva vence o sistema (valores ocultos); sem backdrop-filter o vidro vira sólido', () => {
    device({ dark: true, reducedMotion: true, blur: false, cores: 4 });
    localStorage.setItem(
      ENV_STORAGE_KEY,
      JSON.stringify({ theme: 'light', motion: 'full', values: 'hidden' }),
    );
    runEnvScript();
    expect(attrs()).toEqual({
      'data-theme': 'light',
      'data-glass': 'solid',
      'data-motion': 'full',
      'data-perf': 'low',
      'data-values': 'hidden',
    });
  });

  it('preferência corrompida ou sem matchMedia não quebra; mudança do sistema reaplica', () => {
    device({});
    localStorage.setItem(ENV_STORAGE_KEY, '{quebrado');
    runEnvScript();
    expect(root.getAttribute('data-theme')).toBe('light');
    localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify({ theme: 'auto' }));
    device({ dark: true });
    for (const cb of listeners) {
      cb();
    }
    expect(root.getAttribute('data-theme')).toBe('dark');
    vi.stubGlobal('matchMedia', undefined);
    runEnvScript();
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('expõe window.oakEnv com o mesmo resolve', () => {
    device({});
    runEnvScript();
    expect(window.oakEnv?.key).toBe(ENV_STORAGE_KEY);
    expect(window.oakEnv?.resolve({ theme: 'dark', glass: 'solid', motion: 'reduced' })).toEqual({
      theme: 'dark',
      glass: 'solid',
      motion: 'reduced',
      perf: 'normal',
      values: 'shown',
    });
  });
});

describe('src/lib/environment e useEnvironment', () => {
  it('readEnvironment usa os padrões quando os atributos faltam ou são inválidos', () => {
    root.setAttribute('data-theme', 'roxo');
    expect(readEnvironment()).toEqual({
      theme: 'light',
      glass: 'glass',
      motion: 'full',
      perf: 'normal',
      values: 'shown',
    });
  });

  it('setEnvironmentPrefs grava, reaplica pelo env.js e o hook acompanha', async () => {
    device({});
    runEnvScript();
    const { result } = renderHook(() => useEnvironment());
    expect(result.current.theme).toBe('light');
    const first = result.current;
    await act(async () => {
      setEnvironmentPrefs({ theme: 'dark' });
      await Promise.resolve();
    });
    expect(result.current.theme).toBe('dark');
    expect(result.current).not.toBe(first);
    expect(readEnvironmentPrefs()).toEqual({ theme: 'dark' });
    await act(async () => {
      setEnvironmentPrefs({ values: 'hidden' });
      await Promise.resolve();
    });
    expect(result.current).toMatchObject({ theme: 'dark', values: 'hidden' });
    expect(readEnvironmentPrefs()).toEqual({ theme: 'dark', values: 'hidden' });
  });

  it('sem o env.js, aplica só o explícito; sem armazenamento, não lança', () => {
    expect(setEnvironmentPrefs({ theme: 'dark', values: 'hidden' })).toMatchObject({
      theme: 'dark',
      values: 'hidden',
    });
    expect(setEnvironmentPrefs({ theme: 'auto' }).theme).toBe('dark');
    localStorage.setItem(ENV_STORAGE_KEY, '[1]');
    expect(readEnvironmentPrefs()).toEqual({});
    localStorage.setItem(ENV_STORAGE_KEY, 'null');
    expect(readEnvironmentPrefs()).toEqual({});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    expect(readEnvironmentPrefs()).toEqual({});
    expect(() => setEnvironmentPrefs({ values: 'shown' })).not.toThrow();
  });

  it('subscribeEnvironment avisa e para de avisar ao cancelar', async () => {
    const spy = vi.fn();
    const stop = subscribeEnvironment(spy);
    root.setAttribute('data-values', 'hidden');
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
    stop();
    spy.mockClear();
    root.setAttribute('data-values', 'shown');
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });
});
