# Auditoria de UX — 11/11/2026 (parte A: moldura, Início, onboarding e lançamento rápido)

Escopo: moldura comum (TopBar, barra de abas, FAB, barra lateral, SyncBadge, banners) e componentes de `apps/web/src/ui/` que aparecem no Início; ON01, ON02a, ON02b, ON02c, ON03, ON04, ON05, ON06, ON07, ON07b, ON08; H01 (com dados e `vazio-H01`), H01-S, H02 (e `vazio-H02`); Q01-despesa, Q01-despesa-valor, Q01-mais-detalhes, Q01-receita, Q01-guardar · tamanhos `small` 360×640, `phone` 390×844 e `desktop` 1280×800; temas claro e escuro (`phone`) · capturas: `scratchpad/shots` (manifest de 11/11/2026) · commit: f002ac8

## Resumo

| Severidade | Achados |
|---|---|
| S1 — Bloqueia ou engana | 3 |
| S2 — Visivelmente errado | 14 |
| S3 — Polimento | 15 |

Os 5 que mais melhoram o app se corrigidos primeiro:
1. UXA-001 — No celular não há caminho para as Configurações (falta o avatar do Início).
2. UXA-003 — No Q01 do celular o botão "Lançar" e as categorias ficam abaixo da dobra; o teclado numérico ocupa o meio da folha.
3. UXA-008 — O Q01 abre com foco no seletor Despesa, não no valor: o teclado físico não digita e o anel de foco parece uma segunda seleção.
4. UXA-002 — "No cartão para os próximos meses: R$ 3.983,90" parte o valor em duas linhas no herói.
5. UXA-006 — No tema escuro o preenchimento de progresso e as faixas "info" ficam pretos sobre grafite (barra de passos do onboarding invisível).

## Achados

### UXA-001 — No celular não há caminho para as Configurações
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Ergonomia / navegação | H01 (e todo o app no celular) | small, phone (claro e escuro) |

**O que se vê:** `H01__phone__light.png` e `H01__small__light.png`, topo: o TopBar do Início tem olho, sino e SyncBadge, e nada mais. A barra de abas tem Início, Lançamentos, +, Cartões e Planejar. Não há avatar nem item "Configurações". No celular, a pessoa não chega a Ajustes (aparência, lembretes, exportar, backup, sair, excluir conta, conexões); só alcança subtelas soltas por atalhos (`/ajustes/contas` pelo atalho "Contas e cartões", `/ajustes/calculo` e `/ajustes/renda`).
**O que a spec pede:** UX §2.1 "Configurações: avatar no topo do Início → `/ajustes`"; UX §3 H01 item 1 (TopBar com "avatar (→ `/ajustes`)").
**Causa provável:** `apps/web/src/app/AppShell.tsx:148-154` — o `trailing` do TopBar no H01 monta só `HideValuesButton`, `NoticesBell` e `ShellSyncBadge`; o único link para `/ajustes` é o item `settings` de `SIDEBAR_ITEMS` (`AppShell.tsx:69`), que só aparece no `lg` (`apps/web/src/app/shell.css:59-61`, `.shell-sidebar { display: none }` abaixo de 1024 px). Nenhum outro `Link`/`navigate` aponta para `/ajustes`.
**Correção sugerida:** acrescentar ao `trailing` do H01 um `IconButton` de avatar (Lucide `CircleUser`, rótulo "Configurações", 48 px) que navega para `/ajustes`, visível abaixo de 1024 px.

### UXA-002 — Valor "No cartão para os próximos meses" partido em duas linhas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Layout / dinheiro | H01, H01-S (fundo) | small, phone (claro e escuro) |

**O que se vê:** `H01__phone__light.png`, cartão preto: "No cartão para os próximos meses: R$" na primeira linha e "3.983,90" na segunda, com o sublinhado do link quebrado junto. O mesmo em `H01__small__light.png` e `H01__phone__dark.png`. No desktop cabe numa linha.
**O que a spec pede:** UX §3 (critério de tipografia da auditoria): valor de dinheiro nunca partido; UX §0.1 (moeda `R$ 1.234,56` como unidade).
**Causa provável:** `apps/web/src/features/dashboard/HomeOverview.tsx:213-216` — o texto inteiro de `home.futureCard` ("No cartão para os próximos meses: {valor}", `apps/web/src/i18n/pt-BR.ts:222`) vai num único `Link` inline; o valor não está num elemento sem quebra e `.home-card-link` (`apps/web/src/app/shell.css:737-752`) não tem `white-space`.
**Correção sugerida:** renderizar o valor num `<span className="money" style="white-space: nowrap">` (ou separar rótulo e valor em duas linhas fixas, rótulo em cima e valor embaixo), mantendo o chevron alinhado ao valor.

### UXA-003 — No Q01 do celular, "Lançar" e as categorias ficam abaixo da dobra
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Ergonomia (P1, P2) / hierarquia | Q01-despesa, Q01-despesa-valor, Q01-receita, Q01-mais-detalhes | small, phone (claro e escuro) |

