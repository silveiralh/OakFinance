# Auditoria de UX — 12/11/2026 (parte A: moldura, Início, onboarding e lançamento rápido)

Escopo: moldura (TopBar, barra de abas, barra lateral do `lg`, avatar do menu da conta); ON01, ON02a, ON02b, ON02c, ON03, ON04, ON05, ON06, ON07, ON07b, ON08; H01, H01-S, H02, `vazio-H01`, `vazio-H02`; Q01-despesa, Q01-despesa-valor, Q01-mais-detalhes, Q01-categorias, Q01-receita, Q01-guardar · tamanhos `small` 360×640, `phone` 390×844 (claro e escuro), `tablet` 768×1024 e `desktop` 1280×800 · capturas: `scratchpad/audit` (manifest de 12/11/2026, 17:47 UTC) · commit: cb65667 · segunda rodada (a primeira é `partes/a-inicio-onboarding.md`, IDs UXA-…).

Observações do roteiro (não são achados):
- **H01-S** não abriu em nenhum tamanho (`note`: tempo esgotado procurando "Ver cálculo"). Isso confirma que a folha saiu do Início (D-081); as capturas `H01-S__*` são o H01.
- **Q01-receita** mostra o modo Despesa com "R$ 45,90" e o toast "Rascunho recuperado.": o rascunho da captura anterior foi restaurado por cima do modo pedido na URL. O comportamento é do app (ver UX2A-002), mas por isso o modo Receita do Q01 não pôde ser revisado nesta rodada.
- O **menu da conta** (folha "Sua conta") não tem captura; o avatar aparece no TopBar das raízes. Revisado só pelo código (`apps/web/src/app/AccountMenu.tsx`).
- "Conexões" na barra lateral do `desktop` e o formulário "Entrar (teste)" no ON03 existem só no build E2E (`VITE_OPEN_FINANCE`, `VITE_E2E`, D-087).
- O aviso do H02 ("vence em 3 dias", "até 10/11") é texto fixo do roteiro (`ux-audit/capture.mjs:319`).
- Nenhuma captura deste escopo teve rolagem horizontal nem erro de console.

## Resumo

| Severidade | Achados novos |
|---|---|
| S1 — Bloqueia ou engana | 1 |
| S2 — Visivelmente errado | 7 |
| S3 — Polimento | 6 |

Revalidação da primeira rodada (32 achados UXA da parte A): **21 resolvidos, 7 parciais, 4 abertos** (tabela abaixo).

Os 5 que mais melhoram o app se corrigidos primeiro:
1. UX2A-001 — No Q01 a 360×640 o rodapé fixo (teclado e Lançar) cobre o campo de valor: a pessoa digita sem ver o número.
2. UX2A-002 — Tocar em "Receita" abre o Q01 em Despesa quando há um rascunho guardado.
3. UXA-004 (aberto) — "Gasto Em Novembro" em Title Case no herói, em todos os tamanhos.
4. UX2A-004 — "Últimos lançamentos" mostra "12/11/2026" (e "12/11/20…") para lançamentos de hoje, contra a D-084.
5. UX2A-003 — Link "Ajustar percentuais" branco sobre branco dentro do card "Saúde do mês", deixando um vão vazio.

## Revalidação dos achados UXA da primeira rodada

