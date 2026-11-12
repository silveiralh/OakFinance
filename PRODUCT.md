# Product

<!-- impeccable:product-schema 1 -->

> Resumo das specs para a skill Impeccable (D-100). As specs em `docs/specs/` vencem este arquivo; se divergirem, corrija aqui no mesmo PR.

## Platform

web

## Users

Duas pessoas, jovens adultas, cada uma com a sua conta, 100% separada: nada é compartilhado entre elas. Uma usa Android (Chrome) e a outra iPhone (Safari, com o app instalado na Tela de Início, iOS 16.4 ou mais novo); as duas também abrem no computador. O uso típico é no celular, com uma mão, logo depois de pagar algo (no caixa, no carro, no ônibus), muitas vezes sem rede. No computador, a pessoa importa extratos, confere lançamentos e planeja o mês.

## Product Purpose

PWA de finanças pessoais que responde, ao abrir: **"Quanto já gastei este mês e como está minha conta?"** (D-081). O Início mostra o gasto do mês, o saldo nas contas, o que ainda vai sair e a saúde do mês pelo 50/30/20 da renda. Sucesso é registrar cada gasto na hora, sem atrito, e fechar o mês sabendo para onde foi o dinheiro.

## Positioning

- Lançamento rápido em até 3 toques e menos de 5 s, também sem internet.
- Offline-first: tudo funciona no aparelho e sincroniza depois; a nuvem é a fonte da verdade.
- Compra no cartão cai na fatura pela data de fechamento e conta no mês do vencimento da fatura.
- Regras de categoria que aprendem com o uso, determinísticas e locais, sem IA.
- Custo zero de operação, sem anúncio e sem venda de dados.

## Operating Context

- Entradas: lançamento manual (Q01), importação de extrato OFX/CSV (I03; Banco do Brasil e Nubank) e nota fiscal NFC-e da SEFAZ-PR lida pelo QR (I04).
- Conferência de importados contra os lançamentos manuais (I05), com regras de categoria (I06).
- Orçamento 50/30/20 sobre a renda, com limiares de aviso configuráveis (padrão 80% e 100%), reserva de emergência, visão do futuro (faturas e contas fixas) e fechamento do mês (P01–P04).
- Lembretes por Web Push.
- Open Finance (Pluggy) fica para a v2 (D-080) e está escondido no app.

## Capabilities and Constraints

- Dinheiro sempre em centavos inteiros; datas no fuso America/Sao_Paulo.
- Textos em pt-BR, vindos da UX §6 (`apps/web/src/i18n/pt-BR.ts`); termos do glossário da UX §0.2 ("lançamento", "meio", "guardar"; nunca "transação", "forma de pagamento", "cofrinho").
- Datas: "Hoje", "Ontem" e "Amanhã" nas listas; as demais em `dd/mm/aaaa`. Valores `R$ 1.234,56`, com espaço não separável.
- Telas e IDs (ON, H, Q, T, C, P, I, S, G) na UX §3; navegação pela D-076/D-089 (4 abas, FAB, avatar com o menu da conta).
- Repositório público: nenhum dado real, nome, e-mail ou número de conta em código, docs ou exemplos.

## Brand Commitments

- Nome **OakFinance**, marca só tipográfica: sem árvore, carvalho, folha, raiz ou qualquer figura (decisão do dono).
- Tom sério e direto, para jovens adultos; nada lúdico, sem mascote.
- Sem "!" e sem emoji em nenhum texto da interface.
- Identidade visual escolhida pelo dono: ver `DESIGN.md` (D-022 a D-026).

## Evidence on Hand

- Specs completas em `docs/specs/` (PRD, tech, UX, revisão) e decisões em `docs/DECISIONS.md`.
- Auditoria de UX com capturas reais: `docs/ux-audit/` e o roteiro `apps/web/ux-audit/capture.mjs`.
- Fixtures anonimizadas de extratos e NFC-e nos `fixtures/` dos pacotes.
- Não há depoimentos, clientes, números de uso nem marca registrada; não invente nada disso.

## Product Principles

1. A resposta vem primeiro: o número que a pessoa procura aparece sem rolar, na primeira tela.
2. Registrar é mais importante que analisar: nada pode atrasar o lançamento rápido.
3. Offline é normal, não erro: estado sem rede é calmo, informativo e nunca vermelho.
4. Dinheiro sem ambiguidade: valor, sinal, data e mês de impacto sempre claros; despesa com sinal, em cor neutra.
5. Contenção: uma ação primária por tela, padrões que a pessoa já conhece, nada decorativo que concorra com os números.

## Accessibility & Inclusion

WCAG 2.1 AA nos dois temas (claro e escuro): contraste verificado nos tokens, alvos de toque de 48 px ou mais, foco visível, informação nunca só pela cor (texto ou ícone junto), movimento reduzido respeitado, texto mínimo de 13 px e campos com 16 px (evita o zoom do iOS). O axe roda no CI sem violação séria.
