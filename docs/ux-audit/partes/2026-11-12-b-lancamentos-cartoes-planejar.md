# Auditoria de UX — 12/11/2026 · parte B (Lançamentos, Cartões, Planejar), segunda rodada

Escopo: T01 (com dados e vazio), T01-filtros, T02 (despesa avulsa), T02-parcela, C01 (com dados e vazio), C02 (fatura futura de jan/2027), P01, P02, P03 (com dados e vazio), P04 · tamanhos `small` 360×640, `phone` 390×844 (claro e escuro), `tablet` 768×1024 e `desktop` 1280×800 · capturas: `scratchpad/audit` (manifest de 12/11/2026: nenhuma captura com rolagem horizontal, nenhum erro de console, todas as URLs finais iguais às pedidas, nenhuma `note`) · commit: cb65667

Fora do escopo desta parte: a moldura comum (TopBar genérico, abas, FAB, barra lateral), exceto onde o texto do TopBar é da própria tela (P03).

Artefatos do roteiro que **não** viraram achado: o histórico vazio da T02 (Supabase simulado); o ícone de etiqueta e "Categoria: Não informado" no Notebook, no PIX, no iFood e nas receitas (o seed só categoriza 8 despesas, `apps/web/ux-audit/capture.mjs:291-307`); o resumo de outubro todo em R$ 0,00 na P04 (o seed não tem lançamentos em outubro); nas capturas `__pagina`, o espaço em branco depois de "10/11/2026" na T01 (janela da lista virtual) e as barras fixas no meio da imagem. Os traços em 25/50/75% do anel da Reserva são da spec (UX §3 P02, item 1) e não são defeito.

## Resumo

Achados novos:

| Severidade | Achados |
|---|---|
| S1 | 1 |
| S2 | 7 |
| S3 | 8 |

Revalidação da primeira rodada (25 achados UXB): 19 resolvidos, 5 parciais, 1 aberto (UXB-004, que é a T-130).

Os 5 achados que mais melhoram o app se corrigidos primeiro:
1. UX2B-001: a renda do mês sai em dobro na P01 (R$ 14.120,00 contra R$ 7.270,00 de entradas), e com ela as metas das faixas e a meta sugerida da Reserva.
2. UX2B-002: na lista, o nome do lançamento fica cortado em 10 a 12 letras a 390 px ("Mercado Bo…", "Padaria São J…").
3. UX2B-003: as abas do Planejar cortam "Fechar o mês" no celular ("Fechar c", "Fecl").
4. UX2B-004: na T01, os totais do dia não batem com "Saídas" do resumo, porque seguem regras diferentes.
5. UX2B-005: a fatura futura (C02) mostra a parcela 2/6 sem o selo "Prevista", que a T01 mostra para o mesmo lançamento.

## Revalidação da primeira rodada

