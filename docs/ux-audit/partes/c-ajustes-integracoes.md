# Auditoria de UX — 11/11/2026 · parte C: ajustes e integrações

Escopo: S01, S03 (+ `vazio-S03`), S04, S05 (+ `vazio-S05`), S06, S07, S08, S09 (Dados e privacidade, rota `/ajustes/dados`), S10 (Diagnóstico, rota `/ajustes/diagnostico`), I06, I01, I02, I03, I04, I05 (+ `vazio-I05`) · tamanhos `small` 360×640, `phone` 390×844 (claro e escuro) e `desktop` 1280×800 · capturas: `/tmp/claude-0/-home-claude/c11706d4-8982-5bbe-949b-0b13adbf4a3a/scratchpad/shots` · commit: f002ac8

Nota de nomes: as capturas chamam de S09 e S10 o que a UX §3 S01 e o app (`shellText.screens.S10`/`S11`) chamam de S10 "Dados e privacidade" e S11 "Diagnóstico". Abaixo uso o nome da captura e, entre parênteses, o da UX quando importa.

A moldura comum (TopBar, abas, FAB, barra lateral) ficou fora; só é citada onde quebra numa tela deste escopo.

## Resumo

| Severidade | Achados |
|---|---|
| S1 | 2 |
| S2 | 10 |
| S3 | 9 |

Os 5 que mais melhoram o app se corrigidos primeiro:
1. UXC-001 — Entradas do banco aparecem como despesa ("−R$") na conferência (I05).
2. UXC-002 — No celular não há caminho para Conexões nem para Importar extrato (S01, I01, I03).
3. UXC-005 — Títulos de seção sem peso: o `h2` herda 500 do reset do Tailwind (I05, S05, S09, S10 e estados vazios).
4. UXC-009 — Tema escuro: Switch ligado sem o check e slider invisível (S03, S06, S07, S08).
5. UXC-007 — Formulários de cadastro sempre abertos, com teclado numérico embutido (S03).

## Achados

### UXC-001 — Entradas do banco aparecem como despesa ("−R$") na conferência

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Estados / Microcopy (P6) | I05 | todos |

**O que se vê:** em `I05__phone__light.png` os dois importados mostram "−R$ 27,90" e "−R$ 150,00". Os dois são saídas no roteiro, então o sinal está certo por acaso: o componente desenha **todo** importado com sinal de menos e o prefixo "Despesa de" para leitor de tela, inclusive receitas (salário pela Pluggy, crédito de OFX/CSV) e estornos no cartão (D-064: "entrada vira estorno").
**O que a spec pede:** UX §5.7 e RN-103 (sinal, cor e ícone conforme o tipo); UX §0.1 (negativo só para despesa); S1 pela regra "valor de dinheiro errado na tela".
**Causa provável:** `apps/web/src/features/inbox/screens.tsx:37` — `TxSummary` usa `<MoneyText value={row.amount_cents} kind="expense" />` fixo. Como `amount_cents` é sempre positivo (`supabase/migrations/20261105000002_core.sql:176`, `check (amount_cents > 0)`) e o sentido está em `kind`, uma receita importada vira "−R$". O mesmo `TxSummary` desenha o lado "Lançado por você" e os itens de "Vinculados automaticamente".
**Correção sugerida:** derivar o `kind` do `MoneyText` de `row.kind` (`income` → `income`, `refund` → `income` ou `neutral` com rótulo "Estorno", `transfer` → `transfer`), como o `TransactionRow` já faz (`apps/web/src/ui/TransactionRow.tsx:56`). Acrescentar um caso de receita importada no `e2e/inbox.spec.ts`.

### UXC-002 — No celular não há caminho para Conexões nem para Importar extrato

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Ergonomia / Navegação | S01, I01, I03 | small, phone |

