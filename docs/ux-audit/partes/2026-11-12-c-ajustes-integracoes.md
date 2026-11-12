# Auditoria de UX — 12/11/2026 · parte C (2ª rodada): ajustes e integrações

Escopo: S01, S03 (+ `vazio-S03`), S04, S05 (+ `vazio-S05`), S06, S07, S08, S10 (Dados e privacidade), S11 (Diagnóstico), I01, I02, I03, I04, I05 (+ `vazio-I05`) e I06 · tamanhos `small` 360×640, `phone` 390×844 (claro e escuro), `tablet` 768×1024 e `desktop` 1280×800 · capturas: `/tmp/claude-0/-home-claude-oakfinance/dc0bd26e-5ac6-500d-b86b-bc6158574786/scratchpad/audit` · commit: cb65667

Método: skill Impeccable (`critique` e `audit`, modo Operate) pelo caminho "Launcher unavailable", com `frontend-design` como lente complementar; cada suspeita conferida no código.

Artefatos do roteiro, que não são achados: o build das capturas tem o Open Finance **ligado** (a I01 mostra "Bancos conectados" e a I02 abre o fluxo do Meu Pluggy; em produção, pela D-080, a I01 é a `ImportHubScreen`, só com Importar extrato e Nota fiscal, e a I02 redireciona para a I01). O que só aparece com o Open Finance vale S3 no máximo. Também são do roteiro: os horários da S07 em "08:00 PM" (o `<input type="time">` segue o idioma do Chromium sem interface), o texto "clique no cadeado ao lado do endereço" (user agent de computador), os 20 eventos repetidos no Diagnóstico e o espaço comum entre "R$" e o número (G4, fica para a T-130; é ele que parte "R$ / 6.850,00" em duas linhas na S05 a 360 px).

A moldura comum (TopBar, abas, FAB, barra lateral) ficou fora; ver a nota no fim.

## Revalidação da 1ª rodada

