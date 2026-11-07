# RELEASE — checklist de lançamento do MVP (T-099)

> Repositório público: nada de segredos, e-mails, nomes ou dados reais neste arquivo.
> Conferido em 07/11/2026, em `main`. Fonte dos status: `docs/TASKS.md`; detalhes de cada entrega: `docs/HANDOFF.md` §7.

## 1. Resumo

- **58 de 65 histórias entregues.** As 7 restantes dependem de algo fora do alcance das sessões: a decisão do dono sobre a T-076 (Open Finance: US-45, US-46, US-47) e os arquivos reais do SETUP-14 (US-52, US-53 e US-54 com dados reais, US-56).
- Marcos: M1 (instalável e offline) e M4 (MVP completo) atingidos em código; M2 (uso diário com push) espera o SETUP-11 (chaves VAPID); M3 (bancos sem duplicar) espera a T-076, a T-077, a T-083 e o SETUP-13.
- Licença: **sem licença** (SETUP-15, D-072). O código é público para leitura, com todos os direitos reservados; não há arquivo `LICENSE`.

## 2. Definition of Done (PRD §7) — como cada item é conferido

| # | Item | Como é conferido | Estado |
|---|---|---|---|
| 1 | Cenários Gherkin viram testes | unitários (`unit`), integração (`db`, `fn`) e Playwright (`e2e`); matriz E01–E20 × histórias em `apps/web/e2e/README.md` | ok, com as lacunas da §3 |
| 2 | Testes citam RN e casos numéricos | nomes `RN-xx`/`US-xx` nos testes; revisão por tarefa | ok |
| 3 | Núcleo offline; rede degrada com a US-64 | E03, E20 e `offline.spec.ts`; G04, G09 e mensagens da UX §6.6 | ok |
| 4 | Verificado nos 3 ambientes com evidência | Playwright nos projetos `android`, `iphone` (WebKit) e `desktop` em todo PR; **evidência em aparelho real é do cliente** (§4) | pendente do cliente |
| 5 | Sem rolagem horizontal de 360 a 1440 px | E12 (`a11y.spec.ts`), com valores de 6 dígitos e textos longos | ok |
| 6 | TypeScript strict, lint, sem `any` novo | `lint-types` (Biome, `tsc`, `ci-greps`) | ok |
| 7 | Dinheiro só em centavos inteiros | `ci-greps` (sem `parseFloat`/`toFixed` fora de `money.ts`) e testes de domínio | ok |
| 8 | RLS em toda tabela com `user_id` | pgTAP de isolamento no `db` e E11 | ok |
| 9 | Nenhum segredo nem dado real | `secrets` (gitleaks + `ci-secrets`) em todo PR e gitleaks no histórico completo no nightly; fixtures sintéticas com README | ok |
| 10 | Acessibilidade AA | E12 com axe nos 2 temas, alvos de 48 px, foco visível, reduzir movimento | ok; leitor de tela no aparelho é do cliente (§4) |
| 11 | Desempenho | `perf.spec.ts` (5.000 lançamentos: recálculo < 200 ms, painel, lista e busca < 1,5 s, gravação < 200 ms parada) e orçamento de bundle no `check-build` | ok; gravação durante o sync no HANDOFF §5 |
| 12 | Textos pt-BR, datas e valores | `test/i18n.test.ts` contra a UX §6.4; sem "!" e sem emoji | ok |
| 13 | Migrações versionadas; funções com timeout e log limpo | `guard` (sem DDL destrutivo, migração mergeada intocável) e testes do `fn` | ok |
| 14 | Telemetria RN-104 | eventos `usage.*` na S11 (Diagnóstico) | ok nas histórias que pedem |
| 15 | Publicado sem custo novo | `deploy.yml` verde (backup → staging → produção → smoke) em Supabase Free e Cloudflare Pages | ok |
| 16 | Registro curto da entrega | `docs/HANDOFF.md` §7 (uma linha por tarefa) e o corpo de cada PR | ok |

## 3. Histórias

