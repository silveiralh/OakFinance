# CLAUDE.md — OakFinance

Guia operacional das sessões automáticas de desenvolvimento. Cada sessão começa sem memória: leia este arquivo inteiro antes de qualquer ação.

## 1. Produto em 10 linhas

1. OakFinance é um PWA de finanças pessoais para 2 pessoas com contas 100% separadas, sem nenhum compartilhamento.
2. Persona A usa Android (Chrome) e Persona B usa iPhone (Safari instalado na Tela de Início, iOS ≥ 16.4); as duas também usam o computador.
3. A pergunta central é "Quanto ainda posso gastar este mês?" (H01, fórmula RN-47, selo RN-50).
4. É offline-first: Dexie local + outbox + RPCs `sync_push`/`sync_pull`. A nuvem é a fonte da verdade; a última edição vence e o histórico guarda o resto.
5. O lançamento rápido leva ≤ 3 toques e < 5 s, inclusive sem rede.
6. A compra no cartão cai na fatura pela data de fechamento e conta no mês do vencimento da fatura (decisão do cliente).
7. 50/30/20 sobre a renda, reserva de emergência e regras de categoria que aprendem (determinísticas e locais, sem IA).
8. Integrações: Open Finance (Pluggy/Meu Pluggy, BB e Nubank), OFX/CSV, NFC-e da SEFAZ-PR e Web Push com VAPID.
9. Custo R$ 0: Supabase Free (sa-east-1), Cloudflare Pages e GitHub Actions em repositório **público**.
10. Visual Aero sóbrio e marca só tipográfica (sem árvore, folha ou figura). Textos em pt-BR, sem "!" e sem emoji.

## 2. Onde está cada coisa

| Arquivo | Conteúdo |
|---|---|
| `docs/specs/01-prd-backlog.md` | PRD, regras RN-01..RN-104, histórias US-01..US-65, DoR/DoD |
| `docs/specs/02-tech-spec.md` | Arquitetura, DDL, domínio, sync, Edge Functions, CI (§8.6), setup (§9). Tudo que tem **[CONTRATO]** é literal |
| `docs/specs/03-ux-design-system.md` | Telas (IDs ON/H/Q/T/C/P/I/S/G), tokens, componentes, microcopy (§6) |
| `docs/specs/04-review.md` | Revisão final: **palavra final em caso de dúvida** |
| `docs/00-discovery-brief.md` | Brief original, desatualizado (marca e tom lúdico); perde para os acima |
| `docs/TASKS.md` | A cadeia de tarefas e o status. É o único plano |
| `docs/HANDOFF.md` | Passagem de bastão entre sessões |
| `docs/SETUP.md` | O que só o cliente pode fazer (itens `SETUP-xx`) |
| `docs/DECISIONS.md` | Log de decisões, apontando para os ADRs |

Precedência: 04-review > RN do PRD (regras e números) > UX (textos e telas) > tech (nomes, contratos, protocolo). Leitura mínima por sessão: este arquivo, `HANDOFF.md`, a sua tarefa em `TASKS.md`, tech §0 e §2 e as seções das specs citadas na tarefa.

## 3. Protocolo da sessão (siga na ordem)

1. **Preparar:** `git clone https://github.com/silveiralh/OakFinance oakfinance && cd oakfinance`, `corepack enable`, `pnpm install --frozen-lockfile` (quando existir lockfile). Rode `supabase start` se a tarefa tocar banco, sync ou E2E.
2. **Ler** `docs/HANDOFF.md` e `docs/TASKS.md` por inteiro.
3. **Triagem, antes da cadeia:**
   1. Issue aberta com título `regressão:` → é a tarefa desta sessão: PR `revert:` do commit culpado ou `fix:` com teste de regressão.
   2. PR aberto de sessão anterior (CI vermelho com menos de 3 rodadas de correção, ou `[WIP]` sem commits há mais de 30 min) → continue nele. Se tiver o rótulo `needs-owner`, não mexa e siga adiante.
   3. Issue `Setup do cliente`: veja quais `SETUP-xx` o cliente marcou como feitos. Tarefas `blocked: aguarda cliente — SETUP-xx` com o item feito voltam a `todo`, e isso entra no seu PR.