**O que se vê:** `Q01-despesa__phone__light.png`: depois do valor vem o teclado numérico (metade da folha), depois as categorias e o meio de pagamento; "Mais detalhes" e o botão **Lançar** não aparecem: é preciso rolar a folha. Em `Q01-despesa__small__light.png` (360×640) só cabe o teclado e a primeira categoria ("Mercado"). O teclado fica no meio da tela, não no terço inferior; a ação primária fica fora da vista. Na `desktop` (sem teclado próprio) o "Lançar" aparece.
**O que a spec pede:** UX §1 P1 (≤ 3 toques: +, valor, categoria, Lançar) e P2 ("FAB, botão Lançar, teclado numérico e abas na zona inferior"); UX §3 Q01, ordem: seletor, valor, categorias, meio de pagamento, Mais detalhes, `NumericKeypad` "no terço inferior" e **Lançar** (largura total, 56 px).
**Causa provável:** `apps/web/src/ui/AmountInput.tsx:132-138` — o `AmountInput` desenha o `NumericKeypad` logo abaixo do campo quando o ponteiro é grosso, então o teclado entra na posição do valor (`apps/web/src/features/quick-entry/QuickEntrySheet.tsx:573`), antes das categorias (`:609`), do meio (`:635`), de "Mais detalhes" (`:681`) e do "Lançar" (`:727`). A folha (`apps/web/src/ui/ui.css:726-737`) rola tudo junto, sem rodapé fixo.
**Correção sugerida:** no Q01, passar `keypad="native"`/desligar o teclado embutido do `AmountInput` e desenhar o `NumericKeypad` como irmão logo acima do botão; pôr teclado e "Lançar" num rodapé fixo da folha (`position: sticky; bottom: 0`) e deixar só categorias, meio e "Mais detalhes" na área que rola. Conferir que, a 360×640, valor, 5 categorias, teclado e "Lançar" cabem sem rolar.

### UXA-004 — Rótulo do herói em Title Case
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tipografia / microcopy | H01, vazio-H01, H01-S (fundo) | todos |

**O que se vê:** `H01__phone__light.png`, topo do cartão preto: "Disponível Para Gastar Em Novembro". Em `H01__small__light.png` quebra em três linhas.
**O que a spec pede:** UX §6.2 regra 5 (caixa normal); UX §6.4 `home.hero.label` "Disponível para gastar em {mês}" (`apps/web/src/i18n/pt-BR.ts:209`).
**Causa provável:** `apps/web/src/app/shell.css:570-575` — `.home-card-month` tem `text-transform: capitalize`, resto do cartão provisório (onde só ia o nome do mês) que passou a receber a frase inteira.
**Correção sugerida:** remover o `text-transform` (o mês já vem em minúsculas, como pede a §6.2).

### UXA-005 — Anel 50/30/20 do Início com moldura quadrada, valor sobre os anéis e pontos soltos
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / layout | H01, vazio-H01 (o mesmo `BudgetRing` aparece na P01) | phone (`__pagina`), todos pelo código |

**O que se vê:** `H01__phone__light__pagina.png`, card "Orçamento 50/30/20": o anel tem um contorno preto quadrado de 1 px em volta; o texto "R$ 7.270,00" é mais largo que o anel interno e passa por cima dos trilhos; com gasto zero, as três pontas arredondadas dos arcos viram três pontos coloridos empilhados às 12 h.
**O que a spec pede:** UX §4.0 (cards brancos limpos, sem molduras que não carregam informação); UX §5.15 (anéis concêntricos e valor central legível).
**Causa provável:** (1) `apps/web/src/ui/BudgetRing.tsx:59` usa a classe `ring`, que o Tailwind v4 (`@import "tailwindcss"` em `apps/web/src/styles/base.css:1`) também gera como utilitário: o CSS publicado tem `.ring{--tw-ring-shadow:… 0 0 0 calc(1px + …) currentcolor; box-shadow:…}`, o que desenha o quadrado preto; (2) `apps/web/src/ui/BudgetRing.tsx:122-126` põe a renda em `data-size="label"` num anel de 96 px (`apps/web/src/ui/ui.css:897-899`), sem reduzir nem abreviar; (3) `apps/web/src/ui/BudgetRing.tsx:102` usa `strokeLinecap="round"` mesmo com arco de comprimento 0.
**Correção sugerida:** renomear a classe para `budget-ring` (e `ring-*` para `budget-ring-*`); no `size="sm"`, tirar o valor do centro (a renda já cabe numa linha "Renda do mês" ao lado) ou usar 13 px com largura máxima do furo; não desenhar o arco quando `base === 0`.

### UXA-006 — No escuro, preenchimentos "info" ficam pretos sobre grafite
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tema escuro / componentes base | ON04, ON05, ON06, ON07, ON07b (barra de passos); Banner/Toast info na moldura | phone dark |