| US | História | Tarefas | Estado | Observação |
|---|---|---|---|---|
| US-01 | Entrar com a minha conta Google | T-010, T-019, T-034, T-035, T-095 | entregue |  |
| US-02 | Meus dados só meus | T-003, T-008, T-010, T-034, T-035 | entregue |  |
| US-03 | App instalável que abre sem internet | T-002, T-030 | entregue |  |
| US-04 | Lançar offline e sincronizar sozinho | T-009, T-011, T-031, T-032, T-033, T-044, T-045 | entregue |  |
| US-05 | App sempre de pé e dados que não somem | T-005, T-011, T-036, T-071, T-098 | entregue |  |
| US-06 | Instalação guiada no iPhone | T-037 | entregue |  |
| US-07 | Instalação guiada no Android e no computador | T-037 | entregue |  |
| US-08 | Configuração inicial em poucos minutos | T-065 | entregue |  |
| US-09 | Cadastrar minhas contas | T-038 | entregue |  |
| US-10 | Cadastrar meus cartões de crédito | T-039 | entregue |  |
| US-11 | Editar e arquivar contas e cartões | T-051 | entregue |  |
| US-12 | Lançamento rápido de despesa | T-027, T-040 | entregue |  |
| US-13 | Lançamento completo e edição | T-041, T-044 | entregue |  |
| US-14 | Excluir com desfazer | T-044, T-053, T-055 | entregue |  |
| US-15 | Ver, filtrar e buscar lançamentos | T-043, T-097 | entregue |  |
| US-16 | Transferir entre minhas contas | T-042 | entregue |  |
| US-17 | Compra no cartão cai na fatura certa | T-013, T-040, T-047 | entregue |  |
| US-18 | Ver minhas faturas | T-013, T-047 | entregue |  |
| US-19 | Registrar pagamento da fatura | T-013, T-048 | entregue |  |
| US-20 | Compra parcelada projetada | T-014, T-027, T-052 | entregue |  |
| US-21 | Editar ou cancelar compra parcelada | T-014, T-053 | entregue |  |
| US-22 | Estorno no cartão | T-042 | entregue |  |
| US-23 | Salário como receita fixa | T-015, T-016, T-050 | entregue |  |
| US-24 | Receita variável: recebida, a receber ou prevista | T-016, T-041 | entregue |  |
| US-25 | Contas fixas e assinaturas | T-015, T-054 | entregue |  |
| US-26 | Editar, pular e encerrar recorrências | T-015, T-055 | entregue |  |
| US-27 | Categorias padrão editáveis com faixa 50/30/20 | T-019, T-035, T-049 | entregue |  |
| US-28 | Regras que aprendem com minhas correções | T-019, T-056 | entregue |  |
| US-29 | Gerenciar regras | T-057 | entregue |  |
| US-30 | Painel "Quanto ainda posso gastar" | T-017, T-058, T-097 | entregue |  |
| US-31 | Acompanhar o 50/30/20 | T-016, T-059 | entregue |  |
| US-32 | Limite por categoria | T-016, T-059 | entregue |  |
| US-33 | Reserva de emergência | T-018, T-060 | entregue |  |
| US-34 | Ajustar como o cálculo funciona | T-017, T-061 | entregue |  |
| US-35 | Analisar o mês no computador | T-069 | entregue |  |
| US-36 | Fechar o mês | T-082 | entregue |  |
| US-37 | Central de avisos | T-062 | entregue |  |
| US-38 | Ativar notificações push | T-063 | entregue |  |
| US-39 | Lembrete diário para lançar | T-024, T-064 | entregue |  |
| US-40 | Lembretes de fatura | T-064 | entregue |  |
| US-41 | Lembretes de contas fixas e receitas | T-091 | entregue |  |
| US-42 | Alerta de faixa ou categoria perto do limite | T-092 | entregue |  |
| US-43 | Resumo semanal | T-024, T-092 | entregue |  |
| US-44 | Preferências de notificação | T-093 | entregue |  |
| US-45 | Conectar Banco do Brasil e Nubank | T-072, T-073, T-076, T-083 | parcial | parcial: domínio e funções prontos; telas de conexão bloqueadas (T-076, needs-owner) e validação real à espera do SETUP-13 |
| US-46 | Sincronizar transações do banco | T-074, T-075, T-076, T-083 | parcial | parcial: sync e webhook prontos (T-074/T-075); entra em uso com a T-076 e o SETUP-13 |
| US-47 | Estado da conexão e reconexão | T-075, T-077, T-083 | parcial | pendente: T-077 depende da T-076 |
| US-48 | Conciliação automática com meus lançamentos | T-020, T-078 | entregue |  |
| US-49 | Revisar importados | T-079 | entregue |  |
| US-50 | Parcelas, contas fixas e pagamentos de fatura vindos do banco | T-021, T-080 | entregue |  |
| US-51 | Desfazer uma conciliação errada | T-081 | entregue |  |
| US-52 | Importar extrato OFX do Banco do Brasil | T-022, T-084, T-085 | parcial | entregue com fixture sintética; OFX real anonimizado espera o SETUP-14 (T-085) |
| US-53 | Importar CSV (presets Nubank) | T-022, T-086, T-087 | parcial | entregue com presets sintéticos; confirmação com CSV real espera o SETUP-14 (T-087) |
| US-54 | Ler o QR code da nota (NFC-e) | T-023, T-089, T-090 | parcial | entregue com fallback; parser com páginas reais espera o SETUP-14 (T-090) |
| US-55 | Quando a nota não pode ser lida | T-023, T-088, T-089 | entregue |  |
| US-56 | Ver os itens da nota | T-090 | pendente | pendente: depende do parser real (T-090, SETUP-14) |
| US-57 | Ocultar valores | T-046 | entregue |  |
| US-58 | Tema claro/escuro e reduzir movimento | T-068, T-096 | entregue |  |
| US-59 | Exportar meus lançamentos em CSV | T-066 | entregue |  |
| US-60 | Backup completo e restauração | T-070 | entregue |  |
| US-61 | Excluir minha conta e todos os dados | T-094 | entregue |  |
| US-62 | Visual Aero legível e acessível | T-025, T-026, T-028, T-029, T-096, T-100 | entregue |  |
| US-63 | Estados vazios que ensinam | T-067 | entregue |  |
| US-64 | Erros com saída | T-029, T-031, T-042, T-045, T-067, T-071 | entregue |  |
| US-65 | Feedback de ações e marcos | T-028, T-060, T-095 | entregue |  |

