# HANDOFF — passagem de bastão entre sessões

> Repositório público: nada de segredos, e-mails, nomes, documentos ou dados reais neste arquivo.

## 1. Estado atual

- Tooling da raiz (T-001): pnpm 10.34.9 (Corepack), Node 24, Biome 2.6.5, lefthook, commitlint, template de PR, `docs/DECISIONS.md` (D-001..D-007), Apêndice A na `02-tech-spec.md`, issue #2 `Setup do cliente`.
- Workspaces (T-002): `packages/domain`, `packages/nfce-parser` e `apps/web` (Vite 8.3.6, React 19.3.1, TS 6.0.3, Tailwind 4.3.4), Vitest 5.1 com limiares de `coverage-baseline.json`, Playwright 1.64.1 (android, iphone, desktop), `scripts/mock-pluggy.ts` e `scripts/vendor-shared.ts`. `pnpm verify` verde.
- Supabase local (T-003): `supabase/config.toml` com serviços mínimos, `seed.sql`, helpers pgTAP (`000-setup.test.sql`, API do basejump) e smoke, `supabase/functions/deno.json`, `_shared/errors.ts` e `_shared/http.ts` com testes Deno. Scripts `test:db`, `test:fn` e `typecheck:deno`.
- CI (T-004): `.github/workflows/ci.yml` com os 8 checks (`guard` em modo bootstrap, `secrets`, `lint-types`, `unit`, `db`, `fn`, `e2e` agregando 3 shards, `build`), `scripts/ci-secrets.ts`, `.gitleaks.toml`, `scripts/check-build.ts`, `scripts/ci-greps.ts`, `scripts/check-fn-coverage.ts` e `pnpm ci:local`.
- Workflows (T-005): `deploy.yml` (backup → staging → produção → smoke; pula com aviso sem `vars.SUPABASE_PROD_REF`), `backup.yml` (dump cifrado), `keepalive.yml` (`ping` e `ops_health` em prod e staging), `nightly.yml` (E2E ×3, Stryker, gitleaks no histórico, audit, keepalive em 48 h), `preview.yml` + `preview-deploy.yml`, `dependabot.yml` e `packages/domain/stryker.config.json`.
- Guard (T-006): `scripts/ci-guard.ts` (caminhos protegidos, testes não caem, proibições, migrações imutáveis e sem DDL destrutivo, drift de contrato via `.d.ts` do domínio, `fix:` com teste, título e `T-xxx`, PR de fork) e `scripts/coverage-ratchet.ts` (`pnpm coverage:ratchet`, só sobe). O `ci.yml` também roda em `edited`, para o guard reavaliar título e corpo.
- **Bootstrap encerrado:** a partir de agora, mudar `.github/**`, `biome.json`, `vitest.config.*`, `playwright.config.ts`, `scripts/ci-guard.ts`, `scripts/ci-secrets.ts`, `.gitleaks.toml`, `000-setup.test.sql` ou `lefthook.yml`, ou baixar `coverage-baseline.json`, reprova o guard e exige o rótulo `needs-owner`.
- Banco (T-008/T-009): migrações 01 (base), 02 (núcleo), 03 (integrações e push) e 04 (sync, histórico, observabilidade e RPCs `sync_push`/`sync_pull`/`get_row_history`/`map_external_account`/push/`log_events`/`ping`); `db-types.ts` gerado e checado no job `db`; pgTAP `010-core-checks` e `020-sync`.
- RLS e cadastro fechado (T-010): migrações 05 (RLS forçada em todo `public`, D-009) e 06 (perfil no cadastro e hook `before_user_created`); hook ligado no `config.toml` local e allowlist `e2e-a`/`e2e-b@example.test` no `seed.sql`; pgTAP `030-rls`.
- Cron e sync no banco (T-011): migração 07 (`invoke_function`, `enqueue_pluggy_sync`, `purge` que pula pais com filho vivo e grava `job_runs`, 5 jobs do cron) e `ops_health()`; pgTAP `040-purge`; testes de integração `apps/web/test/integration/sync-db.int.test.ts` (usuários reais pela Admin API, rodam no `pnpm test:db` via `scripts/test-int.sh`).
- Domínio base (T-012): `types`, `money`, `dates`, `ids` (namespaces v5 fixos) e `DomainError` em `packages/domain`, com testes de propriedade (fast-check, 200 execuções) e cobertura 100/97; cópia em `supabase/functions/_shared/domain` com `uuid` no import map do Deno.
- Faturas (T-013): `packages/domain/src/invoices.ts` com os 9 casos da RN-12, os 6 exemplos da §5.2, status da RN-14, saldo credor da RN-15 e recálculo da RN-17/RN-18.
- Parcelas (T-014): `installments.ts` com a RN-21 (resto na 1ª), RN-22 (parcela k em F1 + k − 1), carnê na conta, `startInstallment`, RN-24 (`INSTALLMENTS_LOCKED`) e RN-25 (cancelar restantes).
- Recorrências (T-015): `recurrence.ts` com mensal/semanal/anual (dia 31 e 29/02 pela RN-03), `maxOccurrences` desde o início, projeção até M+12, materialização idempotente com fatura (RN-29) e confirmações automáticas vencidas (RN-28).
- Orçamento (T-016): `budget.ts` com renda do mês (RN-32..RN-38), mês de orçamento pela RN-46, metas 50/30/20 (RN-44), "já foi"/"vai sair" (RN-45), "Sem faixa" e limiares (RN-92).
- Disponível para gastar (T-017): `spendable.ts` com a fórmula da RN-47, valor por dia, selo da RN-50 e recálculo de 5.000 lançamentos em menos de 200 ms (RN-51).
- Reserva (T-018): `reserve.ts` com a meta sugerida da RN-52, progresso e resgates (RN-55/RN-56) e ETA pelos aportes.
- Categorização e seeds (T-019): `categorization.ts` (RN-57..RN-64) e `defaults.ts` (lista da RN-40, 32 regras da RN-64, lembretes, orçamento e reserva padrão).
- QR da NFC-e (T-023): `nfce/qr.ts` com `parseNfceQr` (v2/v3, online e contingência), DV módulo 11 e allowlist `*.fazenda.pr.gov.br` (`isNfceHostAllowed`).
- Conciliação I (T-020): `reconciliation.ts` com candidatos e janelas da RN-66, decisão da RN-67 (1:1, empate, aproximado), RN-68 e duplicidade entre fontes da RN-72; chaves da RN-65.
- Conciliação II (T-021): fatura do banco (RN-19, `invoiceForImported`), parcelas importadas (RN-69: `installmentMarkerOf`, `linkImportedInstallment`, `importedInstallmentPlan` com "importada parcialmente"), recorrência variável pelo termo (RN-70 no `reconcile`/`planMerge`, `matchPatternFor`), pagamento de fatura, "Pagamento recebido" ignorado e transferência sugerida (RN-71: `detectInvoicePayments`, `invoicePaymentPatch`, `detectIgnoredCardCredits`, `detectInternalTransfers`).
- Importação OFX/CSV (T-022): `imports/ofx.ts` (SGML 1.02 do BB e XML 2.x, Windows-1252/UTF-8, `[-3:BRT]` sem converter para UTC, vírgula decimal, limites de 5 MB e 5.000 transações), `imports/csv.ts` (presets Nubank provisórios, `sniffCsvProfile`, `mapCsvRows` com erros por linha) e fixtures sintéticas em `packages/domain/test/fixtures/`.
- Lembretes (T-024): `notifications.ts` com `dueNotifications` para os 9 tipos (RN-86..RN-94), textos do UX 6.7, `hideValues`, janela de 15 min, silêncio (`deliverAt`/`stillDue`) e resumo semanal com a versão curta; `settings.ts` com `ProfileSettings` e padrões. **F2 (domínio) concluída.**
- Design system base (T-025): `apps/web/src/styles/tokens.css` (UX §4.2), `fonts.css` (Manrope e Inter variáveis, só latin e latin-ext), `base.css` com a receita `.glass`; `public/env.js` (ambiente antes do primeiro paint, D-013) e `src/lib/environment.ts` + `useEnvironment`; `src/i18n/pt-BR.ts` com as 194 chaves da UX §6.4 (teste compara com a spec); `src/lib/contrast.ts` e teste de contraste da §4.3 calculado dos tokens; marca em `src/brand/*.svg` e `public/favicon.svg`; `scripts/build-icons.mjs` (sharp) gera os PNG e o `favicon.ico` em `public/` a cada build (arquivos no `.gitignore`).
- Componentes de base (T-026): `apps/web/src/ui/` (Button, IconButton, FAB, GlassCard, AppBackdrop, Badge, MoneyText, TextField/Select/Switch, SegmentedControl com rádios nativos, Skeleton, EmptyState, Banner, Toast com fila e BrandLogo) e `ui.css` só com tokens; textos de acessibilidade dos componentes em `uiText` (`pt-BR.ts`). `apps/web` agora depende de `@oakfinance/domain` (workspace) e de `@phosphor-icons/react`.
- Componentes de entrada (T-027): AmountInput (caixa eletrônico, máximo RN-01, colar, região viva) + NumericKeypad, CategoryChip/CategoryPicker, PaymentMethodPicker, InstallmentStepper (até 48, Total/Parcela, RN-20), DateChip, BottomSheet (`<dialog>`, foco preso, `confirmClose`) e Dialog (`alertdialog` no destrutivo).
- Componentes de dados (T-028): PaceIndicator (RN-50), ProgressBar, BudgetRing, GoalProgress, InvoiceCard/InvoiceMini, TransactionRow, SyncBadge, TopBar/TabBar e InstallGuide; rota `/__styleguide` só no build E2E (import dinâmico atrás de `VITE_E2E`) e snapshot visual `apps/web/e2e/styleguide.spec.ts-snapshots/tokens-*.png` (gerado no contêiner do CI; atualizar exige `needs-owner`). **F3 (design system) concluída.**
- AppShell, rotas e CSP (T-029): React Router 8.5.1 (data mode) com as rotas da UX §2.1/§3 em `src/app/screens.ts` (lazy por `src/features/*/screens.tsx`, telas ainda como `ScreenStub`), AppShell (`src/app/AppShell.tsx` + `shell.css`: pular para o conteúdo, TopBar, `main#conteudo`, abas com FAB, barra lateral no `lg`, ToastProvider), `<title>` "{Tela} · OakFinance" (nomes em `shellText.screens`, iguais aos títulos da UX §3), G09 (`ScreenError`, com código `E-XXXXXX`) no AppShell e na raiz, S00 (`Splash`) como `HydrateFallback`; `src/lib/env.ts` (zod) e `__APP_VERSION__`; `apps/web/_headers.template` + `scripts/gen-headers.ts` (o build grava `dist/_headers`; o `vite preview` aplica as regras, então o E2E roda com a CSP real) e `public/_redirects`.
- PWA (T-030): vite-plugin-pwa 2.0.0 em `injectManifest` com `src/sw/sw.ts` (precache do shell, `NavigationRoute`, CacheFirst para fontes/ícones/`.wasm`, NetworkOnly para `*.supabase.co`, `SKIP_WAITING`, push declarativo, `notificationclick`, `sync` → `RUN_SYNC`, `pushsubscriptionchange` → `PUSH_RESUBSCRIBE`) com a lógica pura em `src/sw/handlers.ts`; manifest em `src/lib/manifest.ts` (igual à UX §4.11.5 + `id`/`scope`); registro e G07 em `src/lib/sw-update.ts` + `src/app/UpdatePrompt.tsx` (toast "Nova versão disponível." / "Atualizar"; recarga só sem `?novo=` na URL). `check-build.ts` com `REQUIRE_PWA = true` (precache ~0,85 MB).
- Dados locais (T-031): Dexie 4.4.7 com `src/data/db.ts` (schema v1 literal da tech §4.2, banco `oakfinance_<userId>`, `OutboxEntry` da §4.4, `deleteUserDb`), `schemas.ts` **gerado** de `db-types.ts` por `scripts/gen-schemas.ts` (`pnpm db:schemas`; o teste `scripts/gen-schemas.test.ts` reprova drift), `mappers.ts` (Row ↔ Tx/Card/Account/Category, `parseRow`, `toServerRow`), `queries.ts` (`isLive`, `countsInTotals`, `listedTransactions`, `transactionsForTotals`, `liveRows`), `storage.ts` (`initStorage`, `probeIndexedDb`, `persist`/`estimate`, `writeLocal` → `Result` com `STORAGE_QUOTA`/`STORAGE_UNAVAILABLE`/`STORAGE_FAILED`), `drafts.ts` (rascunho em memória + `kv`) e os banners G11/G12 (`src/app/StorageBanners.tsx`).
- Outbox e repositórios (T-032): `src/data/sync/clock.ts` (`nextHlc`, `hlcNow` gravando `hlc_last`, `updateServerOffset`/`recordServerTime` com média móvel e corte de RTT > 2 s, `deviceId` v7), `src/data/sync/outbox.ts` (`enqueue` com coalescência só em `queued`, `takeBatch` de 200 → `inflight`, `markDone`, `requeue`, `markRejected`, `pendingCount`, `rejectedEntries`), `src/data/repositories/rows.ts` (`saveRow`, `deleteRow` lógico, `restoreRow` para o "Desfazer") e `cascade.ts` (cartão → faturas e transações, série → parcelas, recibo → itens), tudo numa transação Dexie e via `writeLocal`; `src/data/ids.ts` (`newId` v7).
- Motor de sync (T-033): `src/data/sync/transport.ts` (`SyncTransport`, `callRpc` com timeout de 15 s e classes `retry`/`auth`/`fatal`, `fromSupabase`), `push.ts` (lotes de 200 × 10; `applied`/`duplicate` → fora da fila; `stale` grava a linha do servidor se não houver outra edição local; `rejected` → `markRejected`), `pull.ts` (páginas de 500, cursor na transação da página, proteção da edição local mais nova, `reset_required` preservando `outbox`/`sync_state`/`kv`, `server_time` → deslocamento do relógio, expurgo local de tombstones > 30 dias) e `engine.ts` (`SyncEngine`: Web Locks `oakfinance-sync` com trinco em memória sem a API, push → pull → telemetria, backoff 5 s/15 s/1 min/5 min ±20%, G04 após 3 falhas, G05 sem reagendar, 60 s/5 min com o app visível, debounce de 2 s nas escritas, gatilhos `online`/`focus`/`visibilitychange`/`RUN_SYNC`); `src/lib/telemetry.ts` (fila `telemetry_queue` no `kv`, contexto só com chaves da allowlist, `log_events` em lotes de 50). Integração com dois aparelhos em `apps/web/test/integration/client-sync.int.test.ts` (roda no job `db`).
- Login e sessão (T-034): `src/lib/supabase.ts` (PKCE, `persistSession`, `autoRefreshToken`, `detectSessionInUrl: false`), `src/app/auth.tsx` (`AuthProvider`/`useAuth`: `getSession` abre sem rede, abre `OakDb(userId)` e liga o `SyncEngine` — carregado sob demanda —, `signInWithGoogle`, `signOut('send'|'discard')` que apaga o banco local), guardas `RequireSession`/`RedirectIfSignedIn` (`src/app/guards.tsx`), ON03 (`features/onboarding/LoginScreen.tsx`, com G14 em `?erro=privado`), `/auth/callback` (`AuthCallback.tsx`, troca o código e reconhece o erro do hook), G05 (`src/app/SessionExpired.tsx`) e G16 ("Sair" em `/ajustes`, `features/settings/SignOut.tsx`). Só no build E2E: formulário `data-e2e-login` (`src/app/e2e/E2eLogin.tsx`) e ganchos `window.__oakE2E` (`src/app/e2e/hooks.ts`); o `build:e2e` (`apps/web/scripts/build-e2e.mjs`) lê URL e chave do `supabase status -o env` sem imprimir. D-014: o `check-build` procura `sb_secret_` pelo formato da chave.
- Seeds (T-035): `src/data/seeds.ts` (`seedRows`, `ensureSeeds` numa transação, idempotente e sem recriar tombstone; orçamento com id v5 de `NS_SEED_BUDGET`, D-015), chamado pelo `AuthProvider` depois do primeiro sync que der certo. Migração 08 (`app.writable_columns` sem colunas geradas: antes toda categoria do aparelho voltava `rejected` por causa de `name_ci`) e pgTAP `050-seeds-sync`. E2E `seeds.spec.ts` (E01 parte de seeds, E11).
- Ainda não há deploy real. Marco atual: M0. O próximo é o M1 (T-036, T-037, T-045, T-050 + SETUP-10).
- Últimas tarefas concluídas: T-010, T-011, T-012, T-013, T-014, T-015, T-016, T-017, T-018, T-019, T-020, T-021, T-022, T-023, T-024, T-025, T-026, T-027, T-028, T-029, T-030, T-031, T-032, T-033, T-034 e T-035. **F1 (banco) concluída.** Marco M0 atingido (portão ativo) na T-007. Conferido em 05/11 às 21:13 UTC (ruleset `main`, id 26649999): enforcement `active` na branch padrão; PR obrigatório (0 aprovações); checks `guard`, `secrets`, `lint-types`, `unit`, `db`, `fn`, `e2e`, `build` com branch atualizada (strict); histórico linear; bloqueio de force-push e de exclusão; bypass só para o papel *Repository admin* em modo *pull request* (nenhuma credencial de sessão).

