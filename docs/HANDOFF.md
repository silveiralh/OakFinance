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
- Ainda não há deploy real. Marco atual: M0. O próximo é o M1 (T-036, T-037, T-045, T-050 + SETUP-10).
- Últimas tarefas concluídas: T-010, T-011, T-012, T-013, T-014, T-015, T-016, T-017, T-018, T-019, T-020, T-021 e T-023. **F1 (banco) concluída.** Marco M0 atingido (portão ativo) na T-007. Conferido em 05/11 às 21:13 UTC (ruleset `main`, id 26649999): enforcement `active` na branch padrão; PR obrigatório (0 aprovações); checks `guard`, `secrets`, `lint-types`, `unit`, `db`, `fn`, `e2e`, `build` com branch atualizada (strict); histórico linear; bloqueio de force-push e de exclusão; bypass só para o papel *Repository admin* em modo *pull request* (nenhuma credencial de sessão).

## 2. Estado do CI e do deploy

- CI: `ci.yml` verde em `main` (último merge: T-020, PR #28). Roda em todo PR (inclusive `edited`) e em push em `main`; o check `e2e` agrega os jobs `e2e-shard (1/3..3/3)`.
- Deploy: `deploy.yml` roda em cada push em `main` e termina com aviso e sucesso enquanto as variáveis do Supabase estão vazias (SETUP-05/09). Backup, keepalive e preview também pulam com aviso. O deploy real começa na T-036.
- Nightly: 04:13 BRT; abre issue `regressão: nightly` se falhar. Ainda não rodou.
- Dependabot: abriu o PR #7 (actions) e as atualizações npm falharam no próprio Dependabot. O guard reprova esses PRs (sem `T-xxx`, e o de actions mexe em `.github/**`): ficam para o dono.
- E2E instável: o passo "navegadores do Playwright" expira em 20 min em cerca de 1 a cada 3 runs (apt lento no runner). A sessão não consegue re-executar runs; o run volta a rodar no próximo push real (rebase). A correção definitiva é o PR #15 (imagem `mcr.microsoft.com/playwright`), com `needs-owner` porque mexe em `.github/**`.
- Ruleset de `main`: ativo desde 05/11 (SETUP-04). Todo merge exige os 8 checks verdes e a branch atualizada.

## 3. Próximos passos

- **Próximas tarefas: T-022 (OFX/CSV), T-024 (lembretes) e T-025 (tokens, i18n e marca).**
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
- `scripts/check-build.ts` tem `REQUIRE_PWA = false`; a T-030 liga (manifest, `sw.js`, `_headers`, precache).
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
- Nenhuma tarefa bloqueada. Próximo bloco do cliente: SETUP-05 a 09 e 12, necessários para a T-036.

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

Vazio. A T-036 e a T-045 preenchem o checklist do M1 (tech §8.5).

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
| 06/11/2026 | T-021 | PR #NN | done | conciliação II: US-50, RN-19, RN-69..RN-71 |