## 4. Checklist de aparelho real (M4)

O roteiro completo, por tarefa, está no `docs/HANDOFF.md` §6. Para o lançamento, no iPhone instalado na Tela de Início e no Android (Chrome), e no computador:

1. Entrar com Google, instalar e abrir sem rede (M1).
2. Lançar uma despesa em menos de 5 s com 3 toques, em modo avião, e ver sincronizar ao voltar a rede.
3. Painel: "Disponível para gastar" com o selo e "Ver cálculo"; uma compra no cartão aparece na fatura certa e conta no mês do vencimento.
4. Orçamento 50/30/20, limite por categoria, reserva (Guardar e Usar) e fechamento do mês.
5. Importar um OFX do BB e um CSV do Nubank (prévia, importar e desfazer) e ler uma NFC-e (QR e fallback).
6. Avisos no sino; com o SETUP-11 feito, o push de teste, o lembrete diário e o de fatura.
7. Exportar CSV, baixar e restaurar o backup, ocultar valores, tema escuro e reduzir movimento.
8. Acessibilidade: VoiceOver e TalkBack num lançamento completo; texto do sistema em 200% sem rolagem horizontal.
9. Ensaio de restauração do backup do banco no computador (T-098).
10. Excluir conta só com uma conta de teste.

## 5. Pendências registradas

- **Marca:** aprovar o wordmark e o monograma OF depois de 2 semanas de uso (SETUP-16 item 8 = "depois"). Antes de usar a marca fora do app, converter o `<text>` dos SVGs de `src/brand/` em contornos.
- **Limite de 20% do selo "No ritmo do mês" (RN-50):** validar depois de 2 semanas de uso (SETUP-16 item 8). Até lá, fica o valor da spec.
- **Opção não conservadora em Ajustes** (descontar faturas e contas que ainda vencem no mês): mantida (SETUP-16 item 6).
- **Notificações:** teto de 3 push por dia e avisos pós-MVP fora, confirmados (SETUP-16 item 7).
- **Open Finance:** T-076 com `needs-owner` (o SDK do widget traz `PLUGGY_` e o `check-build` reprova); T-077 e T-083 esperam por ela, e o trial da Pluggy (SETUP-13) só deve começar com a T-077 pronta.
- **Arquivos reais (SETUP-14):** T-085, T-087 e T-090.
- **Heurística `data-perf`:** o modo leve liga por memória e núcleos do aparelho (`public/env.js`); a parte de quadros por segundo depois da primeira rolagem (UX §4.5) não foi implementada.