| ID | Situação | Evidência |
|---|---|---|
| UXA-001 Sem caminho para Configurações no celular | Resolvido | Avatar no TopBar das raízes (`H01__phone__light.png`, canto direito); `app/AccountMenu.tsx:55-73` |
| UXA-002 Valor "No cartão…" partido | Resolvido (removido) | A linha saiu do herói pela D-081 (`H01__small__light.png`) |
| UXA-003 "Lançar" e categorias abaixo da dobra no Q01 | Parcial | Rodapé fixo com teclado e Lançar existe (`shell.css:1949`), mas a 360×640 ele cobre o valor e a 390 cobre a 5ª categoria, "Mais", o meio e "Mais detalhes": ver UX2A-001 |
| UXA-004 Rótulo do herói em Title Case | **Aberto** | "Gasto Em Novembro" em `H01__*` e `vazio-H01__*`; `apps/web/src/app/shell.css:759` mantém `text-transform: capitalize` em `.home-card-month`, e o texto vem de `home.spent.label` "Gasto em {mês}" (`pt-BR.ts:943`) |
| UXA-005 Anel 50/30/20 com moldura quadrada | Resolvido | O card saiu do Início (D-081); a classe virou `.budget-ring` (D-088) |
| UXA-006 Preenchimento "info" preto no escuro | Resolvido | Barra de passos lima em `ON06__phone__dark.png` |
| UXA-007 Títulos de folha e de vazio em peso normal | Resolvido | "Novo lançamento" e "Nenhum aviso" em negrito (`Q01-despesa__phone__light.png`, `vazio-H02__phone__dark.png`) |
| UXA-008 Q01 abre com foco no seletor | Resolvido | "4590" digitado logo ao abrir vira "R$ 45,90" (`Q01-despesa-valor__desktop__light.png`); `QuickEntrySheet.tsx:550` |
| UXA-009 Segmentado marcado só pela cor | Resolvido | Contorno de 2 px em "Despesa", claro e escuro (`Q01-despesa__phone__light.png`, `Q01-receita__phone__dark.png`) |
| UXA-010 Cabeçalho da folha rola junto | Resolvido | Título e X fixos depois de rolar (`Q01-mais-detalhes__phone__light.png`) |
| UXA-011 Chips de data sem seleção | Resolvido | "Hoje" em lima com contorno (`Q01-mais-detalhes__desktop__light.png`) |
| UXA-012 Subtelas sem Voltar | Resolvido | Seta de voltar no H02 (`H02__phone__light.png`) |
| UXA-013 Wordmark fora da Nunito | Parcial (conhecido) | Cores e monograma corrigidos; a fonte aguarda o dono (D-103). Sem piora |
| UXA-014 "Começar" lima sobre lima no escuro | Resolvido | Pílula preta (`ON01__phone__dark.png`) |
| UXA-015 Passos de instalação sem número | Resolvido (pelo código) | `ui.css:1290-1301` (`list-style: decimal`, some com um passo só); as capturas só têm a variante de um passo |
| UXA-016 Valor compacto sem moldura | Resolvido | `ON05__phone__light.png`, `ON07b__phone__light.png` |
| UXA-017 Card Reserva mudo e "Guardar" sem forma | **Aberto** | `H01__phone__light__pagina.png`: só o trilho tracejado e "Guardar" branco sobre card branco; `HomeCards.tsx:239` (`showLabel={false}`), `:241` (valor só com meta), `:253` (vai para `/planejar/reserva`, não `?novo=guardar`; sem `data-tone="accent"`), `:231` ("Ver todos") |
| UXA-018 Botão "Novo lançamento" do herói quebra e disputa | **Aberto** | Duas linhas em `H01__phone__light.png` e `H01__small__light.png`; dois "Novo lançamento" no `desktop`; `shell.css:761-775` sem `white-space: nowrap` |
| UXA-019 Título do TopBar fora do centro | Parcial | Centrado no `tablet`, no `desktop` e nas subtelas (`H02`); nas raízes do celular, com olho, sino, nuvem e avatar, "Início" fica em x ≈ 136 de 390 (`H01__phone__light.png`): `ui.css:1185` usa `minmax(48px, 1fr)` e o mínimo da coluna direita (4 ícones ≈ 204 px) desequilibra as laterais |
| UXA-020 SyncBadge como bolha branca | Resolvido | Só o ícone (`ui.css:1322-1333`) |
| UXA-021 Atalhos apertados a 360 px | **Aberto** | "Lançamentos" encosta nas bordas da pílula a 360 e a 390; "Contas e cartões" em duas linhas (`H01__small__light.png`); `shell.css:815-829` sem mudança |
| UXA-022 "Ver todos" em cards que não são lista | Parcial | O card do orçamento saiu; a Reserva continua com "Ver todos" (`HomeCards.tsx:231`) |
| UXA-023 Início vazio repete o vazio | Parcial | A linha do cartão saiu, mas "Nenhum lançamento em novembro" (card) e "Nenhum lançamento em novembro 2026" (Últimos lançamentos) continuam juntos, e o herói mostra "Ainda vai sair este mês: R$ 0,00" (`vazio-H01__phone__light__pagina.png`; `HomeOverview.tsx:163-167`, `:195-206`, `:227-229`) |
| UXA-024 Selo "Conferir" sem forma | Resolvido | Selo em pílula lima; título numa linha com reticências (`H01__phone__light__pagina.png`) |
| UXA-025 "Ver cálculo" com sinal solto | Resolvido (removido) | H01-S saiu (D-081) |
| UXA-026 Cartão do mês sem separação no escuro | Resolvido | Cartão em grafite elevado (`H01__phone__dark.png`) |
| UXA-027 "Mais" sem forma de chip, valor à direita | Resolvido | `Q01-mais-detalhes__phone__light.png` |
| UXA-028 Toast sobre a barra de abas | Resolvido (pelo código) | `ui.css:595` |
| UXA-029 Onboarding centrado, cabeçalho pula | Parcial | ON04–ON08 com cabeçalho fixo no topo e ações embaixo; ON02a/b/c e ON03 deixam a ação no meio da tela e dois terços vazios abaixo (`ON02b__phone__light.png`, `ON03__phone__light.png`) |
| UXA-030 Títulos com entrelinha de corpo | Resolvido | `ON04__phone__light.png` |
| UXA-031 ON07 placeholder e saídas repetidas | Parcial (aceito) | Chips no lugar do placeholder; "Pular" fica pelo US-08 (D-103) |
| UXA-032 "Já uso em outro aparelho" quebra | Resolvido | Uma linha a 390 e empilhado a 360 (`ON01__small__light.png`) |