**O que se vê:** `ON07__phone__dark.png`, topo: "Passo 4 de 5 · Cartões" sem barra preenchida visível (só o pedaço claro do trilho no fim). O mesmo nos outros passos. Pelo código, a faixa lateral do Banner e do Toast de tom info também fica preta no escuro.
**O que a spec pede:** UX §4.0 (seleção e destaque em lima com texto preto); §3 item 10 da auditoria (nada que só funciona no claro); WCAG 1.4.11 (≥ 3:1 em elemento não textual).
**Causa provável:** `apps/web/src/ui/ui.css:832-836` — `.progress-fill` usa `var(--_fill, var(--status-info-fg))`, e `--status-info-fg` é `--ink-950` nos dois temas (`apps/web/src/styles/tokens.css:102` e `:293`), porque é a cor de **texto** sobre lima, não de preenchimento. O mesmo token é a faixa do `.banner`/`.toast` (`apps/web/src/ui/ui.css:535`). O `OnbFrame` pede `tone="info"` (`apps/web/src/features/onboarding/OnbFrame.tsx:60-66`).
**Correção sugerida:** usar `--status-info-bg` (lima) como preenchimento padrão do `ProgressBar` e como faixa do Banner/Toast info, ou criar `--status-info-fill` (preto no claro, lima no escuro).

### UXA-007 — Títulos de folhas e de estados vazios em peso normal
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tipografia / consistência | H01-S, Q01 (todas), Q01-guardar, vazio-H02 | todos |

**O que se vê:** `H01-S__phone__light.png` "Como o valor é calculado", `Q01-despesa__phone__light.png` "Novo lançamento" e `Q01-guardar__phone__light.png` "Guardar na reserva" em 22 px peso 500, como corpo de texto grande, enquanto os títulos de tela (`ON07` "Cartões de crédito", TopBar) são 800. `vazio-H02__phone__light.png`: "Nenhum aviso" no mesmo peso do texto abaixo.
**O que a spec pede:** UX §4.0 (Nunito 500–800 com escala coerente); UX §5.25 (título do EmptyState `<h2>` 18 px, destacado do texto 16 px).
**Causa provável:** o preflight do Tailwind zera `font-weight` de `h1`–`h6` (`inherit`), e `.sheet-title` (`apps/web/src/ui/ui.css:768-772`) e `.empty h2` (`apps/web/src/ui/ui.css:520-523`) não definem peso.
**Correção sugerida:** `font-weight: var(--font-weight-bold)` nos dois seletores (e `line-height: var(--line-height-snug)`).

### UXA-008 — O Q01 abre com foco no seletor Despesa, não no valor
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Interação / acessibilidade | Q01-despesa, Q01-despesa-valor, Q01-receita | todos |

**O que se vê:** `Q01-despesa-valor__desktop__light.png`: o roteiro digitou "4590" logo após abrir e o valor continua "R$ 0,00". `Q01-receita__phone__light.png`: "Receita" está em lima e "Despesa" tem um anel preto de 2 px (no escuro, `Q01-receita__phone__dark.png`, anel lima): parecem duas opções marcadas. O anel é o foco visível no primeiro rádio.
**O que a spec pede:** UX §3 Q01 "Abre com foco no valor… Em `lg`, aceita teclado físico: dígitos, `Backspace`, `Enter` = Lançar".
**Causa provável:** `apps/web/src/ui/BottomSheet.tsx:84-88` — ao abrir, a folha foca o primeiro elemento focável de `.sheet-body` (o rádio "Despesa" do `SegmentedControl`, `apps/web/src/features/quick-entry/QuickEntrySheet.tsx:563-571`) e desfaz o `autoFocus` do `AmountInput` (`QuickEntrySheet.tsx:573`). O Q01 não passa `initialFocus`.
**Correção sugerida:** passar `initialFocus={() => amountRef.current}` ao `BottomSheet` do Q01 (o `AmountInput` precisa expor a ref do `<input>`).

### UXA-009 — SegmentedControl marca a opção escolhida só pela cor
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Acessibilidade / fidelidade ao visual | Q01-receita, Q01-mais-detalhes (e todo uso de `SegmentedControl`) | todos |

**O que se vê:** `Q01-mais-detalhes__phone__light.png` e `Q01-receita__phone__light.png`: a opção escolhida é só um fundo lima, sem contorno preto nem check. Em `Q01-despesa__phone__light.png` o contorno preto que aparece em "Despesa" é o anel de foco (UXA-008), não a seleção.
**O que a spec pede:** UX §4.0 "Seleção (chips, segmentado, aba): fundo lima com texto preto **e** contorno preto de 2 px ou ícone de check, para não depender só da cor"; a lima tem 1,4:1 sobre branco (§4.0 Contraste).
**Causa provável:** `apps/web/src/ui/ui.css:429-433` — `.segmented label[data-checked="true"]` só troca fundo, cor e sombra.
**Correção sugerida:** acrescentar `box-shadow: inset 0 0 0 2px var(--ink-950)` (ou um `Check` de 16 px antes do rótulo), como já fazem `.chip[data-selected="true"]` (`ui.css:630-634`) e `.list-chip`.

### UXA-010 — Cabeçalho da folha rola junto e o "Fechar" some
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / acessibilidade | Q01-mais-detalhes (toda folha longa) | small, phone |

**O que se vê:** `Q01-mais-detalhes__phone__light.png`: depois de abrir "Mais detalhes" a folha rolou; a alça sumiu e o título "Novo lançamento" e o X aparecem cortados no topo. Rolando mais, o botão Fechar sai da tela.
**O que a spec pede:** UX §3 Q01 e §5.20 "botão **Fechar** (`X`) visível no topo da sheet (WCAG 2.5.1)".
**Causa provável:** `apps/web/src/ui/ui.css:726-737` — a `.sheet` inteira tem `overflow-y: auto`, e `.sheet-head` (`ui.css:762-767`) não é fixo.
**Correção sugerida:** `.sheet-head { position: sticky; top: calc(-1 * var(--space-3)); background: inherit; z-index: 1 }` (com a alça dentro dele), ou rolar só `.sheet-body`.