4. **Escolher a tarefa:** a primeira, em ordem de ID, com Status `todo`, com todas as "Depende de" em `done` e que não esteja `blocked`. Se ela tiver "Cliente: sim" e o item `SETUP-xx` não estiver feito, marque `blocked: aguarda cliente — SETUP-xx` e pegue a próxima liberada.
5. **Branch:** `git fetch origin && git switch -c task/T-xxx-slug origin/main` (slug curto em kebab-case).
6. **Implementar** só o escopo da tarefa, seguindo as specs:
   - contratos literais (DDL, assinaturas, payloads, chaves de deduplicação);
   - todo cenário Gherkin e todo número das RN vira teste, com o ID no nome: `it('RN-12: compra no dia do fechamento vai para a próxima fatura')`, `test('US-30: caso de referência', …)`;
   - textos de interface vêm do UX §6 e ficam em `i18n/pt-BR.ts`;
   - dinheiro sempre em centavos inteiros; datas `YYYY-MM-DD` no fuso `America/Sao_Paulo`;
   - antes de usar a API de uma ferramenta nova (Vite 8, React Router 8, Vitest 5, TS 6.0), consulte a documentação da versão instalada.
7. **Registro de contrato:** se a API pública de `packages/domain` ou as migrações mudarem, acrescente uma linha ao "Apêndice A — Registro de implementação" de `docs/specs/02-tech-spec.md` (decisão D-001). O `guard` exige isso. Qualquer outra mudança de spec só entra com ADR novo e entrada em `docs/DECISIONS.md`.
8. **Atualizar no mesmo branch:** em `docs/TASKS.md`, status `done` na tarefa e no índice; em `docs/HANDOFF.md`, as seções 1–6 e uma linha no histórico (seção 7).
9. **Checks locais iguais ao CI:** `pnpm ci:local` (guard, secrets, lint-types, unit, db, fn, e2e, build). Antes da T-004, rode os scripts que já existirem.
10. **Commit** em Conventional Commits, pt-BR, imperativo, com escopo de tech §2.5: `feat(domain): atribui compra à fatura pela data de fechamento`. Nunca use `--no-verify`.
11. **PR:** `git fetch origin main && git rebase origin/main && git push -u origin HEAD`. Crie o PR pela API REST (o GraphQL é bloqueado neste ambiente, então `gh pr …` e `gh issue …` **não funcionam**; use sempre `gh api`, ver §10): `gh api repos/silveiralh/OakFinance/pulls -f title="<mensagem do commit>" -f head="<branch>" -f base=main -F body=@<arquivo temporário fora do repo>` com o corpo-padrão da seção 7. Anote o número `n` e o `head.sha`.
12. **CI:** acompanhe os checks do último commit do PR pela REST, de 30 em 30 s, usando a ferramenta Monitor ou um laço com espera (§10, "Checks"), até todos os runs terminarem. Só com **todos** verdes: `gh api -X PUT repos/silveiralh/OakFinance/pulls/<n>/merge -f merge_method=squash` e depois `git push origin --delete <branch>`. Se o merge for recusado por branch desatualizada, faça `git fetch origin main && git rebase origin/main && git push --force-with-lease` **no seu branch de tarefa** (nunca em `main`) e observe o CI de novo. Confirme com `gh api repos/silveiralh/OakFinance/pulls/<n> --jq .merged` = `true`.
   - Nas T-001 a T-003 ainda não há CI: o merge acontece depois dos checks locais passarem.
13. **CI vermelho:** liste os runs do commit (`gh api "repos/silveiralh/OakFinance/actions/runs?head_sha=<sha>"`), leia o log da falha (`gh run view <id> --log-failed`; se falhar, baixe `gh api repos/silveiralh/OakFinance/actions/runs/<id>/logs > <arquivo fora do repo>.zip`), corrija no mesmo PR e repita o passo 12. São no máximo **3 rodadas de correção**. Uma falha de infraestrutura (runner, rede, download) pode ser re-executada uma vez com `gh api -X POST repos/silveiralh/OakFinance/actions/runs/<id>/rerun-failed-jobs` sem contar como rodada.
14. **Se não conseguir em 3 rodadas:** deixe o PR aberto. Abra um PR `docs: bloqueia T-xxx` que só altere `TASKS.md` (`blocked: CI — <motivo curto>`) e `HANDOFF.md` (o que falhou, hipóteses, link do run) e faça o merge dele pelo passo 12. Encerre a sessão.
15. **Encadear tarefas (decisão do cliente, D-007):** depois do merge confirmado, se a sessão começou há **menos de 3 h 30 min** e não apareceu erro de limite de uso, volte ao passo 2 e faça a próxima tarefa liberada, uma por PR. Pare de pegar tarefas novas quando ocorrer qualquer um destes:
    - passaram 3 h 30 min do início (para não sobrepor a próxima sessão agendada);
    - qualquer erro ou aviso de limite de uso ou de taxa (rate limit, 429, "limit");
    - duas tarefas seguidas bloqueadas;
    - nenhuma tarefa liberada.
    Anote a hora de início no começo da sessão (`date -u`) e confira antes de cada nova tarefa.