| ID | Situação | Evidência |
|---|---|---|
| UXB-001 parcelas previstas | Parcial | T01 resolvida: selo "Prevista" tracejado em 2/6 a 6/6, ordem 1/6…6/6 e total do dia sem as previstas (`T01__phone__light__pagina.png`; `features/transactions/list.ts:114-142`, `:264-301`). Falta a C02: ver UX2B-005. |
| UXB-002 abas do Planejar | Resolvido | Controle segmentado Orçamento · Reserva · Futuro · Fechar o mês nas quatro telas (`app/PlanTabs.tsx`). O corte no celular é achado novo (UX2B-003). |
| UXB-003 linha espremida | Parcial | Não parte mais palavra no meio e a data saiu das linhas agrupadas por dia (`TransactionsScreen.tsx:205`; `app/shell.css:727-736`). Em troca, o título ficou cortado demais: UX2B-002. |
| UXB-004 valor em duas linhas | Aberto (T-130) | Igual à rodada anterior, sem piora: "R$ / 7.270,00" e "R$ / 1.919,60" em `T01__small__light.png`; "Comprometido nos próximos 3 meses: R$ / 5.699,21" em `P03__phone__light.png`. |
| UXB-005 card "Conferir" | Resolvido | Card "2 para conferir" com "Conferir agora" e selo em pílula (`T01__phone__light.png`). Ver UX2B-009 sobre a cor. |
| UXB-006 Filtros e busca | Parcial | "Filtros" saiu da fila e fica ao lado da busca, com contador. A 360×640 o primeiro lançamento continua fora da primeira tela: só o cabeçalho "Hoje" aparece acima das abas (`T01__small__light.png`), porque o card "para conferir" somou cerca de 90 px. |
| UXB-007 select sem seta | Resolvido | Chevron em Conta, Faixa, Categoria e Status (`T01-filtros__phone__light.png`). |
| UXB-008 títulos sem peso | Parcial | Seletor de mês, título da P04 e títulos dos vazios em negrito (`app/shell.css:332-336`, `ui/ui.css:556-561`). A C02 continua quebrando "Cartão Nubank · / jan/2027" a 390 e 360 px, com o ponto solto (`C02__phone__light.png`; `features/cards/InvoiceScreen.tsx:135-137`). |
| UXB-009 detalhe da parcela | Resolvido | Descrição no herói, linha "Parcela 1 de 6" e lista 1/6…6/6 com a atual em negrito (`T02-parcela__phone__light__pagina.png`). Redundâncias menores em UX2B-011. |
| UXB-010 cartão com gradiente | Resolvido | Cartão sólido, sem reflexo, sem contorno com um cartão só (`app/shell.css:367-383`). |
| UXB-011 datas sem rótulo | Resolvido | "Fecha em 03/12 · Vence em 10/12" no cartão; o card de baixo só com o estado e "Ver fatura" (`C01__phone__light.png`). |
| UXB-012 linhas desalinhadas | Parcial | A grade de três colunas alinhou selo e valor (`app/shell.css:403-411`) e a P03 virou nome / "2/6 · Cartão Nubank" / valor. Mas o texto "jan/2027 · vence 10/01/2027" quebra com o ponto solto a 390 px e em três linhas a 360 px ("jan/2027 · / vence / 10/01/2027", `C01__small__light.png`); a causa é a frase única de `i18n/pt-BR.ts:597` (`'{mês} · vence {data}'`). Sugestão: mês em negrito numa linha e "vence 10/01" abaixo, sem o ano repetido. |
| UXB-013 pagar fatura futura | Resolvido | Na fatura futura só aparece o secundário "Pagar a fatura de dez/2026" (`C02__phone__light.png`). |
| UXB-014 moldura do anel | Resolvido | Classe renomeada para `budget-ring`; nenhuma moldura nos dois temas. |
| UXB-015 renda repetida | Resolvido | Renda só no centro, com rótulo; sem renda, o vazio é a única chamada (`vazio-P01__phone__light.png`). |
| UXB-016 "Estimativa provisória" duplicada | Resolvido | "Meta sugerida: 6× a meta de Necessidades do mês (R$ 7.060,00), estimativa provisória, recalculada com seus gastos." (o valor está errado por causa do UX2B-001). |
| UXB-017 Reserva sem meta | Resolvido | Centro do anel vazio, "Definir meta" é o único primário e o vazio do histórico não tem botão. Resta a ação repetida do UX2B-012. |
| UXB-018 Fechar sem resumo | Resolvido | Card "Resumo de outubro" com renda, Necessidades, Desejos e Guardado antes de "Fechar mês" (`P04__phone__light.png`). |
| UXB-019 ponto no arco de 0% | Resolvido | Desejos e Poupança a 0% não desenham ponto (`P01__phone__light.png`). |
| UXB-020 barras do Futuro | Resolvido | Legenda Parcelas / Contas fixas, valor por mês e "Ver como tabela" depois do gráfico. |
| UXB-021 fechamento repetido na C02 | Resolvido | Uma linha só, "Fecha em 03/01 (52 dias) · Vence em 10/01" (quebra feia em UX2B-013). |
| UXB-022 ações da T02 | Resolvido | Ordem fixa (Editar, Mudar categoria, Excluir) e Excluir como secundário nos dois tipos. |
| UXB-023 chip no escuro | Resolvido | "Todos" com contorno claro no escuro (`T01__phone__dark.png`). |
| UXB-024 "Status: Todas" | Resolvido | "Todos" no Status (`T01-filtros__phone__light__pagina.png`). |
| UXB-025 toque no cartão | Resolvido | Cartão já selecionado abre a fatura (`features/cards/CardsScreen.tsx:145`). |