### UXA-011 — Chips de data não mostram qual está escolhido
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / estados | Q01-mais-detalhes | todos |

**O que se vê:** `Q01-mais-detalhes__desktop__light.png`: a data é hoje (11/11/2026 no campo "Escolher"), mas "Hoje" e "Ontem" aparecem iguais, brancos, sem seleção.
**O que a spec pede:** UX §5.13 `DateChip` (Hoje / Ontem / escolher) e §4.0 (seleção em lima com contorno).
**Causa provável:** `apps/web/src/ui/DateChip.tsx:33` e `:42` marcam `aria-pressed`, mas o CSS de seleção só olha `data-selected` (`apps/web/src/ui/ui.css:630-634`); não há regra para `.chip[aria-pressed="true"]`.
**Correção sugerida:** estender o seletor para `.chip:is([data-selected="true"], [aria-pressed="true"])`.

### UXA-012 — Subtelas sem botão Voltar no TopBar
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Navegação / moldura | H02, vazio-H02 (e as demais subtelas) | todos |

**O que se vê:** `H02__phone__light.png`: "Central de avisos" sem seta de voltar; a aba ativa continua "Início". No iPhone instalado não há botão Voltar do navegador; a saída é adivinhar que a aba Início volta.
**O que a spec pede:** UX §5.33 TopBar com `leading` (voltar `CaretLeft` com rótulo "Voltar").
**Causa provável:** `apps/web/src/app/AppShell.tsx:145-155` nunca passa `onBack` ao `TopBar` (`apps/web/src/ui/Bars.tsx:38-42` já sabe desenhar o botão).
**Correção sugerida:** passar `onBack={() => navigate(-1)}` (com destino padrão da tela-mãe quando não há histórico) para telas que não são raiz de aba; marcar as raízes (H01, T01, C01, P01…) no `screens.ts`.

### UXA-013 — Wordmark desenhada em fonte do sistema, não em Nunito
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Fidelidade ao visual (marca) | ON01, ON03, barra lateral do `lg` (H01, H02, Q01), abertura | todos |

**O que se vê:** `ON01__phone__light.png` e `ON03__phone__light.png`: "OakFinance" num grotesco reto (sem os terminais arredondados da Nunito do resto da tela). O mesmo na barra lateral de `H01__desktop__light.png`.
**O que a spec pede:** UX §4.0 Marca: "Oak"/"Finance" em Nunito 800.
**Causa provável:** `apps/web/src/ui/BrandLogo.tsx:86-88` — `fontFamily: 'Manrope Variable, Manrope, Inter, system-ui, sans-serif'` e `fontWeight: 700`; a Manrope não é mais carregada, então cai no `system-ui`. As constantes `COLORS` (`BrandLogo.tsx:50-63`) e os degradês do monograma e do favicon (`:154-216`) ainda são os azuis do Aero e aparecem quando `theme` não é `auto` ou a altura cai abaixo de 22 px.
**Correção sugerida:** trocar para `var(--font-display)` com peso 800 e ajustar o `letterSpacing`; atualizar `COLORS` para os tokens de marca (`--brand-oak`/`--brand-finance`) e redesenhar monograma/favicon como quadrado preto com "OF" lima (§4.0).

### UXA-014 — ON01 no escuro: "Começar" some (lima sobre lima)
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tema escuro | ON01 | phone dark |

**O que se vê:** `ON01__phone__dark.png`, canto inferior direito: o botão "Começar" é uma pílula lima sobre a tela lima, separada só pela sombra.
**O que a spec pede:** UX §4.0 Telas de referência: ON01 com "Começar" em pílula preta com seta; WCAG 1.4.11.
**Causa provável:** `apps/web/src/app/shell.css:140-153` força o fundo lima no ON01 nos dois temas, mas não redefine `--grad-primary`/`--text-on-primary`; no escuro o primário vira lima (`apps/web/src/styles/tokens.css:321`, aplicado em `apps/web/src/ui/ui.css:50-53`).
**Correção sugerida:** em `.screen-welcome`, fixar `--grad-primary: var(--ink-950)` e `--text-on-primary: var(--white)` (o ON01 é lima nos dois temas).

### UXA-015 — Guia de instalação sem números nos passos
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / hierarquia | ON02a, ON02b, ON02c | todos |

**O que se vê:** `ON02c__phone__light.png`: "Clique no ícone de instalação…" recuado 20 px sem marcador. Nas variantes de 2–3 passos (Chrome, Safari iOS 17/26) os passos aparecem como parágrafos soltos e recuados, sem "1, 2, 3", embora sejam uma sequência.
**O que a spec pede:** UX §3 ON02a/ON02b (passos 1, 2, 3 em `<ol>`); §5.27 InstallGuide.
**Causa provável:** o preflight do Tailwind põe `list-style: none` em `ol`; `.install-steps` (`apps/web/src/ui/ui.css:1199-1204`) mantém só o `padding-left`.
**Correção sugerida:** `list-style: decimal` (ou contador próprio em círculo preto de 24 px, como os ícones do ON01) em `.install-steps`, e esconder o número quando houver um só passo.