16. **Salvar progresso cedo:** abra o PR com o prefixo `[WIP]` no título logo após o primeiro commit e faça push a cada parte concluída. Se a sessão for interrompida pelo limite de uso, o trabalho fica no branch. Na triagem, um PR `[WIP]` de sessão anterior sem commits há mais de 30 min é retomado (passo 3.2), e o `[WIP]` sai do título quando a tarefa termina (`gh api -X PATCH repos/silveiralh/OakFinance/pulls/<n> -f title="…"`).
17. **Encerrar:** nenhum arquivo local sem commit, nenhum branch órfão, `HANDOFF.md` em `main` refletindo a realidade.
18. **Espelhar no Projeto:** o cliente acompanha o andamento pelo Projeto claude.ai "Sistema PWA de Gerenciamento Financeiro". Se a ferramenta `Projects` estiver disponível na sessão, grave o `docs/HANDOFF.md` de `main` em `claude/status.md` (`project_write` com `local_path`) e, quando `docs/TASKS.md` mudar, em `claude/TASKS.md`. Sem a ferramenta, apenas siga; o repositório continua sendo a fonte da verdade.

## 4. Regras invioláveis

- **Repositório público.** Nunca escreva segredos, valores de variáveis privadas (tech §9.8), e-mails dos usuários, nomes, CPF, números de conta ou de cartão em código, testes, fixtures, docs, commits, PRs, issues ou logs. Em testes, use só e-mails `@example.com` ou `@example.test`.
- **Nunca versione arquivos reais** (OFX, CSV, página ou QR de NFC-e, resposta da Pluggy) nem trechos deles. Fixture é sempre anonimizada, em pasta `fixtures/`, com `README.md` explicando a anonimização. Dados que o scanner reprovaria (CPF ou chave com DV válido, Luhn) são gerados em tempo de execução nos testes.
- **Nunca desligue, pule ou enfraqueça o portão:** nada de apagar testes, `.only`/`.skip`/`todo`, baixar limiar de cobertura, editar baseline de snapshot ou cobertura para baixo, `biome-ignore` sem justificativa, nem mexer em caminho protegido do `guard` (tech §8.6). Se a tarefa exigir isso, deixe o PR aberto com o rótulo `needs-owner`, registre no HANDOFF e siga para outra tarefa.
- **Nunca** faça force-push nem push direto em `main`, nem use merge de admin, bypass ou desligamento de regra. Nunca abra PR a partir de fork.
- **Nunca** altere spec sem registrar em `docs/DECISIONS.md` (a linha do Apêndice A, D-001, é a única exceção rotineira).
- **Nunca** crie contas, chaves ou recursos externos nem gere chaves VAPID de produção. Isso é do cliente (SETUP). Sem uma variável, use mocks e fixtures.
- **Nunca** edite uma migração já mergeada; corrija com uma migração nova. Nada de DDL destrutivo.
- **Uma tarefa por PR.** Várias tarefas por sessão só pela regra do passo 15.
- Nunca imprima variáveis de segredo no CI (`set -x`, `echo $SECRET`, artefatos).

## 5. Tarefas que dependem do cliente

- A coluna "Cliente" de cada tarefa diz `sim — SETUP-xx` quando ela precisa de algo de `docs/SETUP.md`.
- Item não concluído (confira a issue `Setup do cliente`): marque `blocked: aguarda cliente — SETUP-xx (<nome do item>)`, liste em HANDOFF §4 e siga para a próxima tarefa liberada. Não espere e não improvise o recurso externo.
- O cliente marca os itens feitos na issue `Setup do cliente` (só o ID e "feito", nunca valores). A sessão nunca pede, por issue, PR ou HANDOFF, e-mails, chaves ou arquivos reais.
- Arquivos reais (SETUP-14) chegam por canal privado e ficam fora do clone. A sessão gera só a versão anonimizada.
- Toda tarefa depende, direta ou indiretamente, da T-007 (ruleset ativo, tech §0 item 8).

## 6. Como atualizar o HANDOFF.md (sempre no mesmo PR da tarefa)

Mantenha as seções 1–6 com o estado atual (substituir, não acumular) e acrescente uma linha à seção 7:

1. **Estado atual** — o que já funciona em `main`, a última tarefa concluída e o marco atingido.
2. **Estado do CI e do deploy** — último run de `main`, nightly, deploy e keepalive.
3. **Próximos passos** — a próxima tarefa liberada e o que a próxima sessão precisa saber.
4. **Bloqueios e pendências do cliente** — tarefas `blocked` com o motivo e os `SETUP-xx` pendentes.
5. **Riscos** — novos ou agravados (sem dados sensíveis).
6. **Checklist de aparelho real** — o que o cliente deve testar no iPhone e no Android (tech §8.5) quando o marco pedir.
7. **Histórico** — `| data | T-xxx | PR #n | resultado | observação |`.