**O que se vê:** `S01__phone__light.png` lista Contas e cartões, Categorias, Renda e contas fixas, Disponível para gastar e orçamento, Lembretes, Aparência, Dados e privacidade, Diagnóstico, Refazer configuração inicial e Sair. Não há "Conexões e importação". No celular, a I01 só existe pela barra lateral do `lg` (`S01__desktop__light.png` mostra "Conexões" na lateral), e a I03 só é aberta a partir da I01. O menu do toque longo no FAB oferece só Despesa, Receita, Guardar e Ler nota. Resultado: no Android e no iPhone a pessoa não consegue importar um OFX/CSV (US-52/US-53), que é o plano B oficial enquanto o Open Finance não funciona.
**O que a spec pede:** UX §2.1 ("Conexões, importação e leitura de nota: em `/ajustes/conexoes`, no menu de toque longo do FAB e nos atalhos dos estados vazios"); UX §2.2 (S01 → I01 → I03); tabela da UX §3 S01, linha I01.
**Causa provável:** `apps/web/src/features/settings/screens.tsx:22-52` — `SettingsLinks` não tem o item `/ajustes/conexoes`; `apps/web/src/app/AppShell.tsx:66-71` só põe Conexões em `SIDEBAR_ITEMS`; `apps/web/src/features/quick-entry/QuickEntryHost.tsx:59-78` — `FabMenu` sem "Importar extrato".
**Correção sugerida:** acrescentar "Conexões e importação" (→ `/ajustes/conexoes`) à S01 (junto da reestruturação do UXC-004) e, se o dono confirmar a pendência 3 da UX §8, um item "Importar extrato" no `FabMenu`.

### UXC-003 — "Conectar banco" leva a uma tela em branco, e a I01 não tem as seções de importação e nota

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados (US-64) | I01, I02 | todos |

**O que se vê:** `I01__phone__light.png` é só o vazio "Nenhum banco conectado" com **Conectar banco** (pílula preta) e **Importar extrato** (fantasma). O primário leva a `I02__phone__light.png`: só o título "Conectar banco" e a tela vazia, sem texto, sem ação e sem voltar além do navegador. O Open Finance indisponível é esperado (T-076 bloqueada, mock do roteiro), mas o app não diz isso: o botão mais forte da tela termina num beco sem saída. Faltam também as seções 2 ("Importar extrato" com a dica do BB) e 3 ("Nota fiscal (NFC-e)": **Ler QR code da nota** + "Disponível para notas emitidas no Paraná."), que não dependem da Pluggy.
**O que a spec pede:** UX §3 I01 (três seções; estado "indisponível": "Sincronização automática pausada. Enquanto isso, importe o extrato em OFX ou CSV." + atalho para importar); UX §6.2 regra 2 (erro diz o que aconteceu e o que fazer).
**Causa provável:** `apps/web/src/features/connections/screens.tsx:7-27` (I01 provisória só com o `EmptyState`) e `:29-31` (`ConnectBankScreen` devolve só o `ScreenStub`); `docs/TASKS.md:141` (T-076 bloqueada).
**Correção sugerida:** enquanto a T-076 não sai, montar as seções 2 e 3 da I01 (são só links para `/importar` e `/nota`) e trocar o primário por "Importar extrato", deixando **Conectar banco** desativado com o motivo, ou levando a I02 a mostrar o texto do estado "indisponível" com o atalho para importar.

### UXC-004 — Configurações é uma nuvem de pílulas sem grupos, sem valor atual e incompleta

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Hierarquia / Componentes | S01 | todos |

**O que se vê:** `S01__phone__light.png`: dez botões secundários em pílula que quebram linha conforme o tamanho do texto ("Contas e cartões" e "Categorias" na mesma linha, "Disponível para gastar e orçamento" sozinho), sem agrupamento, sem ícone de seta e sem o valor atual. "Sair" (ação destrutiva da conta) tem o mesmo peso dos links. Em `S01__desktop__light.png` as pílulas viram duas linhas corridas. Faltam S02 Perfil (nome, e-mail), S09 Instalar app, I01 Conexões e a página "Privacidade"; a I06 Regras só aparece dentro da S04.
**O que a spec pede:** UX §3 S01 ("Lista em GlassCards agrupados; cada item leva a uma subtela"; "cada item é link com rótulo + valor atual (‘Tema, Automático’)").
**Causa provável:** `apps/web/src/features/settings/screens.tsx:9-52` — tela marcada como provisória ("a lista de ajustes chega depois"), feita com `Button variant="secondary"` soltos, sem lista nem cards.
**Correção sugerida:** uma lista em cards por grupo (Dinheiro: contas e cartões, categorias, renda e contas fixas, cálculo, regras · Integrações: conexões e importação · App: lembretes, aparência, instalar, dados e privacidade, diagnóstico · Conta: perfil, refazer configuração, sair), cada linha um `<a>` de 48 px com rótulo à esquerda, valor atual em `--text-secondary` e chevron Lucide à direita. "Sair" no fim, separado.