### UXA-016 — Campo de valor compacto sem moldura de campo
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / consistência | ON05, ON06 (saldo atual), ON07 (limite), ON07b | todos |

**O que se vê:** `ON05__phone__light.png`: "Salário ou renda fixa" e, bem à direita e abaixo, "R$ 0,00" em cinza, sem caixa; logo abaixo, "Dia do crédito" e "Conta de crédito" são campos brancos com borda. O valor parece texto fixo, não campo. O mesmo em `ON07__phone__light.png` (Limite) e `ON07b__phone__light.png`.
**O que a spec pede:** UX §4.0 Forma: "campos com raio 16 px e borda 1 px `--border-strong`"; UX §5.8 `AmountInput` compacto.
**Causa provável:** `apps/web/src/ui/ui.css:570-585` — `.amount-input` tem `border: 0; background: transparent` também no `data-size="compact"`.
**Correção sugerida:** em `.amount[data-size="compact"] .amount-input`, aplicar o mesmo visual do `TextField` (fundo `--surface-solid-1`, borda 1 px `--border-strong`, raio `--radius-sm`, `padding: 0 var(--space-4)`), mantendo o alinhamento à direita.

### UXA-017 — Card Reserva sem meta não diz nada e "Guardar" não parece botão
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / componentes | H01, vazio-H01 | todos |

**O que se vê:** `H01__phone__light__pagina.png`, card "Reserva de emergência": só um trilho tracejado com três marcas e a palavra "Guardar" solta à esquerda. Não diz quanto há guardado nem que falta definir a meta. "Guardar" é uma pílula branca sobre card branco, sem forma visível. O link do cabeçalho diz "Ver todos" (é uma reserva só).
**O que a spec pede:** UX §3 H01 item 5 ("R$ 3.400 de R$ 13.500 · 25%" + botão **Guardar** → Q01 em modo Guardar); UX §5.17 (sem meta: trilho tracejado e "Defina uma meta"); D-043 (o card do Início abre o modo Guardar); UX §6.2 regra 3 (vazio diz o que fazer).
**Causa provável:** `apps/web/src/features/dashboard/HomeCards.tsx:156` passa `showLabel={false}` e esconde o "Defina uma meta" do `GoalProgress`; o valor guardado só aparece com meta (`:158-168`); `.home-pill-link` usa `--surface-solid-2` (`apps/web/src/app/shell.css:710-723`), branco no card branco; o botão vai para `/planejar/reserva` (`HomeCards.tsx:170`), regra provisória da D-041 que a D-043 substituiu; o cabeçalho usa `home.seeAll` (`HomeCards.tsx:148`).
**Correção sugerida:** mostrar sempre "Guardado {valor}" e, sem meta, "Defina uma meta" (link para P02); trocar o "Guardar" para `data-tone="accent"` (pílula lima) apontando para `?novo=guardar`; no cabeçalho, "Ver reserva".

### UXA-018 — Herói do Início: botão "Novo lançamento" quebra e disputa com o rótulo
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Hierarquia (P4) | H01, vazio-H01 | small, phone; desktop (duplicado) |

**O que se vê:** `H01__small__light.png`: o rótulo ocupa três linhas à esquerda e "Novo lançamento" duas linhas à direita; o valor fica empurrado para baixo e o bloco do topo pesa mais que o número. O valor usa 32 px (token de AmountInput), menor que o token de herói. Em `H01__desktop__light.png` há dois "Novo lançamento" na mesma vista (barra lateral preta e herói lima), além do FAB no celular e do atalho "Despesa".
**O que a spec pede:** UX §1 P4 (um dominante, a resposta primeiro); UX §3 H01 (rótulo em `--font-size-label` secundário, valor em `--font-size-hero`).
**Causa provável:** `apps/web/src/app/shell.css:576-590` (`.home-card-new` sem `white-space: nowrap`, ao lado do rótulo no mesmo `flex`), `:570-575` (rótulo em negrito e branco pleno) e `:605-611` (`.home-card-value` com `--font-size-display`); `apps/web/src/app/AppShell.tsx:133-135` (botão da barra lateral).
**Correção sugerida:** rótulo em `--on-dark-muted` peso 600; valor com `--font-size-hero`; no `sm`, trocar o botão por um `IconButton` lima de 48 px com rótulo acessível "Novo lançamento" (o texto completo cabe no `lg`); no `lg`, esconder o do herói, já que a barra lateral tem o mesmo comando.

### UXA-019 — Título do TopBar fora do centro
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout / moldura | H01, H02, Q01 (fundo) e todas as telas com TopBar | todos |

**O que se vê:** `H01__phone__light.png`: "Início" centrado no espaço que sobra à esquerda dos três ícones (x ≈ 120 px de 390). Em `H02__phone__light.png`, com um ícone só, o título fica em outra posição. Em `H01__desktop__light.png` também está deslocado.
**O que a spec pede:** UX §4.0 Moldura: "TopBar… título centralizado em 17 px negrito".
**Causa provável:** `apps/web/src/ui/ui.css:1116-1123` — `.topbar-title { flex: 1; text-align: center }` centra dentro da sobra, e o lado esquerdo não tem um espaçador do tamanho do `trailing`.
**Correção sugerida:** `.topbar { display: grid; grid-template-columns: 1fr auto 1fr }` com o título na coluna do meio e `trailing` alinhado à direita.

