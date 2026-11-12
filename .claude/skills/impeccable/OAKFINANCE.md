# Impeccable no OakFinance

Cópia da skill [Impeccable](https://github.com/pbakaus/impeccable), de Paul Bakaus (Apache 2.0, ver `LICENSE.txt` e `NOTICE.md`), feita a partir de `plugin/skills/impeccable` no commit `b4bff1626c344067788c2679f048a20057c7cc5a` (11/11/2026, skill 4.8.2). Decisão D-100, tarefa T-131.

## O que foi copiado e o que ficou de fora

- **Copiado, sem alteração:** `SKILL.md` e `reference/`. É a parte que orienta o trabalho: `critique`, `audit`, `polish`, `clarify`, `harden`, `onboard`, `layout`, `typeset`, `adapt`, `distill`, `quieter`, `extract`, `document`, `shape` etc.
- **Fora de propósito:** `scripts/` (o lançador `impeccable`, que baixa e executa um binário do GitHub na primeira vez), os hooks do plugin (que rodariam esse binário no início da sessão e a cada `Edit`/`Write`) e os subagentes do plugin. Código de terceiro rodando sozinho em toda sessão automática, num repositório público com merge automático, é risco de cadeia de suprimentos; e o ambiente das sessões bloqueia a execução.

## Como usar nas sessões

1. **O lançador não existe aqui.** No passo "Setup" da `SKILL.md`, siga direto o caminho **"Launcher unavailable"**: leia `PRODUCT.md` e `DESIGN.md` na raiz do repositório e continue. Não tente baixar o binário, rodar `npx impeccable` nem instalar o plugin.
2. **Precedência:** as specs do projeto vencem o Impeccable (CLAUDE.md §2: 04-review > PRD > UX > tech). `PRODUCT.md` e `DESIGN.md` resumem as specs; se divergirem, vale a spec, e a divergência é corrigida no mesmo PR com linha em `docs/DECISIONS.md`.
3. **Modo:** todo o app é **Operate** (a pessoa conclui uma tarefa). Precisão e contenção, padrões conhecidos; nada de `bolder`, `delight` ou `overdrive`, que pertencem a superfícies de persuasão ou experiência.
4. **Refinamento, não redesenho.** As tarefas atuais refinam a identidade escolhida pelo dono (D-022 a D-026: menta, lima, preto, Nunito, pílulas). O `new-work.md` e a troca de `DESIGN.md` só com decisão nova do dono.
5. **Ver o resultado:** no lugar do modo `live`, use as capturas do roteiro `apps/web/ux-audit/capture.mjs` (cabeçalho do script) nos tamanhos 360, 390 e 1280 px, claro e escuro.
6. **Indisponíveis aqui:** `live`, `generate`, `hooks`, `doctor`, `pin` e o detector determinístico citado em `critique` e `audit` (faça essas checagens lendo o código e as capturas).
7. **Arquivos que o Impeccable criaria:** não crie `.impeccable/`; o contexto do projeto fica só em `PRODUCT.md` e `DESIGN.md`.

## Atualizar a cópia

Clone o repositório oficial numa pasta à parte, compare `plugin/skills/impeccable/SKILL.md` e `reference/` com esta cópia, substitua só esses arquivos e atualize o commit e a versão acima, num PR próprio.
