---
name: OakFinance
description: Finanças pessoais no celular, claras e diretas, em menta, lima e preto.
colors:
  mint-bg: "#EEFDE0"
  surface: "#FFFFFF"
  ink: "#0B0D0A"
  ink-secondary: "#3A3F36"
  ink-tertiary: "#4F5649"
  border-strong: "#6B7265"
  lime: "#C0E45C"
  lime-pressed: "#AED246"
  lime-soft: "#E3F5A8"
  link: "#3A5C0B"
  band-needs: "#0F766E"
  band-wants: "#7A55D3"
  band-savings: "#4D7C0F"
  success-fg: "#3A5C0B"
  success-bg: "#E6F7CF"
  warning-fg: "#804400"
  warning-bg: "#FFF1D6"
  danger-fg: "#A3301F"
  danger-bg: "#FFE3DE"
  dark-bg: "#0B0D0A"
  dark-card: "#1C1F1A"
  dark-raised: "#2A2D27"
  dark-text: "#F2F7EC"
  dark-text-secondary: "#C4CCBB"
typography:
  hero:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 9vw, 2.875rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  display:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.15
  title:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1.3
  heading:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 800
    lineHeight: 1.3
  body:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
  caption:
    fontFamily: "Nunito Variable, Nunito, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.3
rounded:
  xs: "6px"
  field: "16px"
  card: "20px"
  sheet: "28px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
  button-accent:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  card-month:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "20px"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "48px"
  chip-selected:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    height: "48px"
  tabbar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "64px"
  fab:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "52px"
---

# Design System: OakFinance

> Registro do visual atual para a skill Impeccable (D-100). Fonte da verdade dos valores: `apps/web/src/styles/tokens.css`; regras: UX §4.0 e §5 e as decisões D-022 a D-026, D-084, D-088 a D-090. Se este arquivo divergir delas, vale a spec, e este arquivo é corrigido no mesmo PR.

## Overview

**Creative North Star: "Caderneta clara"**

Um caderno de contas bem cuidado: fundo menta liso, folhas brancas por cima e tinta preta para o que importa. O número que a pessoa procura é sempre o elemento mais forte da tela; o resto recua. A lima aparece pouco e com intenção, para marcar o que está escolhido ou a próxima ação. O app é de **uso diário e rápido** (modo Operate): densidade média, padrões conhecidos de app de banco, nada que precise ser aprendido.

O cliente trocou o Aero (vidro, céu azul, brilho especular) por este visual em 06/11/2026 (D-023). Vidro, desfoque, gradiente, brilho e reflexo estão **rejeitados**, assim como qualquer figura de árvore, carvalho ou folha na marca.

**Key Characteristics:**
- Fundo menta liso, cards brancos sólidos, sem desfoque nem gradiente.
- Preto como cor de ação (botão primário, barra de abas, cartão do mês).
- Lima só para seleção, FAB, aba ativa e destaque pontual, sempre com texto preto.
- Uma família arredondada (Nunito) com pesos fortes nos números e títulos.
- Pílulas em tudo o que é tocável; cards com 20 px de raio.

## Colors

Paleta de três tintas (menta, preto e lima) sobre branco, com cores de faixa só para o 50/30/20.

