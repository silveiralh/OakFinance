# Auditoria de UX — 11/11/2026 · parte B (Lançamentos, Cartões, Planejar)

Escopo: T01 (com dados e vazio), T01-filtros, T02 (despesa avulsa), T02-parcela, C01 (com dados e vazio), C02, P01 (com dados e vazio), P02 (com dados e vazio), P03 (com dados e vazio), P04 · tamanhos `small` 360×640, `phone` 390×844 (claro e escuro) e `desktop` 1280×800 · capturas: `scratchpad/shots` (manifest de 11/11/2026, nenhuma captura com rolagem horizontal, nenhum erro de console, todas as URLs finais conferem com a tela pedida) · commit: f002ac8

Fora do escopo desta parte: a moldura comum (TopBar, abas, FAB, barra lateral).

Artefatos do roteiro que **não** viraram achado: o seed das capturas cria lançamentos sem categoria (`app/e2e/hooks.ts:193-212`), então o ícone de etiqueta (`Tag`) em todas as linhas, a falta do anel da faixa, "Categoria: Não informado" e os anéis do orçamento vazios vêm dos dados de exemplo. O histórico vazio da T02 vem do Supabase simulado. Nas capturas `__pagina`, a lista da T01 só desenha as 18 primeiras entradas (janela de rolagem). O resto da página aparece como espaço em branco porque a captura de página inteira não rola. Isso é esperado, mas veja a nota do UXB-003.

## Resumo

| Severidade | Achados |
|---|---|
| S1 | 2 |
| S2 | 16 |
| S3 | 7 |

Os 5 achados que mais melhoram o app se corrigidos primeiro:
1. UXB-001: parcelas futuras aparecem como gasto efetivado de hoje e entram nos totais do dia e do mês na T01.
2. UXB-002: o Planejar não tem as abas internas. O "Fechar o mês" (P04) não tem nenhuma entrada no app, e Reserva e Futuro só abrem a partir do Início.
3. UXB-003: a linha de lançamento espreme a descrição e quebra palavras no meio ("RESTAURANT / E") na T01 e na C02.
4. UXB-014: o anel do orçamento ganha uma moldura quadrada preta (branca no escuro), porque a classe `.ring` colide com um utilitário do Tailwind.
5. UXB-004: valores em dinheiro aparecem partidos em duas linhas ("R$" / "7.270,00"), porque `formatBRL` usa espaço comum.

## Achados

### UXB-001 — Parcelas futuras aparecem como efetivadas e somam no dia da compra
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Estados / dinheiro | T01, T01-filtros, T02-parcela | todos |

**O que se vê:** em `T01__phone__light__pagina.png`, o grupo "Hoje" lista as 6 parcelas do Notebook (1/6 a 6/6). Nenhuma tem o selo "Prevista". O cabeçalho do dia soma "−R$ 4.397,60" e o resumo mostra "Saídas R$ 5.931,40", contando os R$ 2.999,15 das parcelas 2/6 a 6/6, que caem nas faturas de jan a mai/2027. A ordem também sai embaralhada: 1/6, 6/6, 3/6, 4/6, 2/6 no celular e 3/6, 6/6, 2/6… no desktop. Em `T02-parcela__desktop__light.png`, a parcela da fatura "fev/2027, vence 10/02/2027" aparece como "Despesa · Efetivada" no herói e "Status: Efetivada" na lista. O chip "Previstas" também não encontra essas parcelas.
**O que a spec pede:** PRD RN-23 (a parcela k > 1 fica "prevista" enquanto a fatura dela está futura ou aberta e conta no mês de impacto da RN-46). D-034 (as parcelas são gravadas como `posted`, e o "prevista" é **derivado** da fatura futura). UX §3 T01 (chip "Previstas", selos de estado) e §3 T02 (status em texto: Agendada · Prevista…).
**Causa provável:** `apps/web/src/features/transactions/TransactionsScreen.tsx:125-139`. O `rowState` só olha `status === 'pending'` e nunca deriva "prevista" da fatura. A T02 reaproveita isso em `TransactionDetailScreen.tsx:176`. O filtro faz o mesmo em `features/transactions/list.ts:128-129` e `:136-138`. A ordem vem de `list.ts:241`, que ordena por `created_at`, igual para toda a série. Os totais vêm de `list.ts:219-236` (dia) e `:252-273` (resumo), que somam tudo pela `occurred_on`, a data da compra.
**Correção sugerida:** criar um derivador único "é prevista", para item de cartão com `installment_number > 1` em fatura `future`/`open` (o `features/cards/model.ts` já calcula o status da fatura), e usá-lo no `rowState`, no `statusText` da T02 e nos filtros "Previstas"/Status. Dentro do mesmo dia, ordenar a série por `installment_number`. Nos totais do dia, separar ou omitir o previsto. Para o resumo do mês, ver "Contradições".