## Achados novos

### UX2A-001 — Q01 a 360×640: o rodapé fixo cobre o campo de valor
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Ergonomia (P1, P2) / dinheiro | Q01-despesa, Q01-despesa-valor (e Q01-receita) | small (S1); phone (mesma causa, efeito menor) |

**O que se vê:** `Q01-despesa__small__light.png` e `Q01-despesa-valor__small__light.png`: abaixo do rótulo "Valor" começa o teclado; o campo "R$ 0,00" fica inteiro atrás do rodapé. Depois de digitar "4590" a tela é idêntica: a pessoa digita um valor de dinheiro sem vê-lo, e as categorias também ficam escondidas. A 390×844 (`Q01-despesa__phone__light.png`) o valor aparece, mas a 5ª categoria, o chip "Mais", o meio de pagamento e "Mais detalhes" ficam atrás do teclado, numa faixa de rolagem de cerca de 240 px.
**O que a spec pede:** UX §3 Q01 (valor, categorias, meio e Lançar com uma mão; ≤ 3 toques) e §1 P1/P2; critério S1 da auditoria (valor de dinheiro escondido na tela).
**Causa provável:** `apps/web/src/app/shell.css:1949-1958` — `.quick-footer` é `sticky` no fim da folha com o teclado de 4 linhas e o Lançar (≈ 330 px), sobre uma folha de ≈ 560 px a 640 px de altura; `apps/web/src/features/quick-entry/QuickEntrySheet.tsx:582-591` põe "Ler nota" numa linha própria e centrada (≈ 70 px) entre o segmentado e o valor; o valor (`:593-600`) fica na área que rola, por baixo do rodapé.
**Correção sugerida:** levar o valor para dentro do rodapé fixo, logo acima do teclado (o `AmountInput` já aceita `showKeypad={false}`), para ele estar sempre à vista enquanto se digita; passar "Ler nota" para um `IconButton` com rótulo na linha do segmentado ou no cabeçalho; em telas com menos de 700 px de altura, reduzir o espaço entre as teclas (mantendo 48 px de alvo). Conferir a 360×640 que valor, uma linha de categorias, teclado e Lançar aparecem sem rolar.