## 7. Corpo-padrão do PR

```
Tarefa: T-xxx — <título>
US: US-xx, …   RN: RN-xx, …

## O que mudou
- …

## Contrato alterado
não | sim → ADR-xx / Apêndice A da 02-tech-spec

## Migração
nenhuma | aditiva (expand/contract respeitado)

## Testes adicionados
- arquivo — casos (RN/US citados)

## Verificação manual pendente em aparelho real
nenhuma | itens (copiados para HANDOFF §6)

## Atualizações de docs
TASKS.md (status) · HANDOFF.md
```

## 8. Definition of Done resumida (PRD §7)

1. Todos os cenários Gherkin da história e todos os números das RN tocadas viram testes, com o ID no nome.
2. Núcleo (S1–S2) funciona offline; integrações degradam com as mensagens de US-64 e UX §6.6.
3. Os 8 checks do CI verdes: `guard`, `secrets`, `lint-types`, `unit`, `db`, `fn`, `e2e` (android, iphone, desktop), `build`.
4. TypeScript strict, sem `any` novo, só centavos inteiros, nenhum `parseFloat`/`toFixed` fora de `money.ts`.
5. Tabela nova com `user_id` tem RLS forçada e passa no pgTAP de isolamento.
6. Acessibilidade: axe sem violação séria nos 2 temas, alvos ≥ 48 px, foco visível, não depender só de cor, reduzir movimento respeitado.
7. Desempenho: painel < 1,5 s com dados locais, recálculo < 200 ms com 5.000 lançamentos, orçamento de bundle respeitado.
8. Textos iguais aos do UX, sem "!" e sem emoji; datas `dd/mm/aaaa`; valores `R$ 1.234,56`.
9. Nenhum segredo e nenhum dado real; fixtures anonimizadas com README.
10. Telemetria RN-104 emitida quando a história pedir, sem valores nem descrições.
11. TASKS e HANDOFF atualizados; pendências de aparelho real registradas.

## 9. Comandos

| Comando | Para quê |
|---|---|
| `pnpm ci:local` | Tudo o que o CI roda, na mesma ordem |
| `pnpm verify` | lint + typecheck + vendor --check + test + build |
| `pnpm test:db` | `supabase db reset && supabase test db` + testes `*.int.test.ts` |
| `pnpm test:fn` | `deno test -A --coverage supabase/functions` |
| `pnpm e2e` | Playwright nos 3 projetos |
| `pnpm db:types` | Regenera `apps/web/src/data/db-types.ts` (o CI exige zero drift) |
| `pnpm vendor` | Copia domain e nfce-parser para `supabase/functions/_shared` |
| `pnpm coverage:ratchet` | Sobe a baseline de cobertura (nunca desce) |
| `pnpm ci:guard` / `pnpm ci:secrets` | Os dois portões, localmente |

## 10. GitHub neste ambiente: só REST

O proxy das sessões bloqueia o GraphQL do GitHub e a escrita em configurações do repositório. Portanto `gh pr …`, `gh issue …` e `gh repo edit` falham com HTTP 403. Use `gh api` (REST):

| Ação | Comando |
|---|---|
| Listar PRs abertos | `gh api "repos/silveiralh/OakFinance/pulls?state=open"` |
| Ver PR | `gh api repos/silveiralh/OakFinance/pulls/<n>` |
| Checks | `gh api repos/silveiralh/OakFinance/commits/<sha>/check-runs --jq '.check_runs[] \| {name,status,conclusion}'` (todos com `status=completed` e `conclusion=success` ou `skipped`) |
| Merge squash | `gh api -X PUT repos/silveiralh/OakFinance/pulls/<n>/merge -f merge_method=squash` |
| Auto-merge (alternativa) | `gh api -X PUT repos/silveiralh/OakFinance/pulls/<n>/ccr/auto_merge` |
| Comentar em PR/issue | `gh api repos/silveiralh/OakFinance/issues/<n>/comments -f body="…"` |
| Listar issues | `gh api "repos/silveiralh/OakFinance/issues?state=open"` |
| Criar issue | `gh api repos/silveiralh/OakFinance/issues -f title="…" -F body=@<arquivo>` |
| Rótulo | `gh api repos/silveiralh/OakFinance/issues/<n>/labels -f "labels[]=needs-owner"` |
| Runs de um commit | `gh api "repos/silveiralh/OakFinance/actions/runs?head_sha=<sha>"` |

Configurações do repositório (visibilidade, ruleset, environments, secrets) **só o cliente** altera (SETUP). Se o clone avisar que o repositório mudou de endereço, use `https://github.com/silveiralh/OakFinance`.