### UXC-005 — Títulos de seção sem peso: o `h2` herda 500 do reset do Tailwind

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tipografia / Hierarquia | I05, S05, S09 (S10 Dados), S10 (S11 Diagnóstico), estados vazios em I01, `vazio-I05`, `vazio-S03`, S05 | todos |

**O que se vê:** cabeçalhos com a mesma espessura do corpo: "Para decidir" e "Novos do banco" (`I05__phone__light.png`); "Contas fixas" em 22 px fino (`S05__phone__light.png`); "Exportar lançamentos (CSV)", "Backup completo (JSON)", "Restaurar backup" (`S09__phone__light__pagina.png`); "Aplicativo", "Sincronização", "Lembretes no aparelho", "Últimos eventos" (`S10__phone__light__pagina.png`); e o título de todo `EmptyState` ("Nenhum banco conectado", "Nenhum lançamento pendente", "Nenhuma receita fixa cadastrada"). Ao lado, títulos que passam pelo `card-title` ("Percentuais do orçamento" na S06, "Quais lembretes receber" na S07) saem em 700, então a mesma hierarquia tem dois pesos entre telas.
**O que a spec pede:** UX §4.0 Forma e tipografia (Nunito 500–800 com escala coerente); UX §4.4 (título de card 17 px semibold, `--font-size-heading`); instrução §3 item 2 (um elemento dominante por tela).
**Causa provável:** o `@import "tailwindcss"` (`apps/web/src/styles/base.css:1`) traz o preflight com `h1…h6 { font-size: inherit; font-weight: inherit; }` (`tailwindcss@4.3.4/preflight.css:78-86`). Os `h2` soltos não têm regra própria: `apps/web/src/ui/ui.css:520-523` (`.empty h2` define só o tamanho), `apps/web/src/app/shell.css:308-311` (`.list-month-title` sem peso), `apps/web/src/features/inbox/screens.tsx:188,195`, `apps/web/src/features/settings/DataScreen.tsx:93,215,255`, `apps/web/src/features/settings/DeleteAccountCard.tsx:52`, `apps/web/src/features/settings/DiagnosticsScreen.tsx:165,195,231,236,262`.
**Correção sugerida:** uma regra de base depois do preflight, em `tokens.css` ou `ui.css`: `h1, h2, h3 { font-family: var(--font-display); font-weight: var(--font-weight-bold); }` com `h2` em `--font-size-heading`; nas telas, trocar os `<h2>` soltos dentro de card pelo `title` do `GlassCard` (que já usa `.card-title`).

### UXC-006 — Cards sem espaçamento entre os filhos: texto colado no campo e no botão

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout e espaço | S09 (S10 Dados), I04 | todos |

**O que se vê:** em `S09__phone__light__pagina.png` o rótulo "De" encosta na descrição, o campo "Até" encosta no botão **Exportar CSV**, e **Baixar backup antes de excluir** encosta em **Excluir minha conta**. Em `I04__phone__light.png` a frase "A câmera é usada só para ler o QR code da nota…" encosta no botão **Abrir câmera**. Na I03 e na S07 o mesmo card tem respiro, então parece inacabado.
**O que a spec pede:** UX §0.1 (8 px entre alvos adjacentes); UX §4.8 (espaçamento pela escala `--space-*`).
**Causa provável:** o `GlassCard` (`apps/web/src/ui/GlassCard.tsx:62-87`) não põe layout nos filhos (`.card` em `apps/web/src/ui/ui.css:182-190` só tem padding) e o preflight zera a margem dos `<p>`. Cada tela precisa trazer a sua grade, e estas não trazem: `.export-card` (`DataScreen.tsx:92,214,254`; `DeleteAccountCard.tsx:51`) não tem nenhuma regra em CSS; o card de introdução da câmera (`apps/web/src/features/nfce/QrScanner.tsx:136-146`) não tem classe.
**Correção sugerida:** dar ao corpo do `GlassCard` um `display: grid; gap: var(--space-3)` padrão (com `data-padding="none"` como saída para quem precisa de outra coisa), o que resolve os dois casos e evita a repetição nas próximas telas.

### UXC-007 — Formulários de cadastro sempre abertos, com teclado numérico embutido

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout / Hierarquia / Componentes | S03, `vazio-S03` | small, phone (teclado); desktop (campo sem caixa) |