### UX2A-002 — "Receita" abre em Despesa quando há rascunho
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / interação | Q01-receita (atalho "Receita" do Início, `?novo=receita`) | todos |

**O que se vê:** `Q01-receita__desktop__light.png` e `Q01-receita__phone__dark.png`: aberto por `/?novo=receita`, o Q01 mostra "Despesa" marcado, "R$ 45,90" e o toast "Rascunho recuperado. Descartar". A pessoa tocou em Receita e recebe uma despesa de outra tentativa; se não reparar, lança uma despesa.
**O que a spec pede:** UX §3 Q01 (o modo vem de `?novo=despesa|receita|guardar`); rótulos e ações dizem o que acontece (§6.2).
**Causa provável:** `apps/web/src/features/quick-entry/QuickEntrySheet.tsx:204-216` — ao abrir, o rascunho guardado é aplicado sem comparar o modo: `setMode(draft.mode)` (`:209`) passa por cima do modo pedido.
**Correção sugerida:** restaurar o rascunho só quando `draft.mode` for igual ao modo pedido na URL; caso contrário, abrir limpo no modo pedido e manter o rascunho guardado.

### UX2A-003 — "Ajustar percentuais" invisível dentro do card "Saúde do mês"
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / layout | H01, vazio-H01 | todos (claro); no escuro o link aparece duplicado |

**O que se vê:** `H01__tablet__light.png` e `vazio-H01__phone__light__pagina.png`: o card termina com um vão branco de cerca de 60 px abaixo de "Poupança" (ou de "Cadastrar renda"). É o link "Ajustar percentuais", branco sobre branco. O mesmo link já está no cabeçalho da seção.
**O que a spec pede:** UX §3 H01 item 4 (um atalho "Ajustar percentuais"); §4.0 (nada que só funcione num tema); WCAG 1.4.3.
**Causa provável:** `apps/web/src/features/dashboard/HomeCards.tsx:206-209` reaproveita `home-card-link`, classe do herói escuro, que tem `color: var(--on-dark)` (`apps/web/src/app/shell.css:922-937`).
**Correção sugerida:** tirar o link de dentro do card (o do cabeçalho, `HomeCards.tsx:151-156`, basta).

### UX2A-004 — "Últimos lançamentos" com data completa para hoje, cortada a 390 px
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Microcopy / layout | H01 | small, phone; tablet e desktop sem corte |

**O que se vê:** `H01__phone__light__pagina.png`, lista final: "Débito · 12/11/2026" nos lançamentos de hoje (a captura é de 12/11/2026) e "Crédito · 3/6 · 12/11/20…" com a data cortada por reticências.
**O que a spec pede:** D-084 item 1 ("Hoje" e "Ontem" nas listas; demais datas completas); critério de layout (valor ou data não cortados).
**Causa provável:** `apps/web/src/features/transactions/TransactionsScreen.tsx:203` — `toRow` sempre usa `formatDateBR`; o Início chama `toRow` sem agrupar por dia (`apps/web/src/features/dashboard/HomeOverview.tsx:232-238`); a meta numa linha com reticências (`apps/web/src/app/shell.css:730-736`) corta o fim, que é a data.
**Correção sugerida:** usar o `relativeDay` (`HomeCards.tsx:20`) quando a linha não está num grupo de dia; pôr a data antes do meio na meta (ou parcela em linha própria) para que o corte caia no nome do meio, não na data.

### UX2A-005 — Folha "Guardar na reserva" com outro desenho de valor e teclado
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / consistência | Q01-guardar | small, phone (claro e escuro) |

