// Ambiente resolvido antes do primeiro paint (UX §4.1 e §4.10): data-theme, data-glass, data-motion, data-perf e
// data-values no <html>, mais o <meta name="theme-color">. É um script clássico e bloqueante no <head>, servido do
// próprio domínio, porque a CSP (tech §7.1) não aceita script inline. Preferências de UI em localStorage 'oak.env'.
(() => {
  const KEY = 'oak.env';
  const root = document.documentElement;

  const read = () => {
    try {
      const raw = window.localStorage.getItem(KEY);
      const value = raw ? JSON.parse(raw) : null;
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  };

  const matches = (query) => {
    try {
      return Boolean(window.matchMedia?.(query).matches);
    } catch {
      return false;
    }
  };

  const blurSupported = () => {
    try {
      return Boolean(
        window.CSS?.supports?.('backdrop-filter', 'blur(1px)') ||
          window.CSS?.supports?.('-webkit-backdrop-filter', 'blur(1px)'),
      );
    } catch {
      return false;
    }
  };

  const resolve = (prefs) => {
    const nav = window.navigator ?? {};
    // D-025: o claro é o padrão mesmo com o sistema no escuro; o escuro só com a escolha "Escuro" ou "Automático"
    const theme =
      prefs.theme === 'dark' || (prefs.theme === 'auto' && matches('(prefers-color-scheme: dark)'))
        ? 'dark'
        : 'light';
    const glass =
      prefs.glass === 'solid' ||
      matches('(prefers-reduced-transparency: reduce)') ||
      !blurSupported()
        ? 'solid'
        : 'glass';
    const motion =
      prefs.motion === 'full' || prefs.motion === 'reduced'
        ? prefs.motion
        : matches('(prefers-reduced-motion: reduce)')
          ? 'reduced'
          : 'full';
    // Heurística da UX §4.5 (a parte de quadros por segundo é medida pelo app depois da primeira rolagem)
    const perf =
      (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) ||
      (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4)
        ? 'low'
        : 'normal';
    const values = prefs.values === 'hidden' ? 'hidden' : 'shown';
    return { theme, glass, motion, perf, values };
  };

  const apply = () => {
    const env = resolve(read());
    for (const name of ['theme', 'glass', 'motion', 'perf', 'values']) {
      root.setAttribute(`data-${name}`, env[name]);
    }
    const color = env.theme === 'dark' ? '#0B0D0A' : '#EEFDE0';
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', color);
    }
    return env;
  };

  apply();
  for (const query of [
    '(prefers-color-scheme: dark)',
    '(prefers-reduced-motion: reduce)',
    '(prefers-reduced-transparency: reduce)',
  ]) {
    try {
      window.matchMedia?.(query).addEventListener?.('change', apply);
    } catch {
      // navegador sem matchMedia: fica com o que foi resolvido
    }
  }
  window.oakEnv = { key: KEY, apply, resolve };
})();