## Achados

### UX2B-001 — Renda do mês em dobro no Orçamento; metas das faixas e da Reserva infladas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S1 | Dinheiro / estados | P01, P02 (e, a confirmar, o Início, de outra frente) | todos |

**O que se vê:** em `P01__phone__light.png`, o centro do anel diz "Renda do mês R$ 14.120,00". A T01 do mesmo mês mostra "Entradas R$ 7.270,00" (Salário R$ 6.850,00 + Freela R$ 420,00). A diferença é exatamente um segundo salário: 7.270 + 6.850 = 14.120. As metas saem todas do valor errado: "R$ 1.769,60 de R$ 7.060,00" (Necessidades), "R$ 4.236,00" (Desejos), "R$ 2.824,00" (Poupança). Na P02 (`P02__phone__light__pagina.png`), a meta sugerida vira "6× a meta de Necessidades do mês (R$ 7.060,00)" e "Faltam R$ 42.360,00", o dobro do que seria com a renda real. A pessoa vê que ainda tem 75% de Necessidades livres quando na verdade usou metade.
**O que a spec pede:** UX §3 P01 (centro com a renda do mês; faixas sobre a renda); PRD RN-44 e seguintes (50/30/20 sobre a renda); princípio 4 do PRODUCT.md (dinheiro sem ambiguidade).
**Causa provável:** `packages/domain/src/budget.ts:115-138` soma a ocorrência da receita fixa "Salário, todo dia 5" como **não realizada** (nenhum lançamento tem `recurrenceId` igual ao da conta fixa), e `:140-158` soma o lançamento "Salário" de R$ 6.850,00 como receita **variável**, porque ele não está ligado à conta fixa. A ligação só existe por `recurrenceId` + `recurrenceDate` (`packages/domain/src/recurrence.ts:118-121`, `:128-150`). No seed, o salário foi lançado à mão e a receita fixa foi cadastrada depois (`apps/web/ux-audit/capture.mjs:283`, `:312`). É o mesmo caminho de quem registra o salário pelo Q01 em vez de confirmar a ocorrência, e a T01 não mostra a ocorrência prevista do dia 5 para a pessoa confirmar. A confirmar: se a spec prevê outro caminho para ligar um lançamento manual à receita fixa; o mecanismo da soma dupla está confirmado no código.
**Correção sugerida:** no `monthlyIncome`, considerar realizada a ocorrência de receita fixa quando houver, no mesmo mês, receita manual da mesma conta com o mesmo valor (ou a mesma descrição), e não contá-la de novo; ou, ao salvar uma receita no Q01 que casa com uma receita fixa ainda não recebida do mês, perguntar "É o Salário deste mês?" e gravar `recurrence_id` e `recurrence_date`. Teste de regressão com o caso do seed (renda esperada R$ 7.270,00).

### UX2B-002 — Nome do lançamento cortado em 10 a 12 letras no celular
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout / leitura | T01, T01-filtros (a C02 usa o mesmo componente) | small, phone (claro e escuro); tablet e desktop ficam bem |