**O que se vê:** `Q01-guardar__phone__light.png`: valor compacto alinhado à direita em campo branco, teclado no meio da folha, "Sai da conta" abaixo do teclado e "Guardar" no fim. No Q01 (`Q01-despesa__phone__light.png`) o valor é grande e centrado, e teclado e botão ficam num rodapé fixo.
**O que a spec pede:** D-043 e UX §3 Q01 itens 6–7 (folha do Guardar com o mesmo teclado e o botão **Guardar** no rodapé fixo); D-090.
**Causa provável:** `apps/web/src/features/budget/ReserveMoveSheet.tsx:88-95` — `AmountInput size="compact"` com o teclado embutido padrão (`showKeypad = true`, `apps/web/src/ui/AmountInput.tsx:61-67`), sem rodapé.
**Correção sugerida:** `size="display"` e `showKeypad={false}`, a conta logo abaixo do valor e um rodapé `quick-footer` com `NumericKeypad` e **Guardar** (o mesmo bloco do Q01, extraído para um componente).

### UX2A-006 — Anel de foco duplo e quadrado nos campos de texto
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / acessibilidade | Q01-categorias (e todo `TextField` focado por teclado ou ao abrir folha) | todos |

**O que se vê:** `Q01-categorias__phone__light.png`: o campo "Buscar" tem o anel arredondado da caixa e, por dentro, um segundo anel retangular de cantos vivos em volta do `<input>`, que cobre a borda e separa a lupa numa caixa à parte.
**O que a spec pede:** UX §4.0 Forma (campos com raio 16 px); §5 (foco visível único, sem molduras indevidas).
**Causa provável:** `apps/web/src/styles/tokens.css:419-422` aplica `box-shadow: var(--focus-ring)` a qualquer `:focus-visible`, inclusive ao `<input>` dentro de `.field-box`, que já ganha o anel por `:focus-within` (`apps/web/src/ui/ui.css:326-328`). A folha foca o campo ao abrir, o que conta como `focus-visible`.
**Correção sugerida:** `.field-box input:focus-visible, .field-box select:focus-visible { box-shadow: none; }` em `ui.css`.

### UX2A-007 — ON01 promete "quanto ainda pode gastar", que saiu do app
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Microcopy | ON01 | todos |

**O que se vê:** `ON01__phone__light.png`: título "Registre gastos em segundos e saiba quanto ainda pode gastar no mês." O Início agora mostra o gasto do mês e o saldo; o "Disponível para gastar" não existe mais em nenhuma tela.
**O que a spec pede:** D-081 (a pergunta central passa a "Quanto já gastei este mês e como está minha conta?", e quem implementa atualiza os textos); a UX §3 ON01 e a §6.4 `onb.welcome.subtitle` ainda trazem a frase antiga (ver lacunas).
**Causa provável:** `apps/web/src/i18n/pt-BR.ts:5` (`onb.welcome.subtitle`).
**Correção sugerida:** texto alinhado à D-081, por exemplo "Registre gastos em segundos e acompanhe quanto já gastou no mês.", com a mudança na UX §6.4 e linha em `docs/DECISIONS.md`.

### UX2A-008 — Teclado numérico fixo também ao escrever a descrição
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Ergonomia / layout | Q01-mais-detalhes | small, phone |

**O que se vê:** `Q01-mais-detalhes__phone__light.png`: com "Mais detalhes" aberto, o teclado numérico e o Lançar continuam ocupando a metade de baixo; Descrição, data, observação e "Repetir todo mês" rolam numa faixa de cerca de 300 px, e o campo "Descrição" aparece cortado pelo teclado. No aparelho, ao tocar em Descrição, o teclado do sistema abre por cima do teclado numérico.
**O que a spec pede:** UX §3 Q01 itens 5–6 (teclado próprio para o valor; Mais detalhes expande na folha); §1 P1.
**Causa provável:** `apps/web/src/features/quick-entry/QuickEntrySheet.tsx:761-768` — o `NumericKeypad` é desenhado sempre que `keypad === 'custom'`, sem olhar onde está o foco.
**Correção sugerida:** esconder o teclado (mantendo o Lançar no rodapé) enquanto o foco está num campo de texto ou quando "Mais detalhes" está aberto, e mostrá-lo de novo ao tocar no valor.