**O que se vê:** `S03__phone__light__pagina.png` tem 2.270 px de altura: a lista de contas, um formulário "Nova conta" sempre aberto (sem título que diga o que ele é), com um `NumericKeypad` de 4 linhas para "Saldo atual", a lista de cartões e outro formulário aberto com outro teclado para "Limite". A barra de abas cobre o primeiro teclado na tela (`S03__phone__light.png`). A pessoa que só quer ver ou arquivar uma conta rola por dois teclados. No `desktop` (`S03__desktop__light.png`) o teclado some, mas "R$ 0,00" fica alinhado à direita a 900 px do rótulo, sem borda nem fundo de campo: não parece editável.
**O que a spec pede:** UX §5.8 (`AmountInput` `compact` "para formulários do onboarding"; teclado próprio pensado para o Q01); UX §3 S03 (CRUD com Arquivar/Excluir; a criação não precisa ficar exposta); P4 (a resposta antes dos detalhes); UX §5.14 (campo com borda `--border-strong`).
**Causa provável:** `apps/web/src/ui/AmountInput.tsx:45-51,132-138` — em ponteiro grosso o modo é sempre `custom` e o teclado é desenhado logo abaixo, também no `compact`; `apps/web/src/features/accounts/AccountsScreen.tsx:230-259` e `apps/web/src/features/accounts/CardsSection.tsx:233-298` deixam os formulários sempre visíveis; `apps/web/src/ui/ui.css:570-591` — `.amount-input` sem borda nem fundo.
**Correção sugerida:** botões **Adicionar conta** e **Adicionar cartão** que abrem o formulário numa `BottomSheet` (como a edição do cartão já faz em `CardEditSheet`); no `compact`, usar `keypad="native"` (`inputmode="decimal"`) ou abrir o teclado só com o campo focado; dar ao `compact` o visual de campo (borda e raio de 16 px, valor alinhado à esquerda).

### UXC-008 — Controle segmentado: sem rótulo visível, seleção só pela cor e trilho invisível no claro

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Fidelidade ao visual / Acessibilidade visual | S06, S08 | todos (trilho: claro) |

**O que se vê:** em `S06__phone__light__pagina.png` o segundo card começa com duas opções soltas, em minúscula, "do vencimento da fatura" (lima) e "da compra", sem a pergunta "Compras no cartão contam no mês" — sem ela, as opções não fazem sentido. As duas quebram em duas linhas a 390 px e a 360 px (`S06__small__light.png`). Em `S08__phone__light.png` a opção marcada é só um fundo lima (sem contorno preto nem check) e o trilho do grupo, branco sobre o card branco, não aparece, então "Automático Claro Escuro" parece texto solto; no escuro (`S08__phone__dark.png`) o trilho aparece.
**O que a spec pede:** UX §4.0 ("Seleção (chips, segmentado, aba): fundo lima com texto preto **e** contorno preto de 2 px ou ícone de check, para não depender só da cor"; "a lima não serve de borda sobre branco"); UX §3 S01 linha S06 (o rótulo "Compras no cartão contam no mês" faz parte do controle); UX §8 (rótulo visível, 1.4.1).
**Causa provável:** `apps/web/src/ui/SegmentedControl.tsx:34` — o rótulo vai num `<legend className="sr-only">`; `apps/web/src/ui/ui.css:402-410` — trilho `--surface-solid-3` (branco no claro, igual ao card); `:429-433` — selecionado só com `--accent`, sem contorno; uso em `apps/web/src/features/settings/CalcSettingsScreen.tsx:214-221`. O componente é compartilhado, então o defeito de seleção vale também fora deste escopo.
**Correção sugerida:** no componente, prop para rótulo visível (padrão visível, `sr-only` só onde o contexto já diz), trilho `--surface-inset` e selecionado com `box-shadow: inset 0 0 0 2px var(--text-primary)` ou ícone `Check`. Na S06, rótulo visível e opções "Vencimento da fatura" / "Data da compra" (texto da §6.4 a ajustar com registro em DECISIONS), em coluna abaixo de 600 px.

### UXC-009 — Tema escuro: Switch ligado sem o check e slider invisível

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tema escuro / Acessibilidade visual | S03, S06, S07, S08 | phone escuro |