### UXB-002 — Planejar sem abas internas: "Fechar o mês" não tem entrada, Reserva e Futuro só pelo Início
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Ergonomia / navegação | P01, P02, P03, P04 | todos |

**O que se vê:** a aba Planejar abre direto o Orçamento (`P01__phone__light__pagina.png`). A tela termina em "Ajustar percentuais" e não tem como ir para Reserva, Futuro ou "Fechar outubro". Nenhum ponto do app leva à P04: ela só abre digitando a URL, como fez o roteiro. P02 e P03 só abrem pelos cards do Início.
**O que a spec pede:** UX §2.1, tabela de navegação, item 5 ("`/planejar` (abas internas: Orçamento · Reserva · Futuro)"). UX §5.9 (o SegmentedControl é usado nas "abas de Planejar"). UX §3 P01, item 5 (link **Fechar {mês anterior}** → P04, a partir do dia 1). US-36.
**Causa provável:** `apps/web/src/app/routes.tsx:59` redireciona `/planejar` para o orçamento sem cabeçalho de abas. `features/budget/BudgetScreen.tsx:226-231` só tem o link "Ajustar percentuais". A rota `/planejar/fechar/:mes` (`app/screens.ts:92`) não é citada por nenhum componente. Os únicos links para P02/P03 estão em `features/dashboard/HomeCards.tsx:53`, `:147` e `:170`.
**Correção sugerida:** um `SegmentedControl` (Orçamento · Reserva · Futuro) no topo das três telas de Planejar e, na P01, o link "Fechar {mês anterior}" para `/planejar/fechar/<aaaa-mm>` a partir do dia 1, enquanto o mês não estiver fechado.

### UXB-003 — Linha de lançamento espremida: descrição quebra no meio da palavra e a data se repete
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout / tipografia | T01, T01-filtros, C02 | small, phone (claro e escuro); o desktop fica bem |