### UX2A-009 — Primário e Switch ligado ainda com degradê
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Fidelidade ao visual | ON04, ON05, ON07, ON07b, ON08, Q01 (todo botão primário e Switch) | todos |

**O que se vê:** `ON08__desktop__light.png`: "Fazer o primeiro lançamento" passa de grafite em cima para preto embaixo; no escuro o Lançar ativo vai de lima clara a lima escura.
**O que a spec pede:** UX §4.0 (primário em pílula preta sólida; sem brilho nem degradê).
**Causa provável:** `apps/web/src/styles/tokens.css:138-139` e `:328-329` (`--grad-primary` e `--grad-primary-pressed` como `linear-gradient`), usados em `apps/web/src/ui/ui.css:51`, `:56` e `:406`.
**Correção sugerida:** cores sólidas nos dois tokens (`--ink-950` e `--ink-800` no claro; lima e lima pressionada no escuro).

### UX2A-010 — "Saldo nas contas" sublinhado em dois pedaços
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes | H01, vazio-H01 | todos |

**O que se vê:** `H01__phone__light.png`, cartão do mês: "Saldo nas contas" e "R$ 5.322,50" com sublinhados separados por um vão, como se fossem dois links.
**O que a spec pede:** UX §3 H01 item 2 (uma linha com chevron → S03).
**Causa provável:** `apps/web/src/app/shell.css:922-937` — `.home-card-link` é `inline-flex` com `gap` e `text-decoration: underline`, então cada `<span>` filho ganha o próprio traço.
**Correção sugerida:** tirar o sublinhado em `.home-balance` (o chevron já indica toque) ou desenhar o traço no contêiner (`border-bottom`).

### UX2A-011 — ON03 sem a marca do Google e sem "Como seus dados são protegidos"
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes / microcopy | ON03 | todos |

**O que se vê:** `ON03__phone__light.png`: o botão "Entrar com Google" usa a seta genérica de entrada (Lucide `LogIn`), não o "G"; abaixo do botão não há o link sobre privacidade.
**O que a spec pede:** UX §3 ON03 (botão no padrão do Google, com o logo G, única exceção ao design system; link "Como seus dados são protegidos" abre folha curta).
**Causa provável:** `apps/web/src/features/onboarding/LoginScreen.tsx:77-86` (`iconStart={LogIn}`, sem o link).
**Correção sugerida:** SVG do "G" oficial no lugar do `LogIn` e o link com uma `BottomSheet` curta (texto já existente em `onb.login.body` ampliado na §6.4).

### UX2A-012 — Vazio da Central de avisos cita "conexões"
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy | vazio-H02 | todos |

**O que se vê:** `vazio-H02__phone__dark.png`: "Vencimentos, limites e conexões aparecem aqui." Sem Open Finance no MVP, não há aviso de conexão.
**O que a spec pede:** D-080 (conexão escondida até a v2).
**Causa provável:** `apps/web/src/i18n/pt-BR.ts:982` e `:1221`.
**Correção sugerida:** "Vencimentos, limites e lembretes aparecem aqui." (com a parte de conexões condicionada a `OPEN_FINANCE_ENABLED`), registrando na §6.5.

### UX2A-013 — Chips do onboarding com outro desenho
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes / consistência | ON06, ON07 | todos |