**O que se vê:** em `S06__phone__dark.png` os quatro Switches ligados mostram o botão branco sobre trilho lima com o check quase invisível (traço claro sobre branco); só a cor distingue ligado de desligado. Nos três sliders de percentual, a parte preenchida é preta sobre o card grafite e some; só o polegar e a parte clara ficam.
**O que a spec pede:** UX §5.14 (Switch "botão branco com ícone check (não depende só de cor)"); UX §4.0 Contraste (não texto ≥ 3:1); critério 10 das instruções.
**Causa provável:** `apps/web/src/ui/ui.css:392-393` — `.switch-thumb { color: var(--aqua-700) }`, token do Aero que não existe mais em `tokens.css`: a declaração é inválida e a cor é herdada (preta no claro, por acaso; clara no escuro). `apps/web/src/app/shell.css:1227-1230` — `accent-color: var(--surface-dark)`, que no escuro é `#000000` (`tokens.css:274`).
**Correção sugerida:** `.switch-thumb { color: var(--ink-950) }` (o check fica preto sobre branco nos dois temas) e, na S06, `accent-color: var(--accent)` no escuro (ou um token `--control-fill` por tema). Vale incluir no `tokens.test.ts` uma checagem de `var(--…)` sem definição.

### UXC-010 — Contas não podem ser editadas na S03

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / Componentes | S03 | todos |

**O que se vê:** em `S03__phone__light.png` cada conta tem só **Arquivar** (e **Excluir** quando sem uso); o cartão logo abaixo tem **Editar**. Não há como corrigir o nome, o banco ou o tipo de uma conta, nem o saldo inicial, sem arquivar e criar outra (o que espalha os lançamentos por duas contas).
**O que a spec pede:** UX §3 S01 linha S03 ("CRUD de contas"); D-033 (título "Editar contas e cartões").
**Causa provável:** `apps/web/src/features/accounts/AccountsScreen.tsx:91-108` — `AccountRow` sem ação de editar; `updateAccount` existe em `apps/web/src/data/repositories/accounts.ts:118`, mas nenhum `.tsx` o usa.
**Correção sugerida:** **Editar** na linha da conta abrindo uma folha igual à do cartão (nome, tipo, banco, saldo inicial), usando o `updateAccount` existente, com as mesmas mensagens de nome da RN-07.

### UXC-011 — "Novos do banco" não mostra a categoria sugerida, e os botões do item ficam colados

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / Layout | I05 | todos |

**O que se vê:** em `I05__phone__light.png` o item "PIX ENVIADO JOAO P" mostra valor, descrição e data, mas nenhuma categoria; só o botão **Mudar categoria**. Quando há categoria, ela aparece como legenda de 13 px **acima** do valor, no lugar em que o card de cima escreve "Recebido do banco". Sem ver a categoria, a pessoa não sabe o que **OK** confirma nem quais itens estão em "A classificar", que é justamente o que impede **Marcar todos como revisados**. **Mudar categoria** e **OK** encostam um no outro (sem os 8 px).
**O que a spec pede:** UX §3 I05 ("lista com categoria sugerida editável e **OK** por item"; "exige que nenhum esteja em ‘A classificar’"); UX §0.1 (8 px entre alvos).
**Causa provável:** `apps/web/src/features/inbox/screens.tsx:199` — a categoria entra como `label` do `TxSummary` e, sem `category_id`, vira string vazia (`?? ''`); `:197-213` — o `<li>` não tem layout próprio (`.inbox-list` em `apps/web/src/app/shell.css:1141-1148` só espaça os itens).
**Correção sugerida:** linha de categoria própria abaixo da descrição, com ícone da categoria e o nome, "A classificar" em destaque de alerta (ícone + texto) quando vazia ou na categoria de sistema; ações do item num `div` com `display: flex; gap: var(--space-2)`.

### UXC-012 — Card de conferência sem candidato: frase no lugar do lançamento e "São diferentes" sem comparação

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Microcopy / Estados | I05 | todos |

**O que se vê:** em `I05__phone__light.png` a coluna "Lançado por você" do `ReconcileCard` é substituída pela frase "O lançamento parecido não está mais disponível." em 16 px, sem rótulo, ao lado do importado. Os botões são **São diferentes** e **Ignorar**: "diferentes" de quê, se não há nada para comparar? Pela D-061, esse mesmo card aparece também para pagamento de fatura sugerido, caso em que a frase é falsa (não havia lançamento parecido).
**O que a spec pede:** UX §3 I05 (pagamento de fatura e transferência como ReconcileCard com a pergunta "Pagamento da fatura de {mês}?" / "Transferência entre suas contas?"); UX §6.2 regra 1 (botão diz o resultado).
**Causa provável:** `apps/web/src/features/inbox/screens.tsx:73-79` (frase no lugar do lado manual) e `:101-116` (as mesmas ações do caso com candidato); texto `review.noCandidate` em `apps/web/src/i18n/pt-BR.ts:841`.
**Correção sugerida:** sem candidato, card de uma coluna com o importado e ações que dizem o resultado ("Manter como novo" / "Ignorar"); para pagamento de fatura sugerido, a pergunta da UX §3 I05. A frase atual só quando o candidato existia e foi apagado.