**O que se vê:** em `T01__phone__light__pagina.png`, as linhas mostram "PIX ENVIAD…", "PAG*IFOOD …", "Restaurante…", "Spotify e Net…", "Padaria São J…", "Mercado Bo…" e "Freela de re…". A coluna do texto tem cerca de 105 px a 390 px, menos de um terço da linha. Não dá para distinguir "Mercado Bom Preço" de outro mercado, nem saber do que é o PIX, e é justamente o que a pessoa precisa para conferir. No desktop (`T01__desktop__light.png`) o nome sai inteiro.
**O que a spec pede:** UX §5.19 TransactionRow (título e meta); agente §3 item 4 (conteúdo truncado). A correção da UXB-003 pedia reticências **ou** recorte em 2 linhas.
**Causa provável:** `apps/web/src/app/shell.css:727-736` força uma linha (`white-space: nowrap`) no título e na meta. Na mesma linha ficam o ícone de 40 px com anel (`ui/ui.css:1086-1098`), o valor em 16 px com tabulares (`ui/TransactionRow.tsx:136-138`) e o botão "…" de 48 px; sobra pouco para o texto.
**Correção sugerida:** título em até 2 linhas, cortando por palavra (`display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: normal`), e a meta continua numa linha com reticências. Se quiser manter uma linha, reduzir o espaço morto: valor em `--font-size-label` e o "…" com alvo de 48 px sobreposto à margem do card (área de toque invisível), em vez de ocupar 48 px de largura visível.

### UX2B-003 — Abas do Planejar cortam "Fechar o mês" no celular
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout / navegação | P01, P02, P03, P04, vazio-P01, vazio-P02, vazio-P03 | small, phone (claro e escuro); tablet e desktop cabem |

**O que se vê:** em `P01__phone__light.png`, a quarta aba aparece como "Fechar c" e a 360 px como "Fecl" (`P01__small__light.png`). O trilho termina em corte reto na borda direita, sem o fim arredondado da pílula, e não há sinal de que a faixa rola. Na P04 (`P04__phone__light.png`) a faixa rolou para mostrar a aba ativa, e agora "Orçamento" vira "mento" à esquerda.
**O que a spec pede:** UX §2.1 (abas internas do Planejar, D-076) e §5.9 SegmentedControl; agente §3 item 4 (conteúdo cortado sem reticências).
**Causa provável:** `apps/web/src/app/shell.css:1929-1946` (`.plan-tabs` com `overflow-x: auto` e barra de rolagem escondida) e o rótulo em 16 px com `padding: 0 var(--space-3)` (`ui/ui.css:438-450`). Os quatro rótulos não cabem em 350 px.
**Correção sugerida:** fazer as quatro caberem em 320 px úteis: rótulos em `--font-size-label` (14 px), `padding: 0 var(--space-2)`, abas com `flex: 1` e o rótulo da quarta encurtado para "Fechar mês" (`i18n/pt-BR.ts:941`, registrar na UX §6.4). Se ainda faltar a 360 px, um degradê de borda indicando a rolagem, nunca o corte seco.

### UX2B-004 — Totais do dia e "Saídas" do resumo seguem regras diferentes
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Dinheiro / consistência | T01, T01-filtros | todos |

**O que se vê:** em `T01__phone__light__pagina.png`, o dia "Hoje" soma "−R$ 1.398,45" e o resumo do mês mostra "Saídas R$ 1.919,60". As contas não fecham por dois motivos. (1) O total do dia inclui as compras no cartão de hoje (Notebook 1/6 R$ 599,85, Restaurante R$ 325,00, Spotify R$ 59,90), que contam na fatura de dez/2026. "Saídas" segue o mês de impacto e não as inclui. E, dentro do mesmo dia, a parcela 1/6 entra no total enquanto a 2/6 fica de fora "porque conta no mês da fatura", embora a 1/6 também seja de dezembro. (2) O total do dia inclui o "PAG*IFOOD" (R$ 27,90, importado sugerido), e "Saídas" não inclui; o "PIX ENVIADO" (importado novo) entra nos dois. As duas linhas têm o mesmo selo "Conferir".
**O que a spec pede:** D-084 item 2 (T01 pelo mês de impacto, como o Início e a P01); princípio 4 do PRODUCT.md (valor e mês de impacto sempre claros).
**Causa provável:** `apps/web/src/features/transactions/list.ts:275-301` (`groupByDay`) soma tudo o que não é cancelado nem previsto, pela data da compra. O resumo vem de `monthSpent` pelo mês de impacto (`TransactionsScreen.tsx:215-228`, `:301-307`), que usa o `counts` do domínio e exclui o `review_state = 'suggested'` (`packages/domain/src/budget.ts:71-77`).
**Correção sugerida:** uma regra só para os dois números. O mais simples: no total do dia, aplicar o mesmo filtro do `counts` (fora o `suggested`) e mostrar as compras de cartão à parte ("no cartão R$ 984,75"), sem somá-las às saídas do dia. Alternativa: tirar o total de saídas do cabeçalho do dia. Ver também "Contradições".