### Primary
- **Tinta** (#0B0D0A): texto principal, valores, botão primário, barra de abas, cartão do mês no Início, ícone de categoria em círculo.

### Secondary
- **Lima** (#C0E45C): seleção (chip, segmentado, aba ativa), FAB, botão de destaque. Pressionado #AED246; suave #E3F5A8. Nunca como texto nem como borda sobre branco (1,4:1).

### Neutral
- **Menta** (#EEFDE0): fundo de toda tela, liso. TopBar sem fundo próprio.
- **Branco** (#FFFFFF): cards, chips, campos, sheets internos.
- **Tinta secundária** (#3A3F36) e **terciária** (#4F5649): rótulos e metadados.
- **Borda forte** (#6B7265): contorno de campos e controles (≥ 3:1).

### Faixas e estados
- **Necessidades** (#0F766E), **Desejos** (#7A55D3), **Poupança** (#4D7C0F): só nas barras e anéis do 50/30/20, sempre com ícone e texto.
- **Receita/positivo** #3A5C0B sobre #E6F7CF; **atenção** #804400 sobre #FFF1D6; **perigo** #A3301F sobre #FFE3DE.
- **Escuro:** fundo #0B0D0A, cards #1C1F1A, superfície elevada #2A2D27 (cartão do mês), texto #F2F7EC e #C4CCBB; faixas #5FD4C3, #9D82F5 e #C0E45C; seleção com contorno #F2F7EC.

### Named Rules
**A regra da lima rara.** A lima marca escolha ou próxima ação; se mais de um elemento de lima disputa a atenção numa tela, um deles está errado.

**A regra do sinal.** Despesa leva "−" e cor neutra; receita leva "+", ícone e verde. Cor nunca é o único sinal.

## Typography

**Display Font:** Nunito Variable (com system-ui)
**Body Font:** Nunito Variable (com system-ui)

**Character:** arredondada e amigável, mas firme: os pesos 800 dão autoridade aos números sem parecer brinquedo.

### Hierarchy
- **Hero** (800, clamp(2.25rem, 9vw, 2.875rem), 1,15, −0,01em): o número principal do Início ("Gasto em {mês}"); no `lg` cresce até 48–72 px.
- **Display** (800, 32 px, 1,15): valor do lançamento rápido, total da fatura, % da reserva.
- **Title** (800, 22 px, 1,3): título de tela.
- **Heading** (800, 17 px, 1,3): título de card e de seção (`h2`).
- **Body** (500, 16 px, 1,5): corpo e campos (16 px evita o zoom do iOS).
- **Label** (600, 14 px): rótulos, chips, botões.
- **Caption** (500, 13 px): metadados; 13 px é o mínimo absoluto, também nas abas.

### Named Rules
**A regra dos números tabulares.** Todo valor em dinheiro usa `tnum` e `lnum` e um espaço não separável entre "R$" e o número; valor nunca quebra em duas linhas.

**A regra do sentence case.** Títulos e botões só com a primeira letra maiúscula; nada de Title Case nem `text-transform: capitalize`.

## Layout

Uma coluna. No celular, margem lateral e padding de card de 20 px, ritmo de 4 em 4 px (8, 12, 16, 20, 24, 32, 48). A barra de abas flutua a 12 px do fundo mais a área segura, e o conteúdo reserva `64px + env(safe-area-inset-bottom) + 48px` no fim da rolagem. No `lg` (D-026), a coluna usa a largura toda e ganha respiro, com barra lateral branca no lugar das abas; nada de duas colunas. A primeira tela de 360×640 precisa mostrar a resposta da tela e a ação principal sem rolar.

## Elevation & Depth

Profundidade por camada de cor (menta, branco, preto), não por sombra. Sombras só discretas e funcionais.

### Shadow Vocabulary
- **Repouso** (`box-shadow: 0 1px 2px rgba(11, 13, 10, 0.04)`): cards.
- **Leve** (`box-shadow: 0 2px 12px rgba(11, 13, 10, 0.05)`): cards destacados.
- **Flutuante** (`box-shadow: 0 12px 32px rgba(11, 13, 10, 0.14)`): sheets e diálogos.
- **FAB** (`box-shadow: 0 6px 18px rgba(11, 13, 10, 0.2)`).

### Named Rules
**A regra do sem vidro.** Nenhum `backdrop-filter`, gradiente, brilho especular ou reflexo em superfície nenhuma.

## Shapes

Tudo o que é tocável é pílula (999 px): botões, chips, busca, barra de abas, FAB. Cards com raio 20 px, campos e teclas 16 px, sheets e diálogos 28 px nos cantos de cima, tags pequenas 6 px. Ícones Lucide com traço 2 (2,5 no ativo), em 20, 24 ou 32 px.

## Components

### Buttons
- **Shape:** pílula (999 px), altura mínima 48 px.
- **Primary:** fundo preto #0B0D0A e texto branco; no escuro, pílula lima com texto preto. Uma por tela.
- **Secondary:** pílula branca com contorno sutil e texto preto.
- **Accent:** lima com texto preto, para o destaque pontual (ex.: "Novo lançamento" no cartão do mês).
- **Ghost:** texto preto em negrito, sem sublinhado.
- **Destrutivo:** texto coral, não vermelho cheio; a confirmação fica no diálogo.
- **Focus:** anel de 2 px branco + 2 px preto (no escuro, lima #D4F07E).

### Chips
- **Style:** pílula branca, texto preto 14 px, ícone com tamanho fixo à esquerda, nome inteiro numa linha.
- **Selected:** fundo lima, texto preto **e** contorno de 2 px na cor do texto ou check; nunca só a cor.
- **Grupos:** fluem conforme a largura (`flex-wrap`), sem grid fixo de colunas.

### Cards / Containers
- **Corner Style:** 20 px.
- **Background:** branco (escuro #1C1F1A); o cartão do mês é preto (escuro #2A2D27) com texto branco.
- **Shadow Strategy:** Repouso (ver Elevation).
- **Internal Padding:** 20 px, filhos empilhados com 12 px.

### Inputs / Fields
- **Style:** fundo branco, borda 1 px #6B7265, raio 16 px, texto 16 px.
- **Focus:** anel de foco do sistema (ver Buttons).
- **Error:** mensagem coral abaixo do campo, só depois de a pessoa digitar.
- **Select:** sempre com seta (chevron) visível.

### Navigation
- **Celular:** barra de abas flutuante preta em pílula, quatro abas (Início, Lançamentos, Cartões, Planejar) com rótulo de 13 px e aba ativa em lima, FAB lima de 52 px no meio. Avatar com as iniciais no topo das abas abre a folha "Sua conta" (Configurações, Importar extrato, Ler nota fiscal, Sair). Subtelas têm Voltar no TopBar; título do TopBar centralizado, 17 px, 800.
- **`lg`:** barra lateral branca, item ativo em pílula lima.
- **Planejar:** abas internas em controle segmentado (Orçamento, Reserva, Futuro, Fechar o mês).

### Lançamento rápido (Q01)
Folha com o valor em Display no topo, foco no valor ao abrir, teclado numérico de teclas de 48 px junto do botão **Lançar** num rodapé fixo, categorias em pílulas logo abaixo do valor; tudo visível sem rolar em 360×640.

## Do's and Don'ts

### Do:
- **Do** mostrar a resposta da tela primeiro e sem rolar em 360×640.
- **Do** usar pílula preta para a ação primária e no máximo uma por tela.
- **Do** marcar seleção com lima **e** contorno ou check.
- **Do** escrever valores como `R$ 1.234,56` com espaço não separável e números tabulares.
- **Do** escrever datas recentes como "Hoje", "Ontem" e "Amanhã" e as demais em `dd/mm/aaaa`.
- **Do** usar os textos da UX §6.4 (pt-BR, sentence case, sem "!" e sem emoji).
- **Do** manter estados offline calmos, em tom neutro ou de informação.

### Don't:
- **Don't** usar vidro, desfoque, gradiente, brilho ou reflexo (rejeitados na D-023).
- **Don't** usar lima como texto ou borda sobre branco.
- **Don't** usar vermelho para despesa nem para offline.
- **Don't** pôr figura de árvore, carvalho, folha ou mascote na marca ou nas telas.
- **Don't** usar texto abaixo de 13 px nem campo abaixo de 16 px.
- **Don't** usar Title Case, `text-transform: capitalize` ou caixa alta em frases.
- **Don't** criar duas colunas no `lg` nem limitar a largura a 1200 px.
- **Don't** colocar mais de uma ação de destaque (lima ou preta) competindo na mesma área.