### UXA-020 — SyncBadge como bolha branca, diferente dos ícones vizinhos
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes / moldura | H01, H02, Q01 (fundo) | todos |

**O que se vê:** `H01__phone__light.png`, canto superior direito: olho e sino são ícones soltos e o SyncBadge "Sincronizado" é um disco branco de 48 px com sombra. No escuro é um disco grafite. Fica com mais peso que a ação do olho, embora seja só status.
**O que a spec pede:** UX §5.24 (pílula discreta; `synced` some após 2 s); UX §4.0 (TopBar sem fundo próprio).
**Causa provável:** `apps/web/src/ui/SyncBadge.tsx:74` — o botão leva a classe `glass` (card branco com sombra, `apps/web/src/styles/base.css:8-23`).
**Correção sugerida:** tirar `glass` no estado `synced` (ícone simples como os vizinhos) e usar a pílula branca só em `pending`/`offline`/`error`, quando há texto. *A confirmar:* se o disco continua depois de 2 s (a captura pode ter sido feita antes).

### UXA-021 — Atalhos do Início apertados a 360 px
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout | H01, vazio-H01 | small, phone |

**O que se vê:** `H01__small__light.png`: "Lançamentos" encosta nas bordas da pílula (sem respiro) e "Contas e cartões" quebra em duas linhas, o que deixa as quatro pílulas com rótulos desalinhados.
**O que a spec pede:** UX §4.0 Telas de referência (quatro atalhos em pílula); critério de layout da auditoria (texto sem vazar).
**Causa provável:** `apps/web/src/app/shell.css:626-645` — grade de 4 colunas iguais com `padding: var(--space-2) var(--space-1)` e rótulo de 13 px negrito.
**Correção sugerida:** no `sm`, rótulos curtos via texto próprio ("Contas" no atalho, mantendo o `aria-label` completo) ou grade 2×2 abaixo de 380 px.

### UXA-022 — "Ver todos" em cards que não são listas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy | H01, vazio-H01 | todos |

**O que se vê:** `vazio-H01__phone__light__pagina.png`: "Orçamento 50/30/20 · Ver todos" e "Reserva de emergência · Ver todos".
**O que a spec pede:** UX §6.2 regra 1 e skill de escrita (o rótulo diz o que acontece).
**Causa provável:** `apps/web/src/features/dashboard/HomeCards.tsx:107` e `:148` reutilizam `home.seeAll` (`apps/web/src/i18n/pt-BR.ts:534`, "Ver todos", feito para os lançamentos).
**Correção sugerida:** textos próprios ("Ver orçamento", "Ver reserva") no bloco do Início da UX §6.4.

### UXA-023 — Início vazio repete o vazio e mostra "R$ 0,00" sem necessidade
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Estados vazios | vazio-H01 | todos |

**O que se vê:** `vazio-H01__phone__light__pagina.png`: card "Nenhum lançamento em novembro" com **Novo lançamento** e, no fim, "Últimos lançamentos" com "Nenhum lançamento em novembro 2026" (mesma informação, com o ano num e não no outro). No herói, "No cartão para os próximos meses: R$ 0,00" aparece com zero. O herói sem renda também mostra "Novo lançamento", e o card vazio repete o mesmo botão.
**O que a spec pede:** UX §3 H01 Estados ("Sem lançamentos no mês: herói normal + card…"); UX §6.5; P4 (só o que responde).
**Causa provável:** `apps/web/src/features/dashboard/HomeOverview.tsx:242-255` e `:274-276` (dois vazios com textos diferentes); `:212-217` mostra a linha do cartão sem conferir `futureCardCents > 0`.
**Correção sugerida:** esconder a seção "Últimos lançamentos" quando o card vazio do mês aparece; mostrar a linha "No cartão…" só com valor > 0.

### UXA-024 — Linha de lançamento: selo "Conferir" sem forma de selo
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes | H01 (Últimos lançamentos; o mesmo `TransactionRow` da T01) | todos |

**O que se vê:** `H01__phone__light__pagina.png`, lista final: "Conferir" aparece como uma quarta linha de texto cinza, igual aos metadados; a linha fica com 4 linhas de altura e o valor flutua no meio.
**O que a spec pede:** UX §5.19 (selos sempre com texto) e §5.34 Badge (pílula de 24 px, ícone + texto).
**Causa provável:** `apps/web/src/ui/ui.css:1057-1063` — `.tx-seal` é só texto 13 px secundário, sem fundo nem ícone (`apps/web/src/ui/TransactionRow.tsx:115`).
**Correção sugerida:** desenhar o selo com o `Badge` (tom info, ícone `Inbox`) e limitar o título a 2 linhas com reticências (`-webkit-line-clamp: 2`).

### UXA-025 — "Ver cálculo": sinal solto do valor e coluna do total desalinhada
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tipografia / dinheiro | H01-S | todos |