### UX2B-005 — Fatura futura mostra a parcela 2/6 sem "Prevista" e sob "Hoje"
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / parcelas | C02 | todos |

**O que se vê:** em `C02__phone__light.png` (fatura de jan/2027, "Futura"), a única linha é "Notebook · Crédito · 2/6 · −R$ 599,83", sem selo, sob o cabeçalho "Hoje". Na T01, a mesma parcela tem o selo "Prevista". Numa fatura que só vence em 10/01, "Hoje" sem o selo dá a entender que a parcela já foi cobrada.
**O que a spec pede:** PRD RN-23 e D-034 (parcela k > 1 em fatura futura ou aberta é prevista); UX §3 C02 (parcelas com selo); a própria nota da tela ("mostra parcelas e contas fixas já previstas").
**Causa provável:** `apps/web/src/features/cards/InvoiceScreen.tsx:190-196` chama `toRow(row, categoria, today, false, true)`: o quarto argumento, `planned`, está fixo em `false`. A T01 e a T02 calculam com `isPlannedInstallment` (`features/transactions/list.ts:114-127`; `TransactionDetailScreen.tsx:184-189`). O cabeçalho vem de `dayLabel(group.date, today)` (`InvoiceScreen.tsx:183-185`), pela data da compra.
**Correção sugerida:** passar `isPlannedInstallment(row, view.period.closingDate, today)` no `toRow` da C02. Para a fatura futura, trocar "Hoje" pela data da compra em `dd/mm/aaaa` ("Compra em 12/11/2026"), porque a referência da tela é a fatura, não o dia de hoje.

### UX2B-006 — O valor da renda invade os anéis internos do orçamento
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Componentes / gráficos | P01 | todos (pior em small e phone) |

**O que se vê:** em `P01__small__light.png` e `P01__phone__light.png`, "R$ 14.120,00" é mais largo que o miolo do anel e passa por cima do anel do meio (Desejos) e do interno (Poupança), nos dois lados. Hoje esses arcos estão em 0% e o traço é cinza claro, então ainda se lê. Quando Desejos ou Poupança passarem de 25%, o arco colorido vai correr por baixo dos dígitos "R$" e "00".
**O que a spec pede:** UX §5.15 BudgetRing (centro com a renda); agente §3 item 4 (texto que vaza do contêiner).
**Causa provável:** `apps/web/src/ui/BudgetRing.tsx:61-63` (anel de 240 px, traço de 12 px e passo de 18 px) deixa um miolo livre de cerca de 144 px de diâmetro. O centro usa `data-size="display"` (32 px, peso 800, `BudgetRing.tsx:134-140`; `ui/ui.css:297-301`), e um valor de 5 dígitos mede cerca de 200 px. A camada do centro ocupa o anel inteiro (`ui/ui.css:958-966`), sem limitar a largura ao miolo.
**Correção sugerida:** limitar a largura do centro ao miolo (`max-width: 140px`) com o valor em `--font-size-title` (22 px) e reduzir mais em valores longos; ou tirar o valor do centro e pô-lo logo acima do anel, com o rótulo "Renda do mês" (a UXB-015 só pedia que não aparecesse duas vezes).