### UXC-013 — Regras: cada item é uma frase corrida, sem hierarquia e com quebras soltas

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tipografia / Layout | I06 | small, phone |

**O que se vê:** `I06__phone__light.png`: 34 itens no formato "ASSAI → Mercado · Padrão · 0 acertos · sem uso", todos no mesmo peso e tamanho; a quebra cai no meio da metainformação ("· 0" numa linha, "acertos · sem uso" na outra; "Padrão" sozinho no fim). O termo e a categoria, que são o conteúdo, não se destacam dos números, e nada indica que o item abre a edição.
**O que a spec pede:** UX §3 S01 linha I06 (termo, categoria, conta, origem, acertos e último uso); instrução §3 item 3 (quebras ruins, palavras soltas).
**Causa provável:** `apps/web/src/features/rules/RulesScreen.tsx:230-244` — junta tudo com `join(' · ')` num único `span`; reaproveita a classe `.cards-invoice` da lista de faturas (`apps/web/src/app/shell.css:367-385`).
**Correção sugerida:** duas linhas por item: "ASSAI → Mercado" em 600 e, abaixo, a meta em `--font-size-caption`/`--text-secondary` ("Padrão · sem uso"; "Aprendida · 12 acertos · último uso 03/11/2026"), cada parte em `white-space: nowrap`; chevron à direita.

### UXC-014 — Botões "Escolher foto" e "Digitar chave" quebram em duas linhas a 360 px

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout | I04 | small |

**O que se vê:** em `I04__small__light.png` os dois botões secundários ficam lado a lado com o rótulo em duas linhas ("Escolher / foto", "Digitar / chave") e o ícone desalinhado à esquerda. A 390 px cabem numa linha.
**O que a spec pede:** instrução §3 item 4 (botões que quebram em duas linhas); UX §3 I04 (botões alternativos sempre visíveis).
**Causa provável:** `apps/web/src/app/shell.css:1392-1399` — `.qr-actions > * { flex: 1 1 140px }`: a 360 px cada botão fica com ~156 px, menos que o rótulo com ícone e padding.
**Correção sugerida:** `flex-basis` de 180 px (os botões passam a empilhar a 360 px) ou `white-space: nowrap` no rótulo do `Button`.

### UXC-015 — Vazio de contas usa a pergunta do onboarding ("Onde está o seu dinheiro?")

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / Estados | `vazio-S03` | todos |

**O que se vê:** em `vazio-S03__phone__light__pagina.png` o vazio diz "Nenhuma conta cadastrada" e, embaixo, "Onde está o seu dinheiro?". Não explica para que servem as contas nem como começar, e é uma pergunta retórica. O vazio dos cartões, logo abaixo, segue o padrão ("Cadastre um cartão para acompanhar faturas e parcelas.").
**O que a spec pede:** UX §6.2 regra 3 (vazio: o que é + por que está vazio + como começar) e regra 11 (sem perguntas retóricas); UX §6.5 (padrão das linhas).
**Causa provável:** `apps/web/src/features/accounts/AccountsScreen.tsx:221-225` — `description={t('onb.accounts.title')}`, título do ON06 reaproveitado.
**Correção sugerida:** texto próprio, por exemplo "Cadastre a conta corrente, a carteira ou o VR para lançar despesas e receitas.", com entrada na UX §6.5 (ver Contradições).

### UXC-016 — Renda e contas fixas: a primeira seção não tem título e o botão de criar fica acima do vazio

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Hierarquia | S05, `vazio-S05` | todos |