**O que se vê:** `H01-S__phone__light.png`: "+ R$ 0,00", "– R$ 1.919,60" com espaço entre o sinal e o "R$", diferente de "−R$ 150,00" nas linhas de lançamento do mesmo Início. O total "R$ 3.896,40" termina na borda direita, enquanto os valores das linhas terminam antes do chevron. As linhas ficam direto sobre a menta, sem card.
**O que a spec pede:** UX §0.1 (`−R$ 45,00`, sinal U+2212 sem espaço); UX §4.0 ("Sheets… com fundo menta e cards brancos por cima").
**Causa provável:** `apps/web/src/features/dashboard/FormulaSheet.tsx:92-93` monta `${sinal} ${formatBRL(...)}` com espaço; o total não reserva a coluna do chevron.
**Correção sugerida:** `${sinal}${formatBRL(...)}` sem espaço; reservar 24 px à direita do total (ou mostrar o chevron vazio); envolver as linhas num `.glass`.

### UXA-026 — No escuro, o cartão do mês não se separa do fundo
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tema escuro | H01, vazio-H01, H01-S | phone dark |

**O que se vê:** `H01__phone__dark.png`: o cartão preto (#000) sobre o fundo grafite (#0B0D0A) quase não tem borda visível; o herói vira texto solto no fundo.
**O que a spec pede:** critério 10 da auditoria (cards sem separação do fundo); UX §4.0 (o valor `#000000` para `--surface-dark` no escuro vem da própria spec, ver lacunas).
**Causa provável:** `apps/web/src/styles/tokens.css:274` (`--surface-dark: #000000`) com `--bg-base: var(--ink-950)` (`:267`).
**Correção sugerida:** no escuro, cartão em `--ink-850` com borda 1 px `--border-subtle`, ou fundo do cartão em lima-escuro; decisão do dono, porque muda um valor da §4.0.

### UXA-027 — Q01: "Mais" sem forma de chip, valor alinhado à direita e grupo de categorias com rótulo errado
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes / acessibilidade | Q01-despesa, Q01-receita | todos |

**O que se vê:** `Q01-despesa__phone__light.png`: depois de cinco chips brancos, "Mais" é só texto em negrito, sem a forma do chip. O valor "R$ 0,00" está colado à direita, não centrado.
**O que a spec pede:** UX §3 Q01 itens 2 e 3 ("`AmountInput` grande, centralizado"; "5 `CategoryChip` + chip **Mais**"); Acessibilidade: chips em `role="radiogroup"` com `aria-label="Categoria"`.
**Causa provável:** `apps/web/src/features/quick-entry/QuickEntrySheet.tsx:629-631` usa `Button variant="ghost"`; `apps/web/src/ui/ui.css:580` `text-align: right` também no `display`; `QuickEntrySheet.tsx:609` rotula o grupo com `t('quick.type.expense')` ("Despesa").
**Correção sugerida:** "Mais" como `.chip` com ícone `ChevronDown`; `.amount[data-size="display"] .amount-input { text-align: center }`; `aria-label` "Categoria".

### UXA-028 — Toast pode cobrir a barra de abas (a confirmar)
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Moldura | H01, Q01 (confirmação "Desfazer") | small, phone |

**O que se vê:** sem captura de toast. Pelo código, a região dos toasts fica a 64 px do fundo, e a barra flutuante ocupa de 12 px a 76 px: os 12 px de baixo do toast caem sobre a barra.
**O que a spec pede:** UX §5.22 "Posição: acima da TabBar".
**Causa provável:** `apps/web/src/ui/ui.css:553-560` (`bottom: calc(var(--space-16) + env(safe-area-inset-bottom))`) contra `.tabbar` (`ui.css:1124-1141`, 12 px + 64 px).
**Correção sugerida:** `bottom: calc(64px + var(--space-3) + var(--space-3) + env(safe-area-inset-bottom))` abaixo de 1024 px; `var(--space-6)` no `lg`.

### UXA-029 — Onboarding centrado na vertical: o cabeçalho de passos pula
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout / ergonomia (P2) | ON02a, ON02b, ON02c, ON03, ON04–ON08 | small, phone |

**O que se vê:** "Passo n de 5" fica a 230 px no ON04, 270 px no ON05, 445 px no ON06, 65 px no ON07 e 440 px no ON07b (`ON0x__phone__light.png`): a barra de progresso muda de lugar a cada passo. Em ON02x/ON03/ON08 o conteúdo fica no meio e o terço de baixo vazio, com as ações longe do polegar. No ON04 o ícone do sino vem depois do título; no ON08 o ícone vem antes.
**O que a spec pede:** UX §1 P2 (ações no terço inferior); UX §3 ON04 (ícone, depois título) e ON08.
**Causa provável:** `apps/web/src/app/shell.css:198-207` — `.onboarding { align-content: center }`; `apps/web/src/features/onboarding/RemindersStep.tsx:141-143` põe o ícone no corpo, depois do `<h1>` do `OnbFrame`.
**Correção sugerida:** `align-content: start` com o cabeçalho de passos sempre no topo e `.onb-actions` empurrado para baixo (`margin-top: auto` numa coluna `min-height: 100dvh`); passar o ícone ao `OnbFrame` para desenhá-lo antes do título.

### UXA-030 — Títulos de tela com entrelinha de corpo
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tipografia | ON04 (e todo `.screen-title` em duas linhas) | small, phone |

**O que se vê:** `ON04__phone__light.png`: "Lembretes de vencimentos e / orçamento" com 33 px entre as linhas de um título de 22 px; parecem dois títulos.
**O que a spec pede:** UX §4.0 / tokens (`--line-height-tight` 1,15 e `--line-height-snug` 1,3 para títulos).
**Causa provável:** `apps/web/src/app/shell.css:130-135` — `.screen-title` herda `line-height: 1.5` do `body`.
**Correção sugerida:** `line-height: var(--line-height-snug)` em `.screen-title`.

### UXA-031 — ON07: sugestão "Nubank" parece valor preenchido e as saídas se repetem
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / formulário | ON07 | todos |

**O que se vê:** `ON07__phone__light.png`: o campo "Nome do cartão" mostra "Nubank" em cinza (placeholder), que lembra um valor já escrito. No rodapé, "Continuar", "Não uso cartão de crédito" (pílula branca) e "Pular" empilhados; as duas últimas levam quase ao mesmo lugar.
**O que a spec pede:** UX §3 ON07 (sugestões "Nubank", "Ourocard"; link "Não uso cartão de crédito").
**Causa provável:** `apps/web/src/features/onboarding/CardsStep.tsx:131` (`placeholder="Nubank"`); `OnbFrame` sempre acrescenta "Pular" (`apps/web/src/features/onboarding/OnbFrame.tsx:73-75`).
**Correção sugerida:** sugestões como chips abaixo do campo ("Nubank", "Ourocard") e placeholder vazio; no ON07, "Não uso cartão de crédito" como link fantasma no lugar do "Pular".

### UXA-032 — ON01: "Já uso em outro aparelho" quebra em duas linhas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout | ON01 | small, phone |

**O que se vê:** `ON01__phone__light.png`, rodapé: "Já uso em outro / aparelho" centralizado em duas linhas ao lado de "Começar".
**O que a spec pede:** UX §4.0 Telas de referência (ON01: o link à esquerda e "Começar" à direita, na mesma linha).
**Causa provável:** `apps/web/src/app/shell.css:175-184` — `.welcome-actions` em `flex` com `space-between` e o botão fantasma sem `white-space: nowrap`; o `.btn` centraliza o texto.
**Correção sugerida:** `white-space: nowrap` e `text-align: left` no fantasma; abaixo de 380 px, empilhar ("Começar" em largura total e o link embaixo).

## Contradições e lacunas na spec

- **Rótulo das abas:** UX §4.0 fixa "rótulo de 11 px" na barra flutuante (`apps/web/src/ui/ui.css:1160-1164` segue isso), mas a §5.33 diz 13 px e o critério de acessibilidade da auditoria pede nada abaixo de 13 px. O dono decide qual vale.
- **Datas nas linhas:** a §0.1 pede datas relativas ("hoje", "ontem", "7 nov"); o checklist da auditoria e a D-045 usam `dd/mm/aaaa`. O Início mostra "11/11/2026" nas linhas de lançamento e "Hoje" nos avisos.
- **Escuro:** a §4.0 define `--surface-dark` = `#000000` sobre fundo `#0B0D0A`, o que tira a separação do cartão do mês (UXA-026).
- **Q01:** a §3 Q01 ainda descreve o seletor "Despesa | Receita | Guardar" e o teclado "no terço inferior", enquanto a D-043 fez do Guardar uma folha própria (`Q01-guardar`) e o `AmountInput` da §5.8 inclui o teclado no componente. A spec não diz onde o teclado fica quando está embutido no campo.
- **ON01:** a §3 põe o logo "no terço superior"; a §4.0 (referência D-023) descreve tela lima com o bloco embaixo. O app segue a §4.0.
- **ON02a/b/c:** o título vem do parâmetro `?p=` e os passos vêm do user agent (`apps/web/src/features/onboarding/InstallScreen.tsx:28-29` e `:43-54`). Nas capturas (navegador de computador), "Instale o OakFinance no Android/iPhone" mostra o passo do computador. Em aparelho real os dois coincidem; a spec não diz o que mostrar quando divergem (ex.: `/instalar?p=ios` aberto de outro aparelho). Fica como dúvida, não como defeito.
- **H01:** a §3 H01 pede rótulo secundário e valor no token de herói; a D-023/D-041 trouxe o botão "Novo lançamento" para dentro do cartão e não diz a hierarquia entre os dois (UXA-018).
- **§5.20, §5.22 e §5.23** ainda falam de "vidro nível 3" em folha, toast e banner; a §4.0 manda ler como menta e branco.

## O que está bom

- Paleta, Nunito, pílulas, barra de abas preta flutuante com aba ativa em lima e FAB central seguem a D-023 em todas as telas; não sobrou vidro nem desfoque.
- "Disponível para gastar" aparece sem rolar em 360×640, com selo "No ritmo do mês" em texto e ícone.
- Despesa em cor neutra com "−" (U+2212) nas linhas; textos sem "!" nem emoji; os textos da §6.4 batem nas telas revisadas.
- Movimento contido: só giro e pulso em carregamento, transições de 100–250 ms, e regra global para movimento reduzido (`apps/web/src/styles/tokens.css:369-393`).
- Nenhuma rolagem horizontal em nenhuma captura deste escopo (manifest).