## 2. Estado do CI e do deploy

- CI: `ci.yml` verde em `main` (último merge: T-035, PR #43). Roda em todo PR (inclusive `edited`) e em push em `main`; o check `e2e` agrega os jobs `e2e-shard (1/3..3/3)`.
- Deploy: `deploy.yml` roda em cada push em `main` e termina com aviso e sucesso enquanto as variáveis do Supabase estão vazias (SETUP-05/09). Backup, keepalive e preview também pulam com aviso. O deploy real começa na T-036.
- Nightly: 04:13 BRT; abre issue `regressão: nightly` se falhar. Ainda não rodou.
- Dependabot: abriu o PR #7 (actions) e as atualizações npm falharam no próprio Dependabot. O guard reprova esses PRs (sem `T-xxx`, e o de actions mexe em `.github/**`): ficam para o dono.
- E2E instável: o passo "navegadores do Playwright" expira em 20 min em cerca de 1 a cada 3 runs (apt lento no runner). A sessão não consegue re-executar runs; o run volta a rodar no próximo push real (rebase). A correção definitiva é o PR #15 (imagem `mcr.microsoft.com/playwright`), com `needs-owner` porque mexe em `.github/**`.
- Ruleset de `main`: ativo desde 05/11 (SETUP-04). Todo merge exige os 8 checks verdes e a branch atualizada.

## 3. Próximos passos

- **Próxima tarefa: T-036 (primeiro deploy) está `blocked` (SETUP-05..09/12 incompletos; o deploy já falha por falta do `SUPABASE_ACCESS_TOKEN`, issue #38). A próxima liberada é a T-037 (Boas-vindas e instalação guiada).** Depois: T-038 (Contas, depende da T-035).
- Sessão: `useAuth().user` traz `db` e `engine`; depois de cada `saveRow`/`deleteRow`, chame `engine.notifyWrite()`. O estado do motor (`getSnapshot`/`subscribe`) alimenta o SyncBadge e o banner G04 (T-045). Falta capturar `window.onerror`/`unhandledrejection` na telemetria. Os E2E que entram nas telas do app usam `login(page)` de `e2e/fixtures/base.ts` (usuários `e2e-a`/`e2e-b@example.test`, criados pelo formulário na primeira vez).
- Bundle inicial: 225 KB gzip de 250 (supabase-js e Dexie entraram). O sync, o zod completo e os mappers já vêm sob demanda; a próxima folga sai de carregar o supabase-js só depois da abertura, se precisar.
- Sync: o passo 6 do pull (conciliador, materialização de recorrências e faturas faltantes) fica para as tarefas dessas features; o "tentar de novo" de uma rejeitada DEVE gerar `mutation_id` novo (o servidor guarda a rejeitada como vista).
- Data layer: toda escrita no Dexie passa por `writeLocal` (liga/desliga o G11 e respeita o modo só online do G12). Quando a migração mudar: `pnpm db:types` (ou o log do job `db`) e depois `pnpm db:schemas`. O `initStorage()` roda no boot (`main.tsx`); o modo `online-only` ainda não troca as leituras pela RPC (isso entra com o sync, T-033).
- SW e app: o `UpdatePrompt` (nos dois layouts) trata `NAVIGATE`; `RUN_SYNC` fica para o motor de sync (T-033) e `PUSH_RESUBSCRIBE` para a T-064, que deve gravar o sinal `push_resubscribe_needed` no `kv` (tech §4.8) ao receber a mensagem (o SW não conhece o banco por usuário). A T-040 troca `reloadBlocked` (hoje: `?novo=` na URL) pela checagem do rascunho.
- E15 no E2E: o `vite preview` devolve um `sw.js` com bytes a mais quando o contexto tem o cookie `oak-sw-bump` (plugin `oak-headers`), o que simula um deploy novo sem afetar os outros testes. No WebKit (iphone) os cenários de SW só conferem manifest e ícones (o Playwright não controla SW lá; `.skip` é proibido pelo guard).
- Rotas: cada tarefa de tela troca o `ScreenStub` do módulo em `src/features/<área>/screens.tsx`; a tabela de rotas fica em `src/app/screens.ts` (o teste `test/shell.test.tsx` compara caminho e nome com os títulos da UX §3). A guarda de auth (T-034) entra em `src/app/routes.tsx`. A rota `/__erro` (G09) só existe no build E2E.
- CSS da moldura: `shell.css` pode entrar no bundle antes do `ui.css` e o `.glass` (base.css) põe `position: relative`; por isso as regras que mudam componentes usam o prefixo `.shell` (ex.: `.shell .shell-tabbar { position: fixed }`). O `ui.css` não foi tocado (snapshot do styleguide).
- CSP no E2E: o plugin `oak-headers` do `vite.config.ts` lê `dist/_headers` no `vite preview` e tira só `upgrade-insecure-requests` e HSTS (http local). Sem `VITE_SUPABASE_URL`, o `gen-headers` usa o Supabase local (`http://127.0.0.1:54321`, `ws://`); em `VITE_APP_ENV=production` sem a URL, o build falha. O `check-build.ts` exige o `_headers` com CSP.
- `lib/env.ts`: `getEnv()` exige URL https e chave publicável fora de `local`/E2E (valor vazio conta como ausente). Ainda não é chamado no boot; a T-034 usa ao criar o cliente do Supabase.
- Marca: os wordmarks em `src/brand/` ainda usam `<text>` (referência de construção da UX §4.11.3); converter em contornos (`opentype.js`) antes de publicar fora do app. A parte de quadros por segundo da heurística `data-perf` (UX §4.5) fica para a tela Início.
- Textos novos de interface: acrescente na UX §6 (com DECISIONS) e no `pt-BR.ts`; o teste `test/i18n.test.ts` exige igualdade com a §6.4.
- Lembretes: o `reminders-tick` (T-064) ainda precisa aplicar o teto de 3 push por dia, agrupar vencimentos do mesmo dia (UX 6.7, #4) e usar `deliverAt`/`stillDue` para o silêncio; o domínio entrega um aviso por item. Passe `labels` (nomes de cartões e categorias), `loggedOn` (datas locais de `created_at` dos lançamentos manuais), `categoryLimits` e `connections`.
- Importação: os presets Nubank e as fixtures são sintéticos e provisórios; quando o SETUP-14 chegar, a sessão da T-085/T-087 gera fixtures anonimizadas dos arquivos reais e confirma os presets. `ofxToImportRows` passa o valor com sinal para `importedDedupKey` (um estorno com o mesmo FITID, data e valor não colide com a compra). A tokenização do CSV (papaparse) e a decodificação do CSV por `encoding` ficam no app.
- RN-71: as stopwords da RN-58 apagam "CARTAO", "NU", "PAGAMENTO" e "RECEBIDO"; por isso a detecção de pagamento de fatura usa a normalização da RN-57 sem as etapas 4–5. Para reduzir falso positivo ("COMPRA CARTAO" no débito), a sugestão só sai quando há fatura fechada/vencida/parcial cuja janela (fechamento ≤ data ≤ vencimento + 5) contém a data.
- RN-69: sem o mês da fatura do banco, `linkImportedInstallment` aceita a data original da compra (±3 dias) ou o mês da parcela de −1 a +3; quem chamar deve preencher `ReconItem.invoiceMonth` e `firstInvoiceMonth` sempre que souber, para valer o ±1 estrito.
- Integração: a Admin API do Auth **não** passa pelo hook `before_user_created`; para testar a allowlist use o cadastro público (`auth.signUp`).
- `keepalive.yml`: o `ops_health` acusa "reminders-tick nunca rodou" até a função existir (T-064); o keepalive só roda depois do SETUP-05/09.
- O guard trata qualquer "truncate" em migração como DDL destrutivo, inclusive `revoke … truncate` (falso positivo; contornado com `revoke all` + `grant` em D-009). Sugestão ao dono: afinar a regra em `scripts/ci-guard.ts` (caminho protegido).
- pgTAP: funções auxiliares de teste vão em `pg_temp` (`create function pg_temp.x(...)`, chamadas como `pg_temp.x(...)`); para voltar a postgres no meio do teste, `reset role`.
- Tipos do banco: `supabase gen types` não roda no ambiente da sessão. Quando a migração mudar, o `scripts/gen-db-types.sh --check` do job `db` falha e imprime o arquivo inteiro entre `----- INICIO db-types.ts -----` e `----- FIM db-types.ts -----`; baixe o log do job (`gh api repos/silveiralh/OakFinance/actions/jobs/<id>/logs`), tire o prefixo de data de cada linha e grave em `apps/web/src/data/db-types.ts`. Isso gasta uma rodada de CI.
- Validação local das migrações: Postgres 16 + pgTAP do apt com o harness que imita `auth` (substitua as linhas `create extension pg_cron/pg_net` por comentário só localmente). F1 (banco), F2 (domínio, a partir da T-012) e F3 (design system, T-025) estão liberadas; siga a ordem de ID.
- Com o ruleset, o merge só passa com a branch atualizada: se o PUT de merge recusar, `git rebase origin/main` no branch da tarefa e `push --force-with-lease`. Conferir com `gh api repos/silveiralh/OakFinance/rules/branches/main`: PR obrigatório, os 8 checks (`guard`, `secrets`, `lint-types`, `unit`, `db`, `fn`, `e2e`, `build`), branch atualizada, histórico linear, bloqueio de force-push e de exclusão. Sem o ruleset, a T-007 fica `blocked` e nenhuma outra tarefa anda (toda a cadeia depende dela).
- Antes de abrir PR, remova o `[WIP]` do título antes do último push (ou edite o título: o `ci.yml` roda em `edited`). O guard reprova título fora do Conventional Commits.
- Dependabot: os PRs `chore(deps)` não têm `T-xxx` no corpo e os de actions mexem em `.github/**`, então o guard os reprova. Eles ficam para o dono (rótulo `needs-owner` + bypass), ou uma sessão refaz a atualização num PR de tarefa.
- Mensagens de commit: o commitlint recusa linhas de rodapé com mais de 100 caracteres.
- Preview: o `preview.yml` (pull_request) só faz build com variáveis públicas e sobe `dist/` como artefato; o `preview-deploy.yml` (workflow_run, Environment `staging`) publica no Pages sem executar código do PR. Assim nenhum workflow com segredo dispara em `pull_request`.
- Stryker com pnpm: `plugins: ['@stryker-mutator/vitest-runner']` explícito e `inPlace: true` (o sandbox não enxerga `coverage-baseline.json` na raiz).
- `actionlint` local: `pip install actionlint-py --break-system-packages`. `gitleaks` local: `apt-get install gitleaks` (8.16; o CI usa 8.28.0).
- `ci-secrets --all` acusa os e-mails de exemplo na `02-tech-spec.md` §9.2 (`email-1@…`), que já estavam lá; o modo de PR só lê linhas adicionadas.
- A T-003 entrou sem `supabase start` real localmente: o ambiente da sessão não baixa imagens Docker (docker.io, ghcr.io e public.ecr.aws dão 403). O pgTAP foi validado com `pg_prove` num Postgres 16 + pgTAP do apt que emula `auth.users`, `auth.uid()` e os papéis (`dockerd` precisa ser iniciado à mão). No CI (T-004), `supabase start`, `pnpm test:db` e `db lint` passaram, e o E2E rodou verde nos 3 projetos, inclusive `iphone` (WebKit). Mudanças de banco e de E2E são validadas de verdade só no CI.
- Supabase CLI 3.0.0 local: pacote npm `@supabase/cli-linux-x64@3.0.0` (`npm pack` + `tar`).
- Ambiente da sessão: vem com Node 22; o Node 24 sai do pacote npm `node-linux-x64@24` (`npm pack` + `tar`), pois `nodejs.org` é bloqueado pelo proxy. O Deno sai de `npm i -g deno`. O Playwright local só tem Chromium (rev. 1243): para rodar o 1.64.1, crie um `PLAYWRIGHT_BROWSERS_PATH` próprio com links `chromium-1248` e `chromium_headless_shell-1248` apontando para os de `/opt/pw-browsers`. O projeto `iphone` (WebKit) não roda localmente; o CI cobre a partir da T-004.
- O Biome 2.6 formata Markdown e YAML: `*.md` ficou fora do `biome.json` de propósito (docs são texto autoral).
- MSW 3: a opção é `onUnhandledFrame` (não mais `onUnhandledRequest`).
- O proxy não deixa apagar branches remotas (`git push --delete` e `DELETE /git/refs` dão 403). Branches de tarefa mergeadas ficam até o cliente ligar "Automatically delete head branches" (SETUP-02) ou apagá-las. O proxy também recusa cancelar ou re-executar runs (`/cancel` e `/rerun-failed-jobs` dão 403): uma falha de infraestrutura só se resolve com um novo commit de verdade.

## 4. Bloqueios e pendências do cliente

| Item | Quando é necessário | Desbloqueia |
|---|---|---|
| SETUP-01 a SETUP-03 (repositório público, opções, credencial sem admin) | agora | operação segura das sessões |
| SETUP-04 ruleset | feito em 05/11 | T-007 (done) |
| SETUP-05 a SETUP-09, SETUP-12 (Supabase, Google, Cloudflare, Environments, backup) | até a T-036 (~dia 6) | T-036 |
| SETUP-10 allowlist, Vault, hook, secrets das funções | depois da T-036 | M1 (login real) |
| SETUP-11 VAPID | depois da T-064 | M2 (push real) |
| SETUP-13 Pluggy e Meu Pluggy (trial de 15 dias) | quando a T-077 estiver `done` | T-083, M3 |
| SETUP-14 arquivos reais anonimizáveis (canal privado) | antes da S4 | T-085, T-087, T-090 |
| SETUP-15 licença; SETUP-16 decisões pendentes | antes da T-099 | T-099 |

- Conferido pela API em 06/11: SETUP-01, 02 e 04 feitos (só squash, auto-merge e exclusão automática de branch ligados; issue #2 reaberta com 01–04 marcados). SETUP-03 substituído pela D-012 (as sessões herdam o admin do dono; valem as salvaguardas).
- **T-036 `blocked: aguarda cliente — SETUP-05..09, SETUP-12`** (marcada em 06/11). Volta a `todo` quando a issue #2 tiver esses itens marcados.
- **Issue #38 `regressão: deploy` (06/11):** não é bug de código. As variables do Supabase já existem (o deploy parou de pular), mas o job `staging` falhou com `SUPABASE_ACCESS_TOKEN ausente`. Falta cadastrar no Environment os secrets da tech §9.8 (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_*_DB_PASSWORD` etc., SETUP-09) e re-executar o `deploy`. Rótulo `needs-owner`; as sessões não mexem nela até lá.

## 5. Riscos conhecidos

- **Cartão com F < V e fevereiro curto:** decidido em D-011 (06/11): quando o vencimento cairia no dia do fechamento ou antes, ele passa para o primeiro dia útil seguinte. Falta implementar em `invoices.ts` (com teste citando a RN-10/RN-11) antes ou junto da T-047.

- **R14 vazamento em repositório público:** qualquer segredo ou dado real commitado fica no histórico para sempre. Se acontecer, registre aqui e peça ao cliente para girar a credencial na hora.
- **Autobloqueio do guard:** o PR do próprio guard (T-006) precisa do modo bootstrap; arquivo protegido esquecido no bootstrap vira `needs-owner`.
- **R1 trial da Pluggy (15 dias):** só iniciar com a T-077 pronta; os dois usuários conectam BB e Nubank dentro da janela.
- **R5 OAuth no iPhone instalado:** validar no M1; plano B na tech §10.
- **R17 ferramentas recentes** (Vite 8, React Router 8, Vitest 5, TS 6.0 fixado, Biome 2.6 com `preset` no lugar de `recommended`): conferir a documentação da versão instalada.
- **NFC-e sem páginas reais:** a T-090 fica bloqueada e o app entrega só o fallback (T-088, T-089).
- **D-005:** o timeout da NFC-e é 10 s (RN-84), e não os 20 s da tech §6.2.3.
- **Ritmo:** cerca de 99 tarefas a 6 sessões por dia ≈ 17 dias corridos sem bloqueios. O núcleo (M2) fica pronto por volta do dia 12.

## 6. Checklist de aparelho real

Vazio. A T-036 e a T-045 preenchem o checklist do M1 (tech §8.5); entram nele, da T-030: instalar no Android (Chrome) e no iPhone (Compartilhar → Adicionar à Tela de Início), ícone e nome "OakFinance" na tela inicial, abrir em modo avião depois do primeiro acesso e o aviso "Nova versão disponível." depois de um deploy; da T-034: entrar com Google no iPhone instalado na Tela de Início e no Android (o retorno precisa voltar ao app, R5), e abrir sem rede depois do login sem ver a tela de entrada.

## 7. Histórico

| Data | Tarefa | PR | Resultado | Observação |
|---|---|---|---|---|
| 05/11/2026 | — | — | plano criado | specs, CLAUDE.md, TASKS, HANDOFF e SETUP no repositório |
| 05/11/2026 | T-001 | PR #1 | done | tooling da raiz, DECISIONS (D-001..D-007), Apêndice A, issue #2 `Setup do cliente` |
| 05/11/2026 | T-002 | PR #3 | done | workspaces, configs de teste, mock da Pluggy e vendor; E2E local só android/desktop (sem WebKit no ambiente) |
| 05/11/2026 | T-003 | PR #4 | done | Supabase local, helpers pgTAP, base das Edge Functions; `supabase start` não roda no ambiente da sessão (imagens bloqueadas), validado com Postgres 16 + pgTAP local |
| 05/11/2026 | T-004 | PR #5 | done | CI com 8 checks, varredura de segredos e dados pessoais, gitleaks, check-build e greps |
| 05/11/2026 | T-005 | PR #6 | done | deploy, backup, keepalive, nightly, preview (build sem segredo + deploy por workflow_run), dependabot e Stryker |
| 05/11/2026 | T-006 | PR #8 | done | guard do portão (modo bootstrap neste PR) e catraca de cobertura; pede SETUP-04 |
| 05/11/2026 | T-007 | PR #9 | blocked | aguarda SETUP-04 (ruleset de main); cadeia parada |
| 05/11/2026 | T-007 | PR #10 | done | ruleset de main conferido (8 checks, strict, linear, sem force-push/exclusão, bypass só admin em PR); M0 |
| 05/11/2026 | T-008 | PR #11 | done | migrações 01–02, tipos gerados, 19 asserções pgTAP (RN-01/05/07/09, US-02) |
| 05/11/2026 | T-009 | PR #13 | done | migrações 03–04, sync e RPCs, 36 asserções pgTAP; D-008 (privilégios) |
| 05/11/2026 | T-010 | PR #14 | done | RLS forçada, cadastro fechado, 26 asserções pgTAP; D-009 |
| 05/11/2026 | T-012 | PR #17 | done | domínio base (dinheiro, datas, ids v5, erros); D-010 |
| 05/11/2026 | T-011 | PR #16 | done | migração 07 (cron, expurgo, saúde), 11 asserções pgTAP e 6 testes de integração do sync (50 iterações concorrentes) |
| 05/11/2026 | T-013 | PR #18 | done | faturas: RN-09..RN-18, propriedades de monotonicidade e partição |
| 05/11/2026 | T-014 | PR #19 | done | parcelas: RN-20..RN-25 e US-21 |
| 05/11/2026 | T-015 | PR #21 | done | recorrências: RN-26..RN-29 |
| 05/11/2026 | T-019 | PR #20 | done | categorização por regras e dados padrão |
| 05/11/2026 | T-016 | PR #23 | done | renda do mês, 50/30/20 e limiares |
| 05/11/2026 | T-023 | PR #22 | done | QR da NFC-e v2/v3, DV módulo 11 e allowlist de hosts |
| 05/11/2026 | T-017 | PR #24 | done | Disponível para gastar (RN-47..RN-51), US-30 e US-34 |
| 05/11/2026 | T-018 | PR #25 | done | reserva: meta sugerida, progresso e ETA (RN-52..RN-56) |
| 06/11/2026 | T-047 | PR #26 | decisão | D-011: vencimento no dia útil seguinte quando cairia no fechamento (decisão do cliente) |
| 06/11/2026 | T-007 | PR #27 | decisão | D-012: SETUP-03 substituído por salvaguardas (decisão do cliente) |
| 06/11/2026 | T-020 | PR #28 | done | conciliação: US-48, RN-65..RN-68 e RN-72 |
| 06/11/2026 | T-021 | PR #29 | done | conciliação II: US-50, RN-19, RN-69..RN-71 |
| 06/11/2026 | T-022 | PR #30 | done | importação OFX/CSV: US-52, US-53, RN-65, RN-75, RN-76; fixtures sintéticas |
| 06/11/2026 | T-024 | PR #31 | done | lembretes devidos: US-39..US-43, RN-86..RN-94; ProfileSettings |
| 06/11/2026 | T-025 | PR #32 | done | tokens, fontes, ambiente (D-013), i18n e marca; contraste da §4.3 por teste |
| 06/11/2026 | T-026 | PR #33 | done | componentes de base da UX §5 com testes de papéis ARIA, estados e alvo de toque |
| 06/11/2026 | T-027 | PR #34 | done | componentes de entrada (teclado, foco, aria-live); agendamento pausado a pedido do cliente |
| 06/11/2026 | T-028 | PR #35 | done | componentes de dados, /__styleguide e snapshot visual dos tokens |
| 06/11/2026 | T-029 | PR #36 | done | AppShell, rotas lazy da UX §3, G09 com código, env (zod) e `_headers` com a CSP aplicada também no E2E |
| 06/11/2026 | T-030 | PR #37 | done | PWA: manifest, SW com push/notificationclick testados, G07 sem recarregar com o Q01 aberto, E15 e abertura offline no E2E |
| 06/11/2026 | T-031 | PR #39 | done | Dexie v1 literal, zod gerado de db-types, mappers, filtros de leitura e G11/G12 com fake-indexeddb |
| 06/11/2026 | T-032 | PR #40 | done | outbox com coalescência, HLC com deslocamento do servidor, repositórios atômicos e cascatas (RN-95, RN-97, RN-99) |
| 06/11/2026 | T-033 | PR #41 | done | motor de sync (push/pull/engine), telemetria em kv + log_events, casos da §4.10 no cliente e integração com dois aparelhos |
| 06/11/2026 | T-034 | PR #42 | done | login Google (PKCE), guardas, G05/G14/G16, sair apaga o banco local; formulário e ganchos só no build E2E; D-014 |
