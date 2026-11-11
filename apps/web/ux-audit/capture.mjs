// Capturas para a auditoria de UX (agente `ux-auditor`, ver `.claude/agents/ux-auditor.md`).
//
// Roda o build E2E (`VITE_E2E=1`) no `vite preview` e intercepta o Supabase local (127.0.0.1:54321) no Playwright:
// sessão falsa, `sync_push` que aceita tudo e `sync_pull` vazio (dica do HANDOFF §3). Os dados de exemplo entram
// pelos ganchos `window.__oakE2E` do próprio app, como nos testes E2E. Não precisa de Docker nem de rede.
//
// Uso (na pasta apps/web, depois do build):
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ux pnpm run build:e2e
//   node ux-audit/capture.mjs [pasta de saída] [--only=H01,T01] [--viewports=phone,desktop] [--themes=light]
//
// Saída: um PNG por tela × tamanho × tema e um `manifest.json` (rota, erros do console, rolagem horizontal).
// Nada aqui roda no CI: a pasta não está nos globs do Playwright nem do Vitest.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const OUT = resolve(args.find((a) => !a.startsWith('--')) ?? 'ux-audit/shots');
const opt = (name) =>
  args
    .find((a) => a.startsWith(`--${name}=`))
    ?.split('=')[1]
    ?.split(',');
const ONLY = opt('only');
const PORT = 4174;
const BASE = `http://localhost:${PORT}`;
const SUPABASE = 'http://127.0.0.1:54321';
const USER_ID = '7f1c2b9e-5a4d-4c3b-9e8f-1a2b3c4d5e6f';
const EMAIL = 'ux-audit@example.test';