### UX2B-007 — Título do Futuro cortado no TopBar
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Microcopy / layout | P03, vazio-P03 | small, phone (claro e escuro); desktop e tablet cabem |

**O que se vê:** em `P03__phone__light.png`, o TopBar diz "Futuro: parcelas e contas fi…", e o título deixa de ficar centralizado como nas outras telas. Logo abaixo, a aba "Futuro" já diz onde a pessoa está.
**O que a spec pede:** UX §4.0 / DESIGN.md Navigation (título do TopBar centralizado, 17 px); agente §3 item 4 (texto cortado).
**Causa provável:** `apps/web/src/i18n/pt-BR.ts:1106` (`P03: 'Futuro: parcelas e contas fixas'`) é longo demais para o TopBar com dois ícones; `ui/ui.css:1201-1212` corta com reticências (correto, mas é o último recurso).
**Correção sugerida:** título "Futuro" no TopBar (como "Reserva de emergência" e "Orçamento 50/30/20", que cabem) e, se quiser o complemento, "Parcelas e contas fixas dos próximos 12 meses" como linha de apoio no card do gráfico.

### UX2B-008 — Fatura sem a barra das faixas 50/30/20
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Conteúdo / spec | C02 | todos |

**O que se vê:** o cabeçalho da fatura (`C02__desktop__light.png`) tem selo, total, datas e a nota da fatura futura, mas nenhuma barra mostrando quanto da fatura é Necessidades, Desejos ou Poupança. Numa fatura aberta com Restaurante e Spotify (Desejos) e Notebook (sem faixa), é a informação que liga o cartão ao orçamento.
**O que a spec pede:** UX §3 C02 ("barra das faixas 50/30/20 dentro da fatura").
**Causa provável:** `apps/web/src/features/cards/InvoiceScreen.tsx:139-167` não monta nenhuma barra; não há uso de `Bars` ou `ProgressBar` no arquivo.
**Correção sugerida:** uma barra empilhada fina abaixo do total (Necessidades · Desejos · Poupança · Sem faixa), com padrão além da cor e legenda em texto ("Desejos R$ 384,90 · Sem faixa R$ 599,85"), reaproveitando o componente das faixas do Início.

### UX2B-009 — Lima demais na T01: selos "Conferir" disputam com a seleção
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Fidelidade ao visual | T01, T01-filtros | todos |