**O que se vê:** em `vazio-S05__phone__light.png` a tela começa com **Nova receita fixa** (pílula preta), depois o vazio de receitas; a segunda metade tem o título "Contas fixas", **Nova conta fixa** e outro vazio. A parte das receitas não tem título, então as duas metades não se leem como seções paralelas. Os vazios não têm ação própria; o botão "Nova…" acima deles faz esse papel, mas fica no topo, longe do texto que convida a cadastrar.
**O que a spec pede:** UX §3 S01 linha S05; UX §6.2 regra 3 (vazio com "como começar"); UX §5.25 (`EmptyState` com até duas ações).
**Causa provável:** `apps/web/src/features/recurrences/IncomeScreen.tsx:229-236` (sem `h2` para receitas; botão antes do `EmptyState`) e `apps/web/src/features/recurrences/ExpensesSection.tsx:218-230`.
**Correção sugerida:** títulos "Receitas fixas" e "Contas fixas" com o mesmo estilo (ver UXC-005); no vazio, a ação dentro do `EmptyState` (`primaryAction`); com itens, o botão "Nova…" no fim da seção.

### UXC-017 — S03: aviso de dia inválido aparece antes de digitar, e as listas não têm título

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / Hierarquia | S03, `vazio-S03` | todos |

**O que se vê:** em `S03__phone__light__pagina.png`, com o formulário de cartão ainda vazio, **Adicionar cartão** aparece desativado com "Escolha um dia entre 1 e 31." embaixo, como se algo tivesse sido digitado errado. As listas de contas e de cartões são cards sem título ("Contas", "Cartões"), e os formulários não dizem o que criam.
**O que a spec pede:** UX §6.2 regra 2 (a mensagem diz o que aconteceu); UX §8 (erros com texto ligado ao campo).
**Causa provável:** `apps/web/src/features/accounts/CardsSection.tsx:291-296` — `disabledReason={t('cards.invalidDay')}` fixo, mostrado sempre que `!valid`, inclusive com os campos vazios (os erros por campo de `:93-94` já tratam o dia inválido).
**Correção sugerida:** motivo do botão conforme o que falta ("Preencha o nome e os dias de fechamento e vencimento"), ou nenhum motivo com os campos vazios; `title` "Contas" e "Cartões" nos `GlassCard` das listas.

### UXC-018 — Diagnóstico: espaço em MB sem separador de milhar e códigos em fonte monoespaçada

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tipografia / Microcopy | S10 (S11 Diagnóstico) | todos |

**O que se vê:** `S10__phone__light__pagina.png`: "196,0 KB de 2048,2 MB" (sem ponto de milhar; num celular real a cota passa de dezenas de GB e vira "61440,0 MB"); os "Últimos eventos" saem em fonte monoespaçada do sistema ("usage.sync_ok", "sync.done"), segunda família na interface; "Versão 0.0.0".
**O que a spec pede:** UX §6.2 regra 7 (números em pt-BR); UX §4.0 (fonte única Nunito); UX §3 S01 linha S11 (versão do app).
**Causa provável:** `apps/web/src/features/settings/DiagnosticsScreen.tsx:41-45` — `formatBytes` monta o número à mão, sem `Intl` nem GB; `:269` — `<code>` com a fonte padrão do navegador; versão de `apps/web/package.json:3` ("0.0.0"; em produção recebe `+sha`, `apps/web/vite.config.ts:84`).
**Correção sugerida:** `Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })` com GB acima de 1.024 MB; códigos em Nunito com `font-variant-numeric: tabular-nums` (a tela é técnica por natureza, mas a família é uma só); versão real no `package.json` ou só o `sha` curto.

### UXC-019 — Categorias: a linha não indica que abre a edição nem mostra o limite

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes | S04 | todos |

**O que se vê:** em `S04__phone__light__pagina.png` cada categoria é ícone + nome, sem chevron nem valor; nada sugere que tocar abre a edição, e o limite mensal (definido nessa mesma folha, D-042) não aparece na lista. As categorias de sistema têm o cadeado, então só a ausência dele indica que as outras são editáveis.
**O que a spec pede:** UX §3 S01 linha S04 (editar com limite mensal opcional); P4 (detalhe a um toque e visível).
**Causa provável:** `apps/web/src/features/categories/CategoriesScreen.tsx:386-405` — reaproveita `.cards-invoice` da lista de faturas, só com ícone e nome.
**Correção sugerida:** chevron à direita e, quando houver limite, "Limite R$ 600,00" em `--text-secondary` alinhado à direita com números tabulares.

### UXC-020 — Importar extrato no computador não indica que aceita arrastar

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / Estados | I03 | desktop |