const VIEWPORTS = {
  small: { width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const viewports = opt('viewports') ?? ['small', 'phone', 'desktop'];
const themes = opt('themes') ?? ['light', 'dark'];

// ---------- Supabase simulado ----------
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function session() {
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const claims = { sub: USER_ID, email: EMAIL, role: 'authenticated', aud: 'authenticated', exp };
  const user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: EMAIL,
    app_metadata: { provider: 'email' },
    user_metadata: { full_name: 'Marina Souza', name: 'Marina Souza' },
    created_at: '2026-11-01T12:00:00Z',
  };
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJh`,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: exp,
    refresh_token: 'ux-audit-refresh',
    user,
  };
}

const unhandled = new Set();
async function fakeSupabase(route) {
  const req = route.request();
  const url = new URL(req.url());
  const json = (body, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });
  if (req.method() === 'OPTIONS') {
    return route.fulfill({
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': '*',
      },
    });
  }
  const path = url.pathname;
  if (path.startsWith('/auth/v1/token') || path === '/auth/v1/signup') {
    return json(session());
  }
  if (path === '/auth/v1/user') {
    return json(session().user);
  }
  if (path === '/auth/v1/logout') {
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  if (path === '/rest/v1/rpc/sync_push') {
    const body = req.postDataJSON() ?? {};
    const results = (body.p_mutations ?? []).map((m) => ({
      mutation_id: m.mutation_id,
      status: 'applied',
      server_version: 1,
    }));
    return json({ results, server_time: new Date().toISOString() });
  }
  if (path === '/rest/v1/rpc/sync_pull') {
    const since = req.postDataJSON()?.p_since ?? 0;
    // o cursor precisa andar: com cursor 0 e a marca `oak.localData`, o app mostra o G08 (cópia local apagada)
    return json({
      rows: [],
      next: since + 1,
      has_more: false,
      server_time: new Date().toISOString(),
    });
  }
  if (path === '/rest/v1/rpc/get_row_history') {
    return json([]);
  }
  if (path.startsWith('/rest/v1/rpc/')) {
    return json(null);
  }
  if (path.startsWith('/functions/v1/')) {
    return json({ ok: true });
  }
  unhandled.add(`${req.method()} ${path}`);
  return json([]);
}

// ---------- servidor ----------
function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('vite preview não subiu em 30 s')), 30_000);
    child.stdout.on('data', (d) => {
      if (String(d).includes(String(PORT))) {
        clearTimeout(timer);
        ok(child);
      }
    });
    child.on('exit', (code) => fail(new Error(`vite preview saiu (${code})`)));
  });
}

// ---------- telas ----------
/** Telas logadas. `ctx` traz os ids criados no seed; `url` pode ser função. `act` abre sheets e painéis. */
const SCREENS = [
  { id: 'H01', url: '/' },
  {
    id: 'H01-S',
    url: '/',
    act: (p) =>
      p
        .getByRole('button', { name: /ver cálculo/i })
        .first()
        .click(),
  },
  { id: 'H02', url: '/avisos' },
  { id: 'Q01-despesa', url: '/?novo=despesa' },
  {
    id: 'Q01-despesa-valor',
    url: '/?novo=despesa',
    act: async (p) => {
      await p.keyboard.type('4590');
    },
  },
  {
    id: 'Q01-mais-detalhes',
    url: '/?novo=despesa',
    act: (p) =>
      p
        .getByRole('button', { name: /mais detalhes/i })
        .first()
        .click(),
  },
  { id: 'Q01-receita', url: '/?novo=receita' },
  { id: 'Q01-guardar', url: '/?novo=guardar' },
  { id: 'T01', url: '/lancamentos' },
  {
    id: 'T01-filtros',
    url: '/lancamentos',
    act: (p) =>
      p
        .getByRole('button', { name: /^filtros/i })
        .first()
        .click(),
  },
  { id: 'T02', url: (c) => `/lancamentos/${c.expenseId}` },
  { id: 'T02-parcela', url: (c) => `/lancamentos/${c.installmentTxId ?? c.expenseId}` },
  { id: 'C01', url: '/cartoes' },
  { id: 'C02', url: (c) => c.invoiceUrl ?? '/cartoes' },
  { id: 'P01', url: '/planejar/orcamento' },
  { id: 'P02', url: '/planejar/reserva' },
  { id: 'P03', url: '/planejar/futuro' },
  { id: 'P04', url: (c) => `/planejar/fechar/${c.prevMonth}` },
  { id: 'S01', url: '/ajustes' },
  { id: 'S03', url: '/ajustes/contas' },
  { id: 'S04', url: '/ajustes/categorias' },
  { id: 'S05', url: '/ajustes/renda' },
  { id: 'S06', url: '/ajustes/calculo' },
  { id: 'S07', url: '/ajustes/lembretes' },
  { id: 'S08', url: '/ajustes/aparencia' },
  { id: 'S09', url: '/ajustes/dados' },
  { id: 'S10', url: '/ajustes/diagnostico' },
  { id: 'I06', url: '/ajustes/regras' },
  { id: 'I01', url: '/ajustes/conexoes' },
  { id: 'I02', url: '/ajustes/conexoes/novo' },
  { id: 'I03', url: '/importar' },
  { id: 'I04', url: '/nota' },
  { id: 'I05', url: '/conferir' },
  { id: 'ON04', url: '/boas-vindas/lembretes' },
  { id: 'ON05', url: '/boas-vindas/renda' },
  { id: 'ON06', url: '/boas-vindas/contas' },
  { id: 'ON07', url: '/boas-vindas/cartoes' },
  { id: 'ON07b', url: '/boas-vindas/reserva' },
  { id: 'ON08', url: '/boas-vindas/pronto' },
];
/** Telas sem sessão. */
const PUBLIC = [
  { id: 'ON01', url: '/boas-vindas' },
  { id: 'ON02a', url: '/instalar?p=android' },
  { id: 'ON02b', url: '/instalar?p=ios' },
  { id: 'ON02c', url: '/instalar?p=desktop' },
  { id: 'ON03', url: '/entrar' },
];
/** Telas logadas antes de ter dados (estados vazios, US-63). */
const EMPTY = ['H01', 'T01', 'C01', 'P01', 'P02', 'P03', 'H02', 'I05', 'S03', 'S05'];

const wanted = (id) => !ONLY || ONLY.some((o) => id === o || id.startsWith(`${o}-`));

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(400);
}

async function newContext(browser, vp, theme) {
  const context = await browser.newContext({
    ...VIEWPORTS[vp],
    viewport: { width: VIEWPORTS[vp].width, height: VIEWPORTS[vp].height },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: theme,
    serviceWorkers: 'block',
  });
  await context.addInitScript((t) => {
    try {
      const raw = localStorage.getItem('oak.env');
      const prefs = raw ? JSON.parse(raw) : {};
      localStorage.setItem('oak.env', JSON.stringify({ ...prefs, theme: t }));
      // pula o convite de instalação e o guia, que cobririam as telas
      if (!localStorage.getItem('oak.install')) {
        localStorage.setItem('oak.install', JSON.stringify({ choice: 'browser', at: Date.now() }));
      }
    } catch {}
  }, theme);
  await context.route(`${SUPABASE}/**`, fakeSupabase);
  return context;
}

async function login(page) {
  await page.goto(`${BASE}/entrar`);
  const form = page.locator('[data-e2e-login] input[type=email]');
  await form.waitFor({ timeout: 15_000 });
  await form.fill(EMAIL);
  await page.locator('[data-e2e-login] button[type=submit]').click();
  await page.waitForFunction(() => Boolean(window.__oakE2E), null, { timeout: 20_000 });
  await page.evaluate(() => window.__oakE2E.syncNow());
  await settle(page);
}

async function seed(page) {
  return page.evaluate(async () => {
    const h = window.__oakE2E;
    const nubank = await h.addAccount('Nubank');
    const bb = await h.addAccount('Banco do Brasil');
    await h.addIncome(bb, 685000, 'Salário');
    await h.addIncome(nubank, 42000, 'Freela de revisão');
    const now = new Date();
    const day = (n) => {
      const d = new Date(now);
      d.setDate(d.getDate() - n);
      return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    };
    const expenseId = await h.addExpense(nubank, 18990, 'Mercado Bom Preço', day(0));
    await h.addExpense(nubank, 4590, 'Padaria São José', day(0));
    await h.addExpense(bb, 120000, 'Aluguel', day(2));
    await h.addExpense(nubank, 3200, 'Uber', day(1));
    await h.addExpense(nubank, 8750, 'Farmácia Drogasil', day(3));
    await h.addExpense(bb, 21430, 'Conta de luz Copel', day(4));
    const card = await h.addCard('Cartão Nubank', 3, 10);
    await h.addCardExpense(card, 5990, 'Spotify e Netflix');
    await h.addCardExpense(card, 32500, 'Restaurante Madero');
    await h.addCardInstallments(card, 359900, 6, 'Notebook');
    await h.addImported(nubank, 2790, 'PAG*IFOOD RESTAURANTE', 'suggested');
    await h.addImported(nubank, 15000, 'PIX ENVIADO JOAO P', 'new');
    await h.addNotice(
      'ux:invoice:1',
      'Fatura do Cartão Nubank vence em 3 dias',
      'R$ 3.984,90 até 10/11.',
      '/cartoes',
    );
    await h.syncNow();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { expenseId, cardId: card, prevMonth };
  });
}

async function findLinks(page, ctx) {
  await page.goto(`${BASE}/cartoes`);
  await settle(page);
  // a fatura e a linha do lançamento são botões que navegam: clica e lê a URL
  const opened = async (click, pattern) => {
    try {
      await click();
      await page.waitForURL(pattern, { timeout: 5000 });
      return new URL(page.url()).pathname;
    } catch {
      return null;
    }
  };
  ctx.invoiceUrl =
    (await opened(() => page.locator('.cards-invoice').first().click(), /\/fatura\//)) ?? undefined;
  await page.goto(`${BASE}/lancamentos`);
  await settle(page);
  const tx = await opened(
    () => page.getByText('Notebook', { exact: false }).first().click(),
    /\/lancamentos\/[^/?]+$/,
  );
  if (tx) {
    ctx.installmentTxId = tx.split('/').pop();
  }
}

async function shoot(page, screen, vp, theme, ctx, manifest, prefix = '') {
  const name = `${prefix}${screen.id}__${vp}__${theme}`;
  const url = typeof screen.url === 'function' ? screen.url(ctx) : screen.url;
  const errors = [];
  // o aviso do SW é do próprio roteiro (os SW ficam bloqueados para a captura ser estável)
  const onConsole = (m) =>
    m.type() === 'error' &&
    !m.text().includes('Service Worker') &&
    errors.push(m.text().slice(0, 300));
  const onError = (e) => errors.push(String(e).slice(0, 300));
  page.on('console', onConsole);
  page.on('pageerror', onError);
  let note = null;
  try {
    await page.goto(`${BASE}${url}`);
    await settle(page);
    if (screen.act) {
      await screen.act(page).catch((e) => {
        note = `ação não executada: ${String(e).split('\n')[0]}`;
      });
      await settle(page);
    }
    const metrics = await page.evaluate(() => ({
      finalUrl: location.pathname + location.search,
      title: document.title,
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
    }));
    // `tela`: o que cabe na tela, com as barras fixas no lugar certo. `pagina`: a página inteira (as barras fixas
    // aparecem onde a tela estava, não no fim) — só no celular claro, para economizar capturas.
    await page.screenshot({ path: resolve(OUT, `${name}.png`) });
    let full = null;
    if (vp === 'phone' && theme === 'light' && metrics.pageHeight > VIEWPORTS[vp].height + 40) {
      full = `${name}__pagina.png`;
      await page.screenshot({ path: resolve(OUT, full), fullPage: true });
    }
    manifest.push({
      file: `${name}.png`,
      full,
      screen: screen.id,
      viewport: vp,
      theme,
      url,
      ...metrics,
      note,
      errors,
    });
  } catch (e) {
    manifest.push({
      file: null,
      screen: screen.id,
      viewport: vp,
      theme,
      url,
      error: String(e).split('\n')[0],
    });
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onError);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const preview = await startPreview();
  const browser = await chromium.launch();
  const manifest = [];
  try {
    for (const vp of viewports) {
      for (const theme of themes) {
        // a parte escura só no celular padrão: o tema não muda layout
        if (theme === 'dark' && vp !== 'phone') {
          continue;
        }
        const context = await newContext(browser, vp, theme);
        const page = await context.newPage();
        for (const s of PUBLIC.filter((x) => wanted(x.id))) {
          await shoot(page, s, vp, theme, {}, manifest);
        }
        await login(page);
        for (const s of SCREENS.filter((x) => EMPTY.includes(x.id) && wanted(x.id))) {
          await shoot(page, s, vp, theme, {}, manifest, 'vazio-');
        }
        const ctx = await seed(page);
        await findLinks(page, ctx);
        for (const s of SCREENS.filter((x) => wanted(x.id))) {
          await shoot(page, s, vp, theme, ctx, manifest);
        }
        await context.close();
        console.log(`ok: ${vp} ${theme}`);
      }
    }
  } finally {
    await browser.close();
    preview.kill();
    writeFileSync(
      resolve(OUT, 'manifest.json'),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), unhandled: [...unhandled], shots: manifest },
        null,
        2,
      ),
    );
  }
  const failed = manifest.filter((m) => !m.file);
  console.log(`${manifest.length - failed.length} capturas em ${OUT}; ${failed.length} falharam`);
}

await main();