**O que se vê:** em `T01-filtros__phone__light.png`, a mesma tela tem seis áreas de lima: "Filtros" aberto, chip "Todos", dois selos "Conferir", a aba ativa e o FAB. O selo de estado fica com o mesmo peso da seleção e da ação principal.
**O que a spec pede:** DESIGN.md, "A regra da lima rara" (lima marca escolha ou próxima ação); UX §4.0.
**Causa provável:** `apps/web/src/ui/ui.css:1135-1141` usa `--status-info-bg`, que é `--lime-400` (`styles/tokens.css:103`).
**Correção sugerida:** selo "Conferir" em `--accent-soft` (lima suave, #E3F5A8) ou em `--surface-inset` com texto em negrito, deixando a lima cheia só para seleção, FAB e aba ativa.

### UX2B-010 — Fatura futura: "Vence em" sozinho no fim da linha
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tipografia | C02 | small, phone (claro e escuro) |

**O que se vê:** em `C02__phone__light.png`, "Fecha em 03/01 (52 dias) · Vence em" fica numa linha e "10/01" desce sozinho para a seguinte.
**O que a spec pede:** agente §3 item 3 (quebras ruins, palavras soltas).
**Causa provável:** `apps/web/src/features/cards/InvoiceScreen.tsx:147-150` junta as duas partes numa string só.
**Correção sugerida:** cada parte num `<span>` com `white-space: nowrap`, para a quebra cair no " · ". Ou duas linhas de propósito: "Fecha em 03/01 (52 dias)" e "Vence em 10/01".

### UX2B-011 — Detalhe da parcela repete dados e esconde o total da compra
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Hierarquia / conteúdo | T02-parcela | todos |

**O que se vê:** em `T02-parcela__phone__light__pagina.png`, "1 de 6" aparece no herói e na primeira linha do `<dl>`, e "Descrição: Notebook" repete o título do herói. A lista "Parcelas" mostra só "2/6 · jan/2027", sem valor e sem link: não dá para abrir as outras parcelas, e a diferença de centavos da 1/6 (R$ 599,85 contra R$ 599,83) e o total da compra (R$ 3.599,00) não aparecem em lugar nenhum.
**O que a spec pede:** UX §3 T02 (lista de parcelas com a atual destacada); P4 (a resposta antes dos detalhes).
**Causa provável:** `apps/web/src/features/transactions/TransactionDetailScreen.tsx:287` (linha Parcela) e `:329` (o mesmo texto no herói); `:305` (Descrição sempre); `:343-351` (itens `<li>` sem valor e sem `Link`).
**Correção sugerida:** tirar "1 de 6" do herói (ou a linha do `<dl>`); esconder "Descrição" quando for igual ao título; cada parcela como link para o próprio detalhe, com o valor à direita; e uma linha "Compra de R$ 3.599,00 em 6x" no topo do card de parcelas.

### UX2B-012 — Reserva sem meta: "Definir meta" e "Ajustar meta" fazem o mesmo, com dois vazios iguais
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Hierarquia / estados | vazio-P02 | todos |

**O que se vê:** em `vazio-P02__phone__light__pagina.png`, o primeiro card tem "Definir meta" (primário), e o segundo, "Ajustar meta" e "Editar valor já guardado". "Definir" e "Ajustar" abrem a mesma folha. Embaixo vem outro estado vazio com o mesmo escudo ("Nenhum aporte registrado"), e a tela fica com dois ícones de escudo e três blocos que pedem a mesma coisa.
**O que a spec pede:** UX §3 P02, estados (sem meta: anel tracejado + texto + ação); agente §3 item 2 (um elemento dominante).
**Causa provável:** `apps/web/src/features/budget/ReserveScreen.tsx:134-143` (vazio com "Definir meta" → `open('goal')`) e `:192-199` ("Ajustar meta" → `open('goal')`, mostrado sempre). O vazio do histórico vem de `:205-210`.
**Correção sugerida:** sem meta, esconder "Ajustar meta" (fica só "Definir meta"); o vazio do histórico vira uma linha de texto sem ícone ("Nenhum aporte registrado."), como a UXB-017 sugeria.

### UX2B-013 — Vazio do Orçamento empurra "Cadastrar renda" para fora da tela a 360 px
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Ergonomia / estados | vazio-P01 | small |

**O que se vê:** em `vazio-P01__small__light.png`, os três anéis vazios ocupam 240 px, depois vem o ícone de pizza, e o botão "Cadastrar renda" fica atrás da barra de abas. É preciso rolar para achar a única ação da tela.
**O que a spec pede:** UX §3 P01 estado sem renda (anéis vazios + texto + botão); P1/P2 (ação ao alcance); DESIGN.md (360×640 mostra a resposta e a ação sem rolar).
**Causa provável:** `apps/web/src/features/budget/BudgetScreen.tsx:179-200` desenha o `BudgetRing` grande e depois o `EmptyState` com ícone próprio.
**Correção sugerida:** sem renda, anel `size="sm"` (96 px) ou sem o ícone do `EmptyState` (o anel já é a ilustração), para o botão subir.

### UX2B-014 — Cartão da C01 desalinhado da coluna
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout | C01 | todos |

**O que se vê:** em `C01__phone__light.png` e `C01__desktop__light.png`, a borda esquerda do cartão preto fica 6 px à direita dos cards "Fatura de dez/2026" e "Próximas faturas".
**O que a spec pede:** agente §3 item 4 (alinhamentos consistentes).
**Causa provável:** `apps/web/src/app/shell.css:364` (`.cards-carousel { padding: 6px 6px … }`), colocado para o contorno de seleção caber (UXB-010).
**Correção sugerida:** compensar com `margin-inline: -6px` no carrossel, mantendo o espaço do contorno sem deslocar o cartão.

### UX2B-015 — Palavras soltas em títulos e frases curtas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Tipografia | vazio-T01, P04, vazio-P02 | phone, small |

**O que se vê:** "Nenhum lançamento em novembro / 2026" (`vazio-T01__phone__light.png`), "Nenhuma pendência. O mês pode ser / fechado." (`P04__phone__light.png`) e "Defina uma meta para acompanhar o / progresso" (`vazio-P02__phone__light__pagina.png`), com uma palavra sozinha na última linha.
**O que a spec pede:** agente §3 item 3 (palavras soltas).
**Causa provável:** `apps/web/src/ui/ui.css:556-561` (`.empty h2`) e os parágrafos da P04 sem `text-wrap`.
**Correção sugerida:** `text-wrap: balance` em `.empty h2` e `text-wrap: pretty` em `.empty p` e `.detail-note`/parágrafos de card.

### UX2B-016 — Poupança sem percentual, ao contrário das outras faixas
| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Consistência | P01 | todos |

**O que se vê:** em `P01__phone__light__pagina.png`, Necessidades e Desejos dizem "R$ 1.769,60 de R$ 7.060,00 · 25%" e "R$ 0,00 de R$ 4.236,00 · 0%". Poupança diz "Poupado R$ 0,00 de R$ 2.824,00", sem o percentual e com outro verbo.
**O que a spec pede:** UX §3 P01, item 2 (legenda "R$ 1.200 de R$ 2.400 · 50%" por faixa).
**Causa provável:** `apps/web/src/i18n/pt-BR.ts:379` (`'budget.saved': 'Poupado {valor} de {meta}'`), usada só na Poupança.
**Correção sugerida:** mesmo formato nas três ("R$ 0,00 de R$ 2.824,00 · 0%"), deixando o "Poupado" para o status, se for preciso.

## Contradições e lacunas na spec

- **Total do dia na T01:** a D-084 levou o resumo da T01 para o mês de impacto, mas a spec não diz o que o cabeçalho do dia soma (data da compra ou impacto, com ou sem cartão, com ou sem importados sugeridos). O código hoje mistura as duas regras (UX2B-004).
- **Lançamento manual × receita fixa:** a spec não diz como uma receita lançada à mão se liga à receita fixa do mês. Sem isso, a renda do orçamento soma as duas (UX2B-001). Falta uma regra (casamento automático ou pergunta no Q01).
- **Cabeçalho de dia na fatura futura:** a UX §3 C02 pede "lista de lançamentos por dia", mas numa fatura futura o dia é o da compra, e "Hoje" confunde (UX2B-005). Vale decidir se a C02 agrupa pela data da compra ou mostra a data em cada linha.
- **Rótulo da quarta aba:** a UX §2.1 e a D-076 fixam "Fechar o mês", que não cabe a 360 px com as outras três (UX2B-003). Encurtar para "Fechar mês" muda a §6.4.
- **P03 vazio sem ação:** continua sem ação no vazio, como apontado na rodada anterior; a US-63 pede vazio "convidando a agir".

## O que está bom

- Parcelas na T01: selo "Prevista" tracejado, ordem 1/6…6/6 e o total do dia sem as previstas, como a RN-23 pede.
- Cartão sólido, datas com rótulo e "Pagar a fatura de dez/2026" como secundário na fatura futura: a C01/C02 agora é honesta sobre o que dá para pagar.
- Abas internas do Planejar, P04 com resumo e P03 com legenda, valores e tabela: a navegação do Planejar está completa.
- Sinais e cores do dinheiro seguem a P6 em todas as telas (despesa com "−" neutro, receita com "+" verde), também no tema escuro.
- O tablet (768 px) fica limpo em todas as telas desta parte, sem rolagem horizontal nem coluna estranha.