**O que se vê:** `I03__desktop__light.png`: card com a dica do BB, botão de 900 px **Escolher arquivo OFX ou CSV** e a nota de privacidade. A área aceita soltar um arquivo, mas nada diz isso e não há estado visual ao arrastar por cima.
**O que a spec pede:** UX §3 I03 passo 1 ("no `lg` aceita arrastar"); UX §5.29 `ImportDropzone`.
**Causa provável:** `apps/web/src/features/imports/screens.tsx:226-252` — `onDrop` existe, mas sem texto de apoio nem estilo de `dragover`.
**Correção sugerida:** no `lg`, linha "ou arraste o arquivo para cá" e contorno tracejado 2 px `--border-strong` durante o `dragover`; texto novo na §6.4.

### UXC-021 — Título da S06 quebra em duas linhas na TopBar a 360 px

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tipografia / Layout | S06 | small |

**O que se vê:** em `S06__small__light.png` o título "Disponível para gastar e orçamento" ocupa duas linhas centralizadas na TopBar, empurra o conteúdo e quase encosta no botão de sincronização; a 390 px cabe por pouco.
**O que a spec pede:** UX §4.0 Moldura (título de 17 px centralizado, numa linha); instrução §3 item 3.
**Causa provável:** o nome da tela em `shellText.screens.S06` (texto da tabela da UX §3 S01) é longo demais para a TopBar; o componente da moldura não trunca.
**Correção sugerida:** título curto na TopBar ("Cálculo e orçamento"), mantendo o nome longo no item da S01 e no `<title>`, com registro em DECISIONS por ser texto da UX.

## Contradições e lacunas na spec

- **"OK" × §6.2 regra 1.** A UX §3 I05 e a §6.4 (`review.ok`) pedem um botão **OK** por item, e a §6.2 regra 1 proíbe "OK" sozinho. Sugestão: "Está certo" ou "Confirmar categoria".
- **"Formas" × glossário.** A §6.4 tem `accounts.methods` = "Formas: {formas}" e `accounts.immediate` = "Meio imediato, sem formas" (S03), mas o glossário §0.2 manda "Meio de pagamento" e proíbe "forma de pagamento". Sugestão: "Meios: Pix, Débito…".
- **Transparência na S08.** Com a D-023 não há mais vidro; a opção "Transparência: Automática / Sempre sólida" (UX §3 S01, D-051) não muda nada visível. Cabe ao dono decidir se sai da tela.
- **Vazios sem texto normativo.** A §6.5 não tem linha para "Contas" (S03), "Receitas fixas" e "Contas fixas" (S05); as telas criaram textos próprios (UXC-015, `fixed.empty*`).
- **Card sem candidato na I05.** A D-060/D-061 manda mostrar pagamentos sugeridos "sem candidato (só ‘São diferentes’/‘Ignorar’)", o que contradiz a UX §3 I05 (pergunta "Pagamento da fatura de {mês}?") e gera o texto enganoso do UXC-012.
- **Numeração das subtelas.** O roteiro de capturas chama Dados e Diagnóstico de S09 e S10; a UX e o app usam S10 e S11 (S09 = Instalar app, que não tem tela). Vale alinhar o `capture.mjs` para as próximas auditorias.
- **A confirmar, não relatado como defeito:** os campos de hora da S07 aparecem como "07:00 PM", "10:00 PM", "08:00 AM", apesar de `locale: 'pt-BR'` no roteiro e `lang="pt-BR"` no `index.html`; o `<input type="time">` nativo segue o idioma do navegador, e o Chromium sem interface pode ignorar a emulação. Conferir num Android e num iPhone em português.
- **Fora do alcance das capturas:** a S05 "com dados" saiu igual ao vazio (o roteiro não semeia receitas nem contas fixas), então os cards de ocorrência, "Confirmar" e "Pular este mês" não foram vistos. O texto de permissão negada da S07 saiu na versão "computador" porque o user agent das capturas é de computador (artefato do roteiro).

## O que está bom

- A paleta e os cards do D-023 estão aplicados em todas as telas do escopo, sem resto de vidro; o escuro tem boa separação entre card e fundo.
- Nenhuma rolagem horizontal a 360 px, e valores e datas no formato pt-BR com sinal U+2212 (`−R$ 27,90`, `11/11/2026`).
- A S07 explica o bloqueio de notificações em tom calmo, sem vermelho, e lembra que "Os avisos continuam na central" (P3); a S06 recalcula "Com estes ajustes…" antes de salvar.
- A S09 (Dados) deixa claro o que cada arquivo leva e oferece o backup antes de excluir a conta; a I03 avisa que o arquivo não sai do aparelho.
- O `EmptyState` da I01 e da I05 usa exatamente os textos da UX §6.5.