| ID | Situação | Evidência |
|---|---|---|
| UXC-001 — importado de entrada como despesa | resolvido | `moneyKindOf` deriva o sinal de `kind` (`apps/web/src/features/inbox/screens.tsx:37-42`, usado em `:57`). |
| UXC-002 — sem caminho para Conexões/Importar no celular | resolvido | Linha "Conexões e importação" no grupo "Dados e importação" (`S01__phone__light__pagina.png`; `features/settings/screens.tsx:82`). |
| UXC-003 — "Conectar banco" em tela vazia; I01 sem importar e nota | resolvido | I01 com as três seções (`I01__phone__light__pagina.png`); I02 com explicação e ações (`I02__phone__light.png`); sem Open Finance a I01 é a `ImportHubScreen` (`features/connections/ImportCards.tsx:63-69`). |
| UXC-004 — S01 como nuvem de pílulas | parcial | Grupos com título, linhas de 48 px com seta, valor do tema e "Sair" separado (`S01__tablet__light.png`). Continuam fora da S01 o S09 "Instalar app" e a página "Privacidade" da UX §3 S10 (não há rota nem texto: `app/screens.ts`, `i18n/pt-BR.ts`). Defeito novo da lista em UX2C-006. |
| UXC-005 — títulos `h2` com peso 500 | resolvido | Regra de base `h1, h2, h3` em 800 (`apps/web/src/styles/base.css:9-18`); "Para decidir", "Receitas fixas" e os vazios saem em negrito. |
| UXC-006 — card sem espaço entre os filhos | resolvido | Grade com `gap: var(--space-3)` no corpo do card (`apps/web/src/ui/ui.css:183-187`); `S10__phone__light__pagina.png` e `I04__phone__light.png` com respiro. |
| UXC-007 — formulários sempre abertos com teclado embutido | resolvido | "Adicionar conta" e "Adicionar cartão" abrem `BottomSheet` (`features/accounts/AccountsScreen.tsx:313-351`); `S03__phone__light.png` cabe numa tela. |
| UXC-008 — segmentado sem rótulo, seleção só por cor, trilho invisível | parcial | Rótulo visível, contorno de 2 px e trilho `--surface-inset` (`ui/ui.css:428-464`). Continua a quebra das opções em duas linhas na S06 a 360 e 390 px; ver UX2C-004. |
| UXC-009 — Switch e slider no escuro | resolvido | Check preto sobre o botão branco e preenchimento lima (`S06__phone__dark.png`; `app/shell.css:1483-1488`). |
| UXC-010 — conta sem edição | resolvido | **Editar** na linha da conta (`S03__phone__light.png`; `AccountsScreen.tsx:107-110`). |
| UXC-011 — I05 sem categoria sugerida, botões colados | resolvido | Linha "A classificar" com ícone e ações lado a lado com espaço (`I05__phone__light.png`; `inbox/screens.tsx:59-72`, `:280`). |
| UXC-012 — card sem candidato com "São diferentes" | resolvido | Uma coluna com **Manter como novo** e **Ignorar**; pergunta própria para pagamento de fatura (`inbox/screens.tsx:108-142`). |
| UXC-013 — Regras em frase corrida | resolvido | Duas linhas por regra e seta (`I06__small__light.png`). |
| UXC-014 — botões da I04 em duas linhas a 360 px | resolvido | Empilhados a 360 px (`I04__small__light.png`). |
| UXC-015 — vazio de contas com a pergunta do onboarding | resolvido | "Cadastre a conta corrente, a carteira ou o VR…" (`vazio-S03__phone__light.png`). |
| UXC-016 — S05 sem título na primeira seção | resolvido | "Receitas fixas" e "Contas fixas" com o mesmo estilo; ação dentro do vazio e "Nova…" no fim (`vazio-S05__phone__light.png`, `S05__phone__light__pagina.png`). |
| UXC-017 — aviso de dia inválido antes de digitar; listas sem título | resolvido | Títulos "Contas" e "Cartões"; o motivo só aparece com erro de campo (`features/accounts/CardsSection.tsx:106-107`, `:342`). |
| UXC-018 — Diagnóstico com MB sem milhar e fonte mono | parcial | "200,0 KB de 2,0 GB" e códigos em Nunito (`S11__phone__light__pagina.png`); "Versão 0.0.0" continua (`apps/web/package.json:3`). |
| UXC-019 — categorias sem seta nem limite | resolvido | Seta em todas as linhas e coluna de limite (`S04__phone__light__pagina.png`; `app/shell.css:2154-2161`). O seed não tem limite, então o valor não foi visto. |
| UXC-020 — I03 sem indicação de arrastar | resolvido | "Ou arraste o arquivo para cá." no computador e contorno tracejado no arraste (`I03__desktop__light.png`; `app/shell.css:1273-1276`). |
| UXC-021 — título da S06 em duas linhas | resolvido | "Cálculo e orçamento" numa linha (`S06__small__light.png`). |
| UXD-001 — "Importar extrato" três vezes na I01 | resolvido | O vazio tem só **Conectar banco** como primário (`I01__phone__light__pagina.png`). |
| UXD-002 — I01 não diz que a sincronização está indisponível | aberto (v2) | Só existe com o Open Finance; em produção a seção não aparece (D-080, D-084 item 12). |
| UXD-003 — "Item ID" | aberto (v2) | "Tenho um Item ID" continua (`I02__phone__light.png`); Open Finance. |
| UXD-004 — falha da conexão oferece "Conferir agora" | aberto (v2) | Mesmos botões para falha e sucesso (`features/connections/screens.tsx:324-335`); Open Finance. |
| UXD-005 — sem "Desconectar" e sem "Desfazer importação" na I01 | parcial | `RecentImports` com **Desfazer importação** na I01 (`ImportCards.tsx:43-44`). "Desconectar" fica para a v2 (exceção conhecida). |
| UXD-006 — texto encostado no botão | resolvido | Mesma correção do UXC-006. |
| UXD-007 — "Escolher arquivo OFX ou CSV" em duas linhas | resolvido | Rótulo curto "Escolher arquivo" com as dicas abaixo (`I01__small__light.png`). |
| UXD-008 — botão da I01 não escolhe arquivo; dica do BB muda de lugar | resolvido | O botão abre o seletor e passa o arquivo à I03 (`ImportCards.tsx:18-37`); dicas em legenda abaixo do botão nas duas telas. |
| UXD-009 — plural fixo | resolvido | `tn()` com chaves `.one` (`features/connections/screens.tsx:328`). |
| UXD-010 — "Renovar" do aviso não renova; tons diferentes | aberto (v2) | `ConnectionBanner.tsx:29` e `BankConnectionCard.tsx:30-31` sem mudança; Open Finance. |
| UXD-011 — card do banco dentro do card; nome sem peso | parcial | O `h3` agora sai em 800 pela regra de base; o `GlassCard` dentro do card da seção continua (`BankConnectionCard.tsx:81-88`); Open Finance. |
| UXD-012 — `.reconcile-diffs` fora da regra da lista | resolvido | Seletor de volta junto de `.inbox-list` (`app/shell.css:1397-1404`). |