**O que se vê:** `ON06__phone__dark.png` e `ON07__phone__light__pagina.png`: chips com borda cinza e fundo da página; no Q01 os chips de categoria são brancos, sem borda, com sombra.
**O que a spec pede:** UX §5 (o mesmo componente com a mesma aparência entre telas); §4.0 (chips brancos sobre a menta).
**Causa provável:** `apps/web/src/app/shell.css:1802-1805` (`.onb-chip` sobrescreve fundo e borda do `.chip`).
**Correção sugerida:** remover a sobrescrita e usar o `.chip` padrão (branco, contorno só quando marcado).

### UX2A-014 — Data "Escolher" no formato do navegador (a confirmar)
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / datas | Q01-mais-detalhes | desktop (navegador em inglês) |

**O que se vê:** `Q01-mais-detalhes__desktop__light.png`: "Escolher 11/12/2026" para o dia 12/11/2026 (mês antes do dia).
**O que a spec pede:** `dd/mm/aaaa` em toda data (DoD item 8, D-084).
**Causa provável:** `apps/web/src/ui/DateChip.tsx:52` usa `<input type="date">` nativo, que formata pelo idioma do navegador, não pelo `lang` da página. Num aparelho em pt-BR aparece certo; a confirmar com o dono se vale tratar navegadores em outro idioma.
**Correção sugerida:** mostrar a data escolhida num rótulo próprio formatado por `formatDateBR` e deixar o `input` nativo só como seletor (visualmente escondido sobre o chip).

## Contradições e lacunas na spec

- **ON01 e ON05 depois da D-081:** a UX §3 ON01 e a §6.4 `onb.welcome.subtitle` ainda dizem "saiba quanto ainda pode gastar no mês", e o objetivo da ON05 ainda fala em "base do Disponível para gastar" (`03-ux-design-system.md:281`, `:346`, `:1867`). A D-081 pediu a atualização da §3 H01 e da §6, mas não citou as telas de onboarding.
- **H01 §3, restos do herói antigo:** a seção ainda traz a tabela do `PaceIndicator`, o estado "Sem renda" com "Cadastre sua renda para ver quanto pode gastar", "Toque no herói → H01-S" e o `<h1>` "Disponível para gastar: R$ 1.370,00" na acessibilidade (`03-ux-design-system.md:411-437`), embora a D-081 tenha tirado tudo isso.
- **TopBar do H01:** a §3 H01 item 1 pede saudação ("Boa tarde, {nome}") no lugar do título; a §3.0 pede título centrado nas raízes. O app mostra "Início" no TopBar e a saudação só quando há nome. Com quatro ícones à direita, o título centrado não cabe no centro a 390 px (UXA-019 parcial); falta a spec dizer qual dos dois vale no celular.
- **Q01 em telas baixas:** a §3 Q01 fixa teclado e Lançar no rodapé, mas não diz o que fica sempre à vista quando a altura não comporta valor, categorias e teclado (UX2A-001) nem quando o teclado some (UX2A-008).
- **Rascunho do Q01:** a spec não trata o rascunho recuperado quando o modo pedido é outro (UX2A-002).
- **Atalho em lima no Início:** o último atalho ("Contas e cartões") aparece em lima por posição (`HomeOverview.tsx:189`); a §4.0 mostra um destaque na referência, mas não diz qual atalho deve ser o destacado nem por quê.

## O que está bom

- Navegação no celular resolvida: avatar com o menu da conta nas raízes, Voltar nas subtelas, título curto com reticências e SyncBadge discreto.
- O novo Início responde à pergunta da D-081 logo no primeiro olhar, a 360×640: "Gasto em novembro", valor grande, "Ainda vai sair" e "Saldo nas contas" no cartão escuro, que agora se separa do fundo no escuro.
- Seleção com contorno (segmentado, chips, "Hoje") em claro e escuro, foco inicial no valor e cabeçalho fixo das folhas.
- Onboarding ON04–ON08 com cabeçalho de passos estável no topo, ícone antes do título e ações no terço inferior; campos de valor com moldura.
- Nenhuma rolagem horizontal, nenhum "!" ou emoji, e despesas com "−" em cor neutra nas linhas.