**O que se vê:** em `T01__phone__light.png`, "PAG*IFOOD RESTAURANTE" ocupa três linhas ("PAG*IFOOD / RESTAURANT / E"), e a meta "Débito · 11/11/2026" quebra em duas. Somada ao selo "Conferir", uma linha chega a 5 linhas e cerca de 130 px. A 360 px (`T01__small__light.png`) fica "PIX / ENVIADO / JOAO P", e na C02 a meta "Crédito · 2/6 · / 11/11/2026" quebra. A data completa repete, em toda linha, o que o cabeçalho do grupo já diz ("Hoje").
**O que a spec pede:** UX §5.19 TransactionRow (linha de 64 px, título e meta). Agente §3 item 3 (quebras ruins, palavras soltas). UX §0.1 Datas (relativas: "hoje", "ontem").
**Causa provável:** `apps/web/src/ui/ui.css:1043-1046` (`.tx-title { overflow-wrap: anywhere }`) deixa partir a palavra em qualquer letra. A meta leva `when: formatDateBR(tx.occurred_on)` (`features/transactions/TransactionsScreen.tsx:182`, montada em `ui/TransactionRow.tsx:88-94`) mesmo dentro de um grupo por dia. A coluna de texto fica com cerca de 106 px a 390 px, porque o valor e o botão de 48 px vêm ao lado. Nota, a confirmar: a lista virtual supõe 72 px por entrada (`TransactionsScreen.tsx:79-80`, `list.ts:281-291`), mas as linhas reais têm de 100 a 130 px no celular. Ao rolar, cada linha que sai da janela troca cerca de 30 px de altura real por 72 px de espaçador, então a lista deve dar saltos.
**Correção sugerida:** título em uma linha com reticências (`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, sem `overflow-wrap: anywhere`) ou recorte em 2 linhas. Na lista agrupada por dia, a meta passa a ser só "Débito" ou "Crédito · 2/6", sem a data. Com a linha estável em 64 px, o `ROW_HEIGHT` volta a corresponder à realidade. Se não ficar, a janela precisa medir a altura real.

### UXB-004 — Valores em dinheiro partidos em duas linhas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tipografia / dinheiro | T01, P03 | T01: small; P03: phone e small |

**O que se vê:** em `T01__small__light.png`, o resumo mostra "R$ / 7.270,00" e "R$ / 5.931,40". Em `P03__phone__light__pagina.png`, aparece "Comprometido nos próximos 3 meses: R$ / 1.799,51", com o símbolo no fim de uma linha e o número na outra.
**O que a spec pede:** agente §3 item 3 ("valores partidos em duas linhas"). UX §0.1 Moeda (`R$ 1.234,56` como uma unidade).
**Causa provável:** `packages/domain/src/money.ts:68` monta `R$ ${…}` com espaço comum (o `Intl` usaria espaço não separável). O resumo da T01 ainda permite quebrar em qualquer ponto (`apps/web/src/app/shell.css:314-325`: `minmax(0, 1fr)` e `overflow-wrap: anywhere`, de propósito, para os 360 px). Na P03, o valor vem no meio da frase (`features/budget/FutureScreen.tsx:83-85`).
**Correção sugerida:** envolver todo valor num `<span>` com `white-space: nowrap` (o `Amount` de `app/values.tsx:26-36` é o ponto único) ou trocar o espaço de `formatBRL` por U+00A0, com teste. No resumo da T01 a 360 px, empilhar rótulo e valor com fonte um degrau menor em vez de deixar quebrar. Na P03, o valor numa linha própria, abaixo do rótulo.

### UXB-005 — T01 sem o card "Conferir", e o selo "Conferir" parece metadado
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / componentes | T01 | todos |

**O que se vê:** há dois importados pendentes (PIX ENVIADO JOAO P, PAG*IFOOD), mas a T01 não mostra o card que leva à conferência. Nas linhas, "Conferir" aparece como mais uma linha cinza de 13 px sob a data (`T01__phone__light.png`), sem forma de selo, e pode ser lido como parte da meta.
**O que a spec pede:** UX §3 T01, item 4 (card "Conferir" se houver pendências → I05). UX §5.19 (selos sempre com texto, mas distinguíveis).
**Causa provável:** `features/transactions/TransactionsScreen.tsx:271-439` não tem bloco de pendências nem link para `/conferir`. O selo é `ui/TransactionRow.tsx:115` com o estilo de `ui/ui.css:1057-1063` (só cor secundária, sem fundo nem contorno).
**Correção sugerida:** acima da lista, um card "{n} para conferir" para `/conferir`, com o mesmo contador do Início (`new` + `suggested`). O `.tx-seal` passa a pílula pequena com fundo `--surface-inset`, como o selo "Futura" das faturas.

### UXB-006 — Filtros escondido no fim da fila de chips; a busca ocupa a dobra
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Ergonomia / hierarquia | T01, T01-filtros | small, phone |

**O que se vê:** o botão "Filtros" é o 11º chip e só aparece depois de rolar os outros 10 para o lado (`T01-filtros__phone__light.png` mostra a fila já rolada até o fim). A busca é um campo com rótulo próprio ("Buscar lançamentos"), com 52 px mais o rótulo. Com o seletor de mês, o resumo e os chips, o primeiro lançamento só começa na metade da tela de 390×844 e quase no fim da de 360×640.
**O que a spec pede:** UX §3 T01, item 3 (chips roláveis **e** um botão **Filtros**; "Botão busca"). P4 (a resposta antes dos detalhes).
**Causa provável:** `features/transactions/TransactionsScreen.tsx:331-339` põe Filtros dentro de `.quick-chips`, depois de `CHIPS.map`. `:310-315` usa um `TextField` com rótulo visível.
**Correção sugerida:** tirar "Filtros" da fila e pô-lo como botão fixo (ícone `Funnel` com o número de filtros ativos) ao lado de um botão de busca que expande o campo. Isso devolve cerca de 90 px à lista.

### UXB-007 — Listas de seleção sem seta: parecem campos de texto
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes | T01-filtros (e a folha de pagamento da C02, a confirmar; o componente é usado no app todo) | todos |

**O que se vê:** em `T01-filtros__phone__light.png`, Conta, Faixa, Categoria e Status são caixas com "Todas" e nenhuma seta. Nada indica que abrem uma lista.
**O que a spec pede:** UX §5.14 (TextField / Select como controles distintos). Agente §3 item 5.
**Causa provável:** `apps/web/src/ui/ui.css:322-335` aplica `appearance: none` também ao `select`, e `ui/TextField.tsx:141-154` não desenha nenhum ícone no `field-box`.
**Correção sugerida:** no `Select`, um `ChevronDown` (Lucide, traço 2) à direita do `field-box`, com `pointer-events: none`. A correção vale para todas as telas.

### UXB-008 — Títulos internos sem peso e quebrando mal
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Tipografia / hierarquia | T01, C02, P04, vazios (T01, C01, P01, P02, P03) | todos |

**O que se vê:** "Fechar outubro" (`P04__phone__light.png`) sai em 16 px e peso normal, menor que o texto do card logo abaixo. O seletor "novembro 2026" (T01) e "Cartão Nubank · jan/2027" (C02) saem em 22 px com peso 500, mais leves que o TopBar em negrito. Na C02 a 390 e a 360 px, o título quebra em "Cartão Nubank · / jan/2027", com o ponto solto no fim da linha. Os títulos dos estados vazios ("Nenhum cartão cadastrado") também saem em peso normal.
**O que a spec pede:** UX §4.0 Forma e tipografia (Nunito 500–800, escala coerente). Agente §3 item 3.
**Causa provável:** o preflight do Tailwind (`styles/base.css:1`) zera o peso dos `h1`–`h6`. `app/shell.css:308-311` (`.list-month-title`) só define tamanho. `features/budget/CloseMonthScreen.tsx:95` usa um `<h2>` sem classe nem regra. `ui/ui.css:520-523` (`.empty h2`) não define peso. O título da C02 é uma frase só (`features/cards/InvoiceScreen.tsx:128-130`).
**Correção sugerida:** `font-weight: var(--font-weight-bold)` em `.list-month-title`, `.empty h2` e no título da P04 (classe própria, `--font-size-title`). Na C02, nome do cartão e mês em duas linhas de propósito (mês em destaque, cartão como linha secundária), em vez de juntar com " · ".

### UXB-009 — Detalhe de parcela não diz que é parcela; herói sem descrição
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Hierarquia / conteúdo | T02, T02-parcela | todos |

**O que se vê:** em `T02-parcela__phone__light__pagina.png`, nada indica "parcela 1 de 6", e falta a lista das parcelas. A pessoa só sabe que é parcelado pela T01. O herói mostra "−R$ 599,85 · Despesa · Efetivada", que repete as linhas Tipo e Status logo abaixo. O que identifica o lançamento ("Notebook", "Mercado Bom Preço") só aparece na 7ª linha do `<dl>`. Campos vazios ocupam linhas com "Não informado" (Observação).
**O que a spec pede:** UX §3 T02 (valor grande, tipo, status… "parcelas (lista '1/10 dez · 2/10 jan…', com a atual destacada)"). P4.
**Causa provável:** `features/transactions/TransactionDetailScreen.tsx:253-276`, porque `pairs` não tem linha de parcela nem a lista da série. O herói (`:281-291`) traz só valor, tipo e status. Os campos opcionais vazios usam `detail.empty` (`i18n/pt-BR.ts:506`).
**Correção sugerida:** herói com a descrição (ou a categoria) acima do valor e o status como selo. Uma linha "Parcela: 1 de 6" e a lista das parcelas da série ("1/6 dez · 2/6 jan…", com a atual em negrito). Tirar do `<dl>` o Tipo e o Status repetidos e esconder Observação quando vazia.

### UXB-010 — Cartão da fatura com gradiente e brilho do Aero; contorno lima cortado
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Fidelidade ao visual | C01 | todos |

**O que se vê:** em `C01__phone__light.png`, o cartão "Cartão Nubank" é um degradê de grafite para preto com um reflexo branco na diagonal. Em volta, um contorno lima de 3 px aparece só embaixo e à direita: em cima e à esquerda ele some (no desktop o corte é nítido). O contorno de seleção aparece mesmo com um cartão só.
**O que a spec pede:** UX §4.0 (cards sólidos, "sem brilho especular, sem vidro"; fundo "sem gradiente"; "a lima não serve de texto nem de borda sobre branco… seleção sempre leva o contorno preto"). Agente §3 item 1.
**Causa provável:** `apps/web/src/ui/ui.css:945` usa os `--grad-card-*` de `styles/tokens.css:141-146`, e `ui/ui.css:948-954` (`.invoice-card::before`) desenha o reflexo. A seleção vem de `app/shell.css:344-347` (`outline: 3px solid var(--accent); outline-offset: 2px`), e o `.cards-carousel` com `overflow-x: auto` (`shell.css:333-339`) corta o que passa da borda.
**Correção sugerida:** fundo sólido (`--surface-dark` ou a cor do cartão sem degradê) e sem o `::before`. Seleção com contorno preto (no escuro, lima ou branco) só quando houver mais de um cartão, e `padding` no carrossel para o contorno caber.

### UXB-011 — Datas sem rótulo no cartão da fatura; nome e total repetidos logo abaixo
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Microcopy / hierarquia | C01 | todos |

**O que se vê:** a faixa de baixo do cartão diz só "03/12 · 10/12", sem dizer qual é o fechamento e qual o vencimento. O card seguinte repete "Cartão Nubank" e "R$ 984,75" e só então explica "Fecha em 03/12 (22 dias)". O vencimento não aparece em lugar nenhum com rótulo.
**O que a spec pede:** UX §3 C02 ("Fecha em 03/12 · Vence em 10/12"). UX §5.18 InvoiceCard. Agente §3 item 7 (rótulos que dizem o que é).
**Causa provável:** `apps/web/src/ui/InvoiceCard.tsx:106` monta `${dm(closesOn)} · ${dm(dueOn)}`. A repetição vem de `features/cards/CardsScreen.tsx:156-162`.
**Correção sugerida:** usar no cartão o texto que a C02 já tem (`invoice.closesDue`: "Fecha em 03/12 · Vence em 10/12"). No card de baixo, tirar nome e total e deixar o estado ("Fecha em 03/12 (22 dias)"), o limite e "Ver fatura".

### UXB-012 — Linhas de "Próximas faturas" e do Futuro quebram desalinhadas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout | C01, P03 | small, phone (claro e escuro) |

**O que se vê:** em `C01__phone__light__pagina.png`, jan e fev/2027 põem o selo "Futura" à direita e o valor na linha de baixo, mas mar/2027 põe selo e valor juntos na segunda linha. A 360 px, todas mudam de novo. Em `P03__phone__light__pagina.png`, o ícone do cartão fica sozinho numa linha, e "Notebook · 1/6 · R$ 599,85 · Cartão Nubank" vem embaixo, com o valor no meio da frase e quebrando. Cada mês vira um card com um item só.
**O que a spec pede:** UX §3 P03 (lista agrupada por mês, "Geladeira · 4/10 · R$ 250,00 · Nubank"). Agente §3 item 4 (alinhamentos consistentes).
**Causa provável:** `apps/web/src/app/shell.css:367-389` (`.cards-invoice { flex-wrap: wrap }`, com o mês em `flex: 1 1 auto`). A P03 reaproveita a mesma classe (`features/budget/FutureScreen.tsx:149-166`) e junta os campos com " · " num texto só (`:139-146`).
**Correção sugerida:** uma linha em grade com três colunas (ícone | texto em 2 linhas | valor à direita, tabular), por exemplo `grid-template-columns: auto 1fr auto`. Na P03: "Notebook" em cima, "1/6 · Cartão Nubank" embaixo, valor à direita. Um card só com cabeçalhos de mês, em vez de um card por mês.

### UXB-013 — "Registrar pagamento" numa fatura futura paga outra fatura
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / ergonomia | C02 | todos |

**O que se vê:** em `C02__phone__light.png` (fatura de jan/2027, "Futura"), o botão primário preto "Registrar pagamento" aparece com destaque, mas não há nada a pagar nessa fatura. O botão abre a folha com a fatura aberta de dez/2026 como destino. Ele também não fica no rodapé: está entre o cabeçalho e a lista.
**O que a spec pede:** UX §3 C02 ("rodapé fixo com **Registrar pagamento**"; estado futura: "Fatura futura: mostra parcelas e contas fixas já previstas."). RN-16.
**Causa provável:** `features/cards/InvoiceScreen.tsx:108-115` monta `payViews` com as faturas anteriores e a atual do cartão, não com a fatura que está na tela, e `:153-159` mostra o botão sempre que houver alguma pagável (`features/cards/model.ts:270-284`). `.invoice-pay` não tem regra de CSS (nada fixo).
**Correção sugerida:** mostrar o primário só quando a fatura da tela tem saldo e não é futura. Nas outras, no máximo um link secundário "Pagar a fatura de dez/2026". Pôr o botão fixo acima da barra de abas, como a spec pede (ver "Contradições").

### UXB-014 — Moldura quadrada em volta do anel do orçamento
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / fidelidade | P01, vazio-P01 | todos (preta no claro, branca no escuro) |

**O que se vê:** em `P01__phone__light.png`, o `BudgetRing` fica dentro de um quadrado de 1 px preto, do tamanho do SVG. Em `P01__phone__dark.png`, o quadrado é branco. Não há foco: a moldura está sempre lá.
**O que a spec pede:** UX §5.15 BudgetRing. Agente §3 item 5 ("contornos, bordas e molduras que não deveriam estar lá").
**Causa provável:** `apps/web/src/ui/BudgetRing.tsx:59` usa `className="ring"` no `<figure>`. Como `styles/base.css:1` importa o Tailwind, ele encontra a palavra "ring" no código e gera o utilitário `.ring { box-shadow: 0 0 0 1px currentcolor }`, presente no CSS do build (`dist/assets/index-*.css`). As regras próprias ficam em `ui/ui.css:878-899`.
**Correção sugerida:** renomear para `budget-ring` (e `budget-ring-center`, `budget-ring-legend`) no componente e no `ui.css`. Vale procurar outras classes do projeto com nome de utilitário do Tailwind (o build também gera `.shadow`, `.table`, `.hidden`, `.grid`, `.flex`). O anel pequeno do Início, se usar o mesmo componente, deve ter a mesma moldura (é de outra frente).

### UXB-015 — Orçamento: renda repetida no anel e faixas zeradas no estado sem renda
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Hierarquia / estados | P01, vazio-P01 | todos |

**O que se vê:** "Renda do mês R$ 7.270,00" aparece em cima do anel, e o centro do anel repete "R$ 7.270,00" em 32 px, sem rótulo. Sem renda (`vazio-P01__phone__light__pagina.png`), o anel mostra "R$ 0,00" no centro, o EmptyState vem embaixo e os três cards de faixa continuam com "R$ 0,00 de R$ 0,00 · 0%", "Já foi R$ 0,00 · Vai sair R$ 0,00" e até "Dentro do planejado".
**O que a spec pede:** UX §3 P01, item 1 (centro com "Renda do mês R$ 4.800") e estado "sem renda (anéis vazios + 'Cadastre sua renda…' + botão)". UX §6.5.
**Causa provável:** `features/budget/BudgetScreen.tsx:178-185` põe a linha `budget-income` e o `BudgetRing` com `incomeCents` no centro. `:198-205` desenha os `BandCard` mesmo com `view.incomeCents <= 0`.
**Correção sugerida:** deixar só o centro do anel, com o rótulo "Renda do mês" em 13 px sobre o valor, e tirar a linha de cima. Sem renda, esconder os cards de faixa (ou mostrar só os limites por categoria, se houver) e deixar o EmptyState como única chamada.

### UXB-016 — Reserva: "Estimativa provisória Estimativa provisória, …"
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Microcopy | P02 | todos |

**O que se vê:** em `P02__phone__light__pagina.png`, o card da meta diz "**Estimativa provisória** Estimativa provisória, recalculada com seus gastos." A frase não explica de onde vêm os R$ 21.810,00.
**O que a spec pede:** UX §3 P02, item 4 ("Meta sugerida: 6× a média mensal de Necessidades (R$ 2.250)"; sem mês completo, "usa 6× a meta de Necessidades do mês, com o rótulo 'estimativa provisória'").
**Causa provável:** `features/budget/ReserveScreen.tsx:163-166` junta `reserve.provisional` ("Estimativa provisória", `i18n/pt-BR.ts:397`) com `reserve.goalNoData` ("Estimativa provisória, recalculada com seus gastos.", `pt-BR.ts:384`).
**Correção sugerida:** uma frase só que diga a base, por exemplo "Meta sugerida: 6× a meta de Necessidades do mês (R$ 3.635,00), estimativa provisória, recalculada com seus gastos." Na mesma mudança, registrar a chave na UX §6.4.

### UXB-017 — Reserva sem meta: rótulo gigante no anel e três botões primários
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Hierarquia / estados | vazio-P02, P02 | todos (pior a 360 px) |

**O que se vê:** em `vazio-P02__phone__light__pagina.png`, "Defina uma meta" aparece em 32 px negrito dentro do anel tracejado (a 360 px encosta no traço) e se repete logo abaixo no título do EmptyState. Em seguida vêm três pílulas pretas: "Definir meta", "Guardar" e outro "Guardar" no vazio do histórico. Com meta (`P02__phone__light__pagina.png`), "Guardar" também aparece duas vezes. Um ponto verde no topo do anel sugere progresso (ver UXB-019).
**O que a spec pede:** UX §3 P02 estados ("sem meta: anel vazio tracejado + 'Defina uma meta para acompanhar o progresso'"; "vazio: 'Nenhum aporte registrado.'"). Agente §3 item 2 (um elemento dominante).
**Causa provável:** o rótulo usa a fonte display (`apps/web/src/ui/ui.css:913-919`, `.goal-ring .goal-center`) para qualquer texto. O EmptyState da meta vem em `features/budget/ReserveScreen.tsx:134-143`, as ações fixas em `:150-155` e o vazio do histórico com outro "Guardar" em `:197-206`.
**Correção sugerida:** sem meta, o centro do anel fica vazio (ou mostra "—") e a única ação primária é "Definir meta", com "Guardar" e "Registrar uso" como secundários. O vazio do histórico vira só texto ("Nenhum aporte registrado."), sem botão.

### UXB-018 — Fechar o mês sem o resumo do mês
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Conteúdo / spec | P04 | todos |

**O que se vê:** `P04__phone__light.png` tem o título, "Nenhuma pendência. O mês pode ser fechado." e "Fechar mês". Não aparecem a renda, o gasto por faixa nem o guardado, e a pessoa fecha o mês sem ver o que está confirmando. O resto da tela fica vazio.
**O que a spec pede:** UX §3 P04 ("Resumo do mês (renda, gasto por faixa, guardado). Botão primário **Fechar mês**…").
**Causa provável:** `features/budget/CloseMonthScreen.tsx:94-155` desenha só o checklist e o botão. O snapshot com esses números já é calculado ao fechar (D-063).
**Correção sugerida:** um card de resumo entre o checklist e o botão, com os números do `spendableThisMonth` e do `bucketBudget` do mês (os mesmos do snapshot), e o botão no fim, perto do polegar.

### UXB-019 — Arco de 0% aparece como um ponto colorido
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Gráficos | P01, P02, vazio-P01, vazio-P02 | todos |

**O que se vê:** com 0%, cada anel mostra uma bolinha cheia no topo (três no P01, uma no P02), que lê como "começou".
**O que a spec pede:** UX §5.15/§5.17 (o anel no valor atual; 0% = vazio).
**Causa provável:** `apps/web/src/ui/BudgetRing.tsx:94-104` e `ui/GoalProgress.tsx:101-111` usam `strokeLinecap="round"` com `strokeDasharray="0 c"`, e a ponta arredondada desenha um círculo.
**Correção sugerida:** só renderizar o arco quando o valor for maior que 0.

### UXB-020 — Futuro: barras sem valores nem legenda; "Ver como tabela" antes do gráfico
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Gráficos / leitura | P03 | todos |

**O que se vê:** as seis barras de dez/2026 a mai/2027 aparecem pretas e cheias, e as seis seguintes vazias. Nenhuma diz o valor, e nada explica que preto é parcela e listrado é conta fixa. "Ver como tabela" (botão fantasma, recuado) fica entre o resumo e o gráfico.
**O que a spec pede:** UX §3 P03 (barras empilhadas parcelas · contas fixas, segmentos com padrão além da cor, tabela alternativa).
**Causa provável:** `features/budget/FutureScreen.tsx:86-129` (botão antes do `<ul>`, barras `aria-hidden` sem rótulo de valor) e `app/shell.css:426-457`.
**Correção sugerida:** o valor do mês no fim de cada barra (tabular, 13 px), uma legenda de duas entradas acima e o "Ver como tabela" depois do gráfico.

### UXB-021 — Fatura repete o fechamento em duas linhas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy | C02 | todos |

**O que se vê:** "Fecha em 03/01 · Vence em 10/01" e, logo abaixo, "Fecha em 03/01 (53 dias)".
**O que a spec pede:** UX §3 C02 (cabeçalho com "Fecha em 03/12 · Vence em 10/12"; estado aberta "Fecha em 03/12 (18 dias)").
**Causa provável:** `features/cards/InvoiceScreen.tsx:139-149` mostra as duas linhas, e `features/cards/CardsScreen.tsx:29-34` devolve o "Fecha em" também para aberta e futura.
**Correção sugerida:** uma linha só para aberta e futura: "Fecha em 03/01 (53 dias) · Vence em 10/01".

### UXB-022 — Ações da T02: "Excluir" em vermelho cheio e em ordem diferente a cada tipo
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Componentes / consistência | T02, T02-parcela | todos |

**O que se vê:** no avulso, a ordem é Editar, Mudar categoria, Excluir. Na parcela, é Editar, **Excluir**, Mudar categoria, Mover para outra fatura. O botão vermelho cheio é o elemento mais forte da tela, mais que o próprio valor.
**O que a spec pede:** UX §5.1 Button (variante perigo para confirmação). Agente §3 item 5 (mesma função, mesmo lugar).
**Causa provável:** `features/transactions/TransactionDetailScreen.tsx:314-343` põe as ações da série (que incluem Excluir, `features/installments/SeriesActions.tsx:162-165`) antes de "Mudar categoria" e "Mover".
**Correção sugerida:** ordem fixa (Editar, Mudar categoria, Mover, Excluir por último) e "Excluir" como botão secundário com texto em perigo. O vermelho cheio fica para o diálogo de confirmação.

### UXB-023 — Chip selecionado perde o contorno no tema escuro
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tema escuro / acessibilidade | T01, T01-filtros | phone escuro |

**O que se vê:** no claro, "Todos" tem fundo lima e contorno preto de 2 px. No escuro (`T01__phone__dark.png`), o contorno preto some no grafite, e a seleção depende só do preenchimento.
**O que a spec pede:** UX §4.0 (seleção com fundo lima **e** contorno preto de 2 px ou check, "para não depender só da cor").
**Causa provável:** `apps/web/src/app/shell.css:537-539` usa a cor literal `--ink-950`, que não muda no escuro.
**Correção sugerida:** um token de contorno de seleção (preto no claro, `--mist-50` no escuro) ou um ícone `Check` no chip selecionado.

### UXB-024 — "Status: Todas"
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy | T01-filtros | todos |

**O que se vê:** o seletor Status mostra "Todas", como Conta, Faixa e Categoria, mas "status" é masculino.
**O que a spec pede:** UX §6.2 (português correto).
**Causa provável:** `features/transactions/TransactionsScreen.tsx:374-385` reaproveita `list.filter.any` ("Todas", `i18n/pt-BR.ts:466`).
**Correção sugerida:** uma chave "Todos" para Status (ou "Qualquer" para os quatro).

### UXB-025 — Tocar no cartão da C01 não faz nada
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Interação | C01 | todos |

**O que se vê:** o cartão é o elemento mais chamativo da tela e é um botão, mas com um cartão só o toque não muda nada, porque ele já está selecionado. Para abrir a fatura é preciso achar "Ver fatura".
**O que a spec pede:** UX §3 C01 (carrossel por cartão; o detalhe da fatura a um toque).
**Causa provável:** `features/cards/CardsScreen.tsx:136` (`onPress={() => select(i)}`).
**Correção sugerida:** se o cartão já está selecionado, o toque abre a fatura atual (`go(o.current)`).

## Contradições e lacunas na spec

- **Formato das datas na lista:** UX §0.1 pede datas relativas ("hoje", "ontem", "qua", "7 nov") e o cabeçalho da T01 em "ter, 3 nov". A DoD (CLAUDE.md §8, PRD §7) pede `dd/mm/aaaa`. O app usa `09/11/2026` no cabeçalho do dia e em toda linha. Falta decidir qual vale na lista e nos cabeçalhos.
- **Mês do resumo da T01:** a UX §3 T01 diz "Resumo do mês em 3 números" sem dizer se o mês é o da data (RN-22: as parcelas exibem a data da compra) ou o de impacto (RN-46: a fatura). Hoje a T01 soma pela data, e o Início e a P01 somam pelo vencimento da fatura, então "Saídas" da T01 e o gasto da P01 nunca batem quando há compra parcelada.
- **Rodapé fixo da C02 com a barra de abas flutuante:** a UX §3 C02 pede um rodapé fixo, e a §4.0 põe a pílula das abas flutuando a 12 px do fundo. A spec não diz como empilhar os dois (altura, área segura, sombra).
- **P03 vazio sem ação:** a UX §6.5 dá ações vazias para o Futuro, e a US-63 e o agente §3 item 6 pedem vazio "convidando a agir". Uma ação "Lançar compra parcelada" (Q01 no crédito) caberia.
- **SegmentedControl ainda descrito como vidro:** a UX §5.9 fala de "indicador em vidro claro", e a §4.0 tirou o vidro. Vale a §4.0, mas a §5.9 é a referência das abas de Planejar que faltam (UXB-002).
- **Seleção no tema escuro:** a §4.0 manda "contorno preto de 2 px" para a seleção, mas não diz que cor usar no escuro, onde o preto não aparece (UXB-023).

## O que está bom

- Sinais e cores do dinheiro seguem a P6: despesa com "−" (U+2212) em cor neutra e receita com "+" em verde, sem vermelho para gasto.
- Os estados vazios de T01, C01 e P03 usam exatamente os textos da UX §6.5, com ícone e (onde há) uma ação clara em pílula preta.
- Nenhuma captura tem rolagem horizontal, e o desktop segue a D-026 (uma coluna que cresce, sem segunda coluna).
- O tema escuro mantém o contraste dos textos, valores e selos em todas as telas revisadas.
- Os termos do glossário estão certos (Lançamento, Fatura, Parcela, Reserva, Guardar, Faixa), e não aparece "!" nem emoji.