Placar: **25 resolvidos, 5 parciais, 4 abertos** (os quatro abertos são do Open Finance e ficam para a v2 pela D-080 e pela D-084 item 12).

## Resumo dos achados novos

| Severidade | Achados |
|---|---|
| S1 | 0 |
| S2 | 4 |
| S3 | 9 |

Os 5 que mais melhoram estas telas se corrigidos primeiro:
1. UX2C-001: o "Saldo nas contas" do Início leva à S03, que não mostra saldo de nenhuma conta.
2. UX2C-002: na S05, cada ocorrência tem quatro ações soltas, com os botões fantasmas desalinhados; um salário ocupa a tela inteira.
3. UX2C-004: no controle segmentado as opções têm a largura do texto: quebram em duas linhas na S06, deixam trilho vazio na S08 e alargam o card a 360 px.
4. UX2C-003: receitas fixas e contas fixas mostram informações diferentes (regra, "Próximas").
5. UX2C-005: na I05, um título fica fora do card e o outro dentro, e há dois primários pretos na mesma tela.

## Achados

### UX2C-001 — "Saldo nas contas" do Início leva a uma tela sem nenhum saldo

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Hierarquia / Estados (P4) | S03 (destino do H01) | todos |

**O que se vê:** em `S03__phone__light.png` cada conta mostra nome, tipo e "Meios: Pix, Débito, Boleto, TED/DOC, Outro", mais **Editar** e **Arquivar**. Não aparece o saldo de nenhuma conta nem o total. A pessoa toca em "Saldo nas contas R$ …" no cartão do Início para entender de onde vem o número e chega a uma tela que não responde a isso.
**O que a spec pede:** UX §3 H01 item 2 ("Linha ‘Saldo nas contas R$ 2.450,00’ com chevron → lista de contas (`S03`)"); P4 (o detalhe a um toque mostra a resposta); CLAUDE.md §1 item 3 ("como está minha conta").
**Causa provável:** `apps/web/src/features/dashboard/HomeOverview.tsx:168-178` (link do saldo para `/ajustes/contas`); `apps/web/src/features/accounts/AccountsScreen.tsx:89-97` (`AccountRow` sem valor; o saldo só existe como `initialBalanceCents` no cadastro, `:194`).
**Correção sugerida:** na linha da conta, o saldo atual em `MoneyText` alinhado à direita, com números tabulares (o mesmo cálculo que dá o `balanceCents` do Início, por conta), e o total "Saldo nas contas" no título do card "Contas". Tirar "Meios: …" da linha para dar espaço (ver UX2C-009).

### UX2C-002 — S05: cada ocorrência tem quatro ações soltas e os botões fantasmas ficam desalinhados

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout / Componentes | S05 | todos (pior em small e phone) |

**O que se vê:** em `S05__phone__light__pagina.png`, o card "Salário" tem **Confirmar** (secundário) e, abaixo, **Não recebi este mês**, **Mudar valor** e **Encerrar a partir desta** como botões fantasmas, cada um na sua linha. O texto dos fantasmas começa 24 px à direita da margem do card (é o padding da pílula sem fundo), então a coluna de texto fica serrilhada. Um único salário ocupa 570 px de altura, e com três recorrências a tela passa de 1.600 px. Em `S05__small__light.png` só cabem o título e as ações da primeira receita. No `desktop` (`S05__desktop__light.png`), **Mudar valor** também começa mais para dentro que **Confirmar**.
**O que a spec pede:** UX §3 S01 linha S05 (editar, pular, encerrar); UX §5.1 (hierarquia dos botões); instrução §3 item 4 (alinhamentos); P4.
**Causa provável:** dois grupos de ações por card: `apps/web/src/features/recurrences/IncomeScreen.tsx:261-273` (Confirmar e Não recebi) e `apps/web/src/features/recurrences/RecurrenceTools.tsx:72-87` (Mudar valor e Encerrar), os dois com `.detail-actions` (`app/shell.css:580-584`, `flex-wrap`); o fantasma mantém o `padding: 0 var(--space-5)` do `.btn` sem fundo (`ui/ui.css:85-88`). O mesmo em `ExpensesSection.tsx:245-269`.
**Correção sugerida:** deixar à vista só a ação da ocorrência atual (**Confirmar** e **Não recebi este mês**/**Pular este mês** numa linha), e passar **Mudar valor** e **Encerrar a partir desta** para um menu da recorrência (botão `MoreHorizontal` com rótulo acessível no cabeçalho do card) ou para a folha de edição aberta ao tocar no card. Quando um fantasma ficar em fluxo de texto alinhado à esquerda, usar uma variante "link" sem padding horizontal.

### UX2C-003 — Receitas fixas e contas fixas mostram informações diferentes

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes e consistência | S05 | todos |

**O que se vê:** em `S05__phone__light__pagina.png`, o card de receita tem a regra ("R$ 6.850,00 · todo dia 5 · Banco do Brasil"), a situação do mês e a lista com o rótulo "Próximas". Os cards de conta fixa ("Aluguel", "Internet") não têm a regra (valor, dia, meio de pagamento) nem o rótulo "Próximas": as três datas previstas aparecem soltas logo depois dos botões. Quem quer saber em que dia vence a internet precisa deduzir pela lista. As duas seções são paralelas na tela, mas não se leem como iguais.
**O que a spec pede:** UX §3 S01 linha S05; instrução §3 item 5 (o mesmo componente com aparência diferente).
**Causa provável:** `apps/web/src/features/recurrences/IncomeScreen.tsx:248-254` (`fixed.every`) e `:293` (`fixed.upcoming`) não têm par em `apps/web/src/features/recurrences/ExpensesSection.tsx:235-288`; os títulos também usam níveis diferentes (`headingLevel={2}` em `IncomeScreen.tsx:246`, `{3}` em `ExpensesSection.tsx:234`), embora as duas seções tenham o mesmo `h2` de seção.
**Correção sugerida:** um só componente de card de recorrência para as duas seções: regra na primeira linha (despesa: "R$ 1.200,00 · todo dia 10 · Pix"; valor variável com "≈"), situação do mês, ações e "Próximas". Os dois títulos de card em `h3`, abaixo do `h2` da seção.

### UX2C-004 — Controle segmentado: opções na largura do texto, quebra em duas linhas, trilho vazio e card mais largo que a coluna

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout / Componentes | S06, S08 | small, phone, tablet, desktop; claro e escuro |

**O que se vê:** em `S06__phone__light__pagina.png` e `S06__small__light.png`, as opções "do vencimento da fatura" e "da compra" quebram em duas linhas dentro da pílula, com o texto alinhado no canto de cima à esquerda. A pergunta "Compras no cartão contam no mês" vem em legenda cinza de 13 px, menor que as próprias opções e que os rótulos dos Switches logo abaixo. Em `S08__phone__light.png` e `S06__tablet__light.png` as opções ficam à esquerda e sobra trilho vazio à direita ("Automático · Reduzido ·    "). Em `S08__small__light.png` o card de Aparência fica 7 px mais largo que a coluna: margem de 20 px à esquerda e de 13 px à direita, porque o segmentado do tema não encolhe.
**O que a spec pede:** UX §4.0 (seleção com contorno; pílulas); UX §5.9 (segmentado); instrução §3 itens 3 e 4 (quebras ruins, alinhamento); correção sugerida no UXC-008 (opções em coluna abaixo de 600 px).
**Causa provável:** `apps/web/src/ui/ui.css:428-450`: `.segmented` é `inline-flex` com rótulos `inline-flex` sem `flex: 1` nem `justify-content: center`, e o `<fieldset>` mantém o `min-inline-size: min-content` padrão do navegador, que impede o card de encolher. A pergunta usa `.appearance-label` (`apps/web/src/features/settings/CalcSettingsScreen.tsx:236`; `app/shell.css:1827-1832`, legenda de 13 px). Os textos são `calc.cardMonth.*` (`i18n/pt-BR.ts:364-366`).
**Correção sugerida:** no componente: `.segmented { display: flex; min-inline-size: 0 }`, `.segmented label { flex: 1 1 0; justify-content: center; text-align: center }`, e, quando as opções não couberem numa linha, empilhar (prop `stack` ou container query) em vez de quebrar dentro da pílula. Na S06, a pergunta com o estilo de rótulo de campo (`--font-size-label`, 600, `--text-primary`) e as opções empilhadas no celular.

### UX2C-005 — I05: um título fora do card e outro dentro, e dois primários pretos na mesma tela

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Hierarquia / Consistência | I05 | todos |

**O que se vê:** em `I05__phone__light.png`, "Para decidir" é um título sobre o fundo menta, acima do card; "Novos do banco" é um título dentro do card. São duas seções paralelas com tratamentos diferentes, e acima delas "2 para conferir" é mais um texto em negrito. A tela tem dois botões em pílula preta (**Manter como novo** e **Marcar todos como revisados**), e nenhum deles é claramente a ação principal. No `tablet` (`I05__tablet__light.png`) o mesmo.
**O que a spec pede:** UX §5.1 (um primário por tela ou por área de decisão); instrução §3 itens 2 e 5.
**Causa provável:** `apps/web/src/features/inbox/screens.tsx:261-262` (seção `home-block` com `h2` fora do card) e `:273-274` (`h2` dentro do `GlassCard`); `:125` e `:298` (dois `Button` primários).
**Correção sugerida:** os dois títulos com o mesmo tratamento (os dois como `title` do `GlassCard`, ou os dois fora como cabeçalho de seção). **Marcar todos como revisados** como secundário enquanto houver um card em "Para decidir", e primário quando ele for a única decisão da tela.

### UX2C-006 — S01: a seta das linhas sem valor fica 8 px à esquerda da seta da Aparência

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout | S01 | todos |

**O que se vê:** em `S01__phone__light__pagina.png`, `S01__tablet__light.png` e `S01__desktop__light.png`, a seta de "Aparência · Claro" fica mais à direita que as setas de todas as outras linhas; a coluna de setas não forma uma linha vertical.
**O que a spec pede:** instrução §3 item 4 (alinhamentos); UX §5 (lista de ajustes com a seta à direita).
**Causa provável:** `apps/web/src/app/shell.css:2119-2122`: `.settings-row` tem três colunas (`minmax(0, 1fr) auto auto`) com `gap`. Sem valor, a seta cai na segunda coluna e a terceira fica vazia, mas o espaço entre colunas continua (`features/settings/screens.tsx:42-49`).
**Correção sugerida:** pôr a seta sempre na última coluna (`.settings-row > svg { grid-column: 3 }`) ou montar a grade como `1fr auto` com valor e seta juntos num `span`.

### UX2C-007 — Sem o Open Finance, a interface continua chamando a área de "Conexões"

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / Consistência | S01, I01, S10 (build de produção) | todos |

**O que se vê:** pelo código (o build das capturas tem o Open Finance ligado). Em produção não há banco para conectar (D-080), mas a linha da S01 e o título da I01 dizem "Conexões e importação", a barra lateral diz "Importar extrato" para a mesma rota e o texto do backup (S10) diz "Não inclui as conexões bancárias". São três nomes para o mesmo destino, e um deles promete algo que o app não tem.
**O que a spec pede:** D-080 (Open Finance escondido); UX §6.2 regra 1 (o rótulo diz o que acontece); instrução §3 item 5.
**Causa provável:** `apps/web/src/features/settings/screens.tsx:82` e o título `shellText.screens.I01` (`i18n/pt-BR.ts:1108`) não olham `OPEN_FINANCE_ENABLED`, enquanto `apps/web/src/app/AppShell.tsx:84-91` e `AccountMenu.tsx` já trocam o rótulo; `backup.hint` (`i18n/pt-BR.ts:137`) é fixo.
**Correção sugerida:** com o Open Finance desligado, usar "Importar extrato e nota" (ou "Importação") na linha da S01, no título da I01 e na barra lateral, e tirar "as conexões bancárias" do `backup.hint`. Texto da UX §6.4, com registro em DECISIONS.

### UX2C-008 — S03: a coluna de ações com rótulo ocupa 40 % da linha e desalinha entre contas e cartões

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout | S03 | small, phone |

**O que se vê:** em `S03__phone__light.png`, **Editar** e **Arquivar** (ícone e rótulo, empilhados) ocupam a metade direita de cada linha. Por isso "Meios: Pix, Débito, Boleto, TED/DOC, Outro" quebra em duas linhas a 390 px e em três a 360 px (`S03__small__light.png`). A coluna das contas começa em x ≈ 222 px e a do cartão em x ≈ 236 px, porque cada linha calcula a sua largura.
**O que a spec pede:** instrução §3 item 4 (alinhamentos, quebras); P4.
**Causa provável:** `apps/web/src/app/shell.css:269-273` (`.account-row` em `flex` com `space-between`, sem largura de coluna) e `:287-292` (`.account-actions` com `flex-wrap`); botões `ghost` `sm` com rótulo em `AccountsScreen.tsx:107-115` e em `CardsSection.tsx`.
**Correção sugerida:** a linha inteira abre a folha de edição (com **Arquivar** e **Excluir** dentro dela), com uma seta à direita como na S01 e na S04; ou, mantendo os botões, grade `1fr auto` comum à lista, com as ações lado a lado só com ícone de 48 px e `aria-label`.

### UX2C-009 — S03: "Meio imediato, sem formas" ainda usa o termo proibido

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy (glossário) | S03 | todos |

**O que se vê:** pelo código (o seed só tem contas correntes). Na carteira, no VR e no VA, a linha da conta diz "Meio imediato, sem formas". A D-084 item 6 trocou "Formas:" por "Meios:" só no outro texto. Nas contas correntes, a lista "Meios: Pix, Débito, Boleto, TED/DOC, Outro" repete em toda conta a mesma informação fixa do tipo.
**O que a spec pede:** UX §0.2 (glossário: "meio de pagamento", nunca "forma de pagamento"); D-084 item 6.
**Causa provável:** `apps/web/src/i18n/pt-BR.ts:552` (`accounts.immediate`), usado em `features/accounts/AccountsScreen.tsx:55-58`.
**Correção sugerida:** "Pagamento na hora, sem fatura" (ou só o tipo, "Carteira (dinheiro)"), com registro na §6.4. Como a lista de meios só depende do tipo, ela pode sair da linha e ficar no formulário.

### UX2C-010 — Vazios de S03 e S05 resolvidos de jeitos diferentes

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Estados / Consistência | `vazio-S03`, `vazio-S05` | todos |

**O que se vê:** em `vazio-S05__phone__light.png`, o vazio fica direto sobre o fundo menta, com o ícone num círculo branco e a ação primária preta dentro do vazio. Em `vazio-S03__phone__light.png`, o vazio fica dentro de um card com título, o ícone sem círculo, e a ação (**Adicionar conta**) é uma pílula secundária fora do vazio. Sem nenhuma conta, adicionar a primeira é a única coisa a fazer na S03, e a tela não tem um primário.
**O que a spec pede:** UX §5.25 (`EmptyState` com ação primária); D-101 item 5 (padrão adotado na S05); US-63.
**Causa provável:** `apps/web/src/features/accounts/AccountsScreen.tsx:284-311` (`EmptyState` sem `primaryAction` dentro do card, botão à parte depois dele); `features/recurrences/IncomeScreen.tsx:233-238` (`primaryAction` no `EmptyState`, sem card).
**Correção sugerida:** escolher um padrão e aplicar nos dois. A sugestão é a da S05: no vazio, **Adicionar conta**/**Adicionar cartão** como `primaryAction` do `EmptyState`; com itens, o botão secundário no fim da lista.

### UX2C-011 — S06: o trilho do slider fica com 80 px a 360 px

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Ergonomia (P1) | S06 | small |

**O que se vê:** em `S06__small__light.png`, os três sliders de percentual têm cerca de 80 px de trilho para ir de 0 a 100: cada ponto percentual vale menos de 1 px, e acertar 50 % no dedo é tentativa e erro. No `tablet` o trilho tem 490 px.
**O que a spec pede:** UX §3 S01 linha S06 ("sliders com valor em texto"); UX §0.1 (alvos e precisão no toque); P1.
**Causa provável:** `apps/web/src/app/shell.css:1476-1481`: `.calc-pct` com colunas fixas `7rem 1fr 3.5rem` e `gap` de 12 px, que deixam ao slider só o que sobra de 272 px.
**Correção sugerida:** abaixo de 400 px, nome e valor numa linha e o slider na linha de baixo, com a largura inteira (`grid-template-areas`); manter o passo 1 e as setas do teclado.

### UX2C-012 — S07: o resumo semanal promete "o disponível", que saiu do Início

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy | S07 | todos |

**O que se vê:** em `S07__phone__light__pagina.png`, "Resumo semanal: Gastos da semana, maiores categorias e o disponível". Pela D-081, o "Disponível para gastar" saiu do Início, e a pessoa não reconhece mais esse número em nenhuma tela principal.
**O que a spec pede:** D-081; UX §6.2 (o texto descreve o que a pessoa vai receber).
**Causa provável:** `apps/web/src/i18n/pt-BR.ts:883` (`reminders.weeklyHint`).
**Correção sugerida:** alinhar ao Início atual, por exemplo "Gastos da semana, maiores categorias e o saldo nas contas", e conferir o conteúdo real do push semanal. Ver também Contradições, sobre o "disponível" da S06.

### UX2C-013 — S11: rótulo e valor mudam de posição de uma linha para outra, e o id do aparelho quebra no meio

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout / Tipografia | S11 | small, phone |

**O que se vê:** em `S11__phone__light__pagina.png`, "Versão", "Espaço usado", "Alterações pendentes", "Último envio" e "Cursor" têm o valor à direita, mas "Aparelho" e "Armazenamento" têm o valor embaixo, em negrito. O id do aparelho quebra no meio ("01a1d0d8-3b46-7421-92b9- / a96ce2b1efec"), e "Pode ser apagado pelo sistema", em negrito, parece um título de seção.
**O que a spec pede:** instrução §3 itens 3 e 4 (quebras e alinhamentos); UX §3 S01 linha S11.
**Causa provável:** a `Row` do Diagnóstico (`apps/web/src/features/settings/DiagnosticsScreen.tsx:177-178` e seguintes) põe o valor ao lado do rótulo e deixa os valores longos quebrarem para a linha de baixo.
**Correção sugerida:** id do aparelho encurtado (8 primeiros caracteres, com **Copiar** para o id inteiro) e numa linha (`white-space: nowrap`); valores de texto ("Pode ser apagado pelo sistema") no peso normal de `--text-secondary`, como os demais valores de texto.

## Contradições e lacunas na spec

- **"Disponível" depois da D-081.** A S06 continua com o nome "Disponível para gastar e orçamento" na UX §3 (e no `<title>` da página) e com a prévia "Com estes ajustes: R$ 8.076,50 disponíveis em novembro" (`calc.preview`). O Início não mostra mais esse número, então a prévia descreve um valor que a pessoa não vê em nenhum outro lugar. O dono precisa decidir se a prévia passa a mostrar o efeito nas faixas do 50/30/20 ou se o "disponível" volta a aparecer em algum ponto.
- **"Recebido do banco" numa saída.** A §6.4 (`review.imported`) rotula o lado importado do card da I05 como "Recebido do banco", também para débitos ("−R$ 27,90"). "Recebido" lido ao lado de uma despesa sugere entrada. Sugestão: "Veio do banco" ou "No extrato do banco".
- **S01 incompleta pela tabela da UX §3.** A S09 "Instalar app" e a página "Privacidade" da S10 continuam na spec e não existem no app. É preciso decidir se saem da spec ou entram numa tarefa.
- **S08 na tabela da UX §3.** A linha ainda diz "Tema: Automático / Claro / Aero noturno · Transparência…"; o app usa "Escuro" e já tirou a Transparência (D-084 item 7). A T-128 marcou as seções do Aero, mas essa linha da tabela ficou.
- **Ação principal no topo.** "Nova regra" (I06) e "Nova categoria" (S04) ficam no topo da tela, fora do terço inferior da P1. Para telas de gestão, pouco usadas, isso é aceitável, mas a spec não diz quando a P1 pode ceder.

## O que está bom

- A S01 agora se lê de relance: grupos com título, linhas de 48 px com seta, o valor do tema à direita e "Sair" separado no fim, igual nos quatro tamanhos.
- Os Switches e os sliders funcionam nos dois temas (check preto sobre botão branco, preenchimento lima no escuro), e os títulos de seção e dos vazios ganharam peso.
- A I05 deixa claro o que falta ("A classificar" com ícone e cor de alerta), com ações que dizem o resultado (**Manter como novo**, **Revisado**).
- Importar extrato abre o seletor já na I01, as dicas ficam no mesmo lugar nas duas telas, e a I03 aceita arrastar no computador.
- Nenhuma rolagem horizontal nas capturas do escopo, e o tablet usa uma coluna larga, sem buracos.

## Nota fora do escopo (para a frente da moldura)

Em `I05__phone__light.png`, `vazio-I05__phone__dark.png` e `I05__small__light.png`, a aba ativa "Lançamentos" é uma pílula lima mais estreita que o próprio rótulo, que encosta nas bordas dela; a UX §5.33 (T-128) fala em círculo lima. Os primários também têm um leve degradê (`--grad-primary`, `apps/web/src/styles/tokens.css:138` e `:328`), o que vale conferir com a regra "sem brilho" da §4.0. Os dois são da moldura e dos tokens, não destas telas; ficam a confirmar pela frente que revisa a moldura.
