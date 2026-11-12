# OakFinance — PRD, Regras de Negócio e Backlog do MVP

*OakFinance — PWA de finanças pessoais · versão 1.2 · 05/11/2026 · autor: Product Owner*
*Fonte da verdade: `/home/claude/discovery-brief.md` (v2). Onde o brief é omisso, este documento registra a decisão do PO (marcada **[Decisão PO]**) para que o desenvolvimento não precise adivinhar. Mudança de decisão = nova versão deste arquivo.*
*O brief v2 está desatualizado em dois pontos, que prevalecem sobre ele: (1) a marca é só tipográfica (sem árvore, folha ou qualquer figura); (2) o visual é Aero **sóbrio** para jovens adultos, sem elementos lúdicos (bolhas, gotas, "pote", céu que muda com o mês, celebrações).*

**Precedência entre documentos:** regras de negócio e fórmulas → este documento (RN-xx); textos de interface, telas e componentes → `03-ux-design-system.md` (os textos citados nos cenários Gherkin abaixo foram alinhados a ele); nomes de tabelas, colunas, funções e protocolo → `02-tech-spec.md` (correspondência de nomes em 02 §3.0).

**Histórico de versões**

| Versão | Data | Mudança |
|---|---|---|
| 1.1 | 05/11/2026 | Nome OakFinance, marca tipográfica, tom sóbrio |
| 1.2 | 05/11/2026 | Revisão de QA independente (ver `04-review.md`): compra no cartão conta no mês do **vencimento** (confirmado pelo cliente); recorrências projetadas (RN-27, alinhado ao ADR-08); selo de status do mês sem ambiguidade em Disponível = 0 (RN-48/RN-50); textos dos cenários alinhados à microcopy do UX (rótulo "Disponível para gastar", toasts, push sem pergunta retórica e sem "!"); toasts com "Desfazer" passam a 8 s; sincronização Open Finance 2×/dia e "Atualizar agora" 1×/h (alinhado à técnica); RN-64 com a lista completa de regras seed; RN-93 sem contradição; US-06 com o guia de instalação antes do login no iPhone; US-34 com o caso de competência corrigido; DoD com as regras de repositório público (sem segredos, sem dados reais, fixtures anonimizadas) |

**Como usar este documento (sessões de desenvolvimento automatizado)**
- Cada história `US-xx` só entra em desenvolvimento se cumprir a **Definition of Ready** (seção 6) e só é dada como pronta se cumprir a **Definition of Done** (seção 7).
- Regras de negócio `RN-xx` são normativas: o código e os testes automatizados devem citar o ID da regra que implementam (ex.: `it('RN-12: compra no dia do fechamento vai para a próxima fatura')`).
- Valores, datas e exemplos numéricos das regras são **casos de teste obrigatórios**.
- Em conflito entre uma história e uma regra, vale a regra; registre o conflito como pergunta na seção 8.

---

## Sumário

1. PRD
2. Glossário
3. Modelo de dados de referência
4. Regras de negócio (RN-01 a RN-104)
5. Backlog (épicos E01–E15, histórias US-01 a US-65)
6. Definition of Ready
7. Definition of Done
8. Perguntas em aberto para o cliente (bloqueantes) e decisões do PO a validar

---

## 1. PRD

### 1.0 Produto

**OakFinance** — PWA de finanças pessoais. Marca apenas tipográfica: o logotipo é o próprio nome "OakFinance", sem símbolo ou figura (decisão do cliente em 05/11). O nome e o logotipo valem para manifest, ícones, tela de login, notificações e textos do app.

### 1.1 Problema

Duas pessoas, cada uma com finanças independentes, **não controlam o próprio dinheiro hoje** (no máximo olham o app do banco). Elas não sabem, no meio do mês, quanto ainda podem gastar, perdem de vista em qual fatura cai cada compra no cartão e quanto das parcelas futuras já está comprometido, e não poupam de forma planejada. As ferramentas atuais falham porque registrar um gasto é lento (e no caixa muitas vezes não há sinal), porque os dados dos bancos (Banco do Brasil e Nubank) ficam espalhados e porque não existe uma resposta simples à pergunta do dia a dia: **"Quanto ainda posso gastar este mês?"**. Sem resolver isso, o hábito não se forma e o descontrole continua, com fatura que surpreende e reserva de emergência que não existe.

### 1.2 Objetivos (resultados, não entregas)

| # | Objetivo | Tipo | Como saberemos |
|---|---|---|---|
| O1 | Tornar o registro de gastos um hábito diário | Usuário | ≥ 80% dos dias com ao menos um lançamento nos primeiros 30 dias de uso, por usuário |
| O2 | Registrar um gasto em segundos, mesmo sem sinal | Usuário | Tempo mediano do lançamento rápido < 5 s; p90 < 10 s; 100% dos lançamentos offline sincronizados sem perda |
| O3 | Saber a qualquer momento quanto ainda dá para gastar no mês, com o cartão e as parcelas incluídos | Usuário | O painel abre em < 1,5 s (dados locais) e o valor bate com o cálculo de referência (RN-47) em 100% dos casos de teste |
| O4 | Fechar o mês com os dados conferidos (sem duplicidade nem lacuna) | Usuário | ≥ 1 mês fechado com conciliação por usuário até o fim do 2º mês de uso; 0 duplicidades confirmadas entre automáticos e manuais |
| O5 | Começar a poupar com meta clara | Usuário | Meta de reserva definida por 100% dos usuários na 1ª semana; aporte registrado em ≥ 1 mês nos primeiros 2 meses |
| O6 | Operar a custo zero | Negócio | R$ 0,00 de custo mensal de infraestrutura (Supabase Free, Cloudflare Pages, Pluggy dentro do uso gratuito) |

### 1.3 Não-objetivos (fora do MVP)

| Não-objetivo | Por quê |
|---|---|
| **Compartilhamento entre as duas contas** (gastos em conjunto, divisão de contas, visão de casal, convites) | Decisão do cliente (05/11): contas 100% independentes; não haverá telas nem regras de compartilhamento |
| **Pagar Pix, boletos ou faturas pelo app** (iniciação de pagamento) | Exige credenciamento e integração de iniciação de pagamento; o app só **registra** que o pagamento foi feito |
| **Investimentos** (carteira, rentabilidade, cotações, IR) | Fora do problema central; aporte de poupança é só uma categoria de saída de dinheiro, sem acompanhar rendimento |
| **Juros do rotativo, multa, cálculo de crédito e antecipação de parcelas** | Complexidade alta e pouco frequente; encargos podem ser lançados manualmente como despesa no cartão |
| **Categorização por IA/serviço pago, OCR de cupom em papel, leitura de e-mails/SMS do banco** | Custo R$ 0 e privacidade; as regras são determinísticas e locais (RN-57 a RN-64) |
| **Multimoeda, contas PJ, mais de dois usuários, app nativo de loja** | Escopo pessoal; o PWA atende Android, iPhone e computador |
| **Subcategorias, tags e orçamento por envelope** | Simplicidade; 50/30/20 com limites opcionais por categoria já cobre o MVP |

### 1.4 Personas

Os dois usuários são **independentes**: cada um tem a própria conta Google, os próprios dados e os próprios bancos. Nenhum vê nada do outro.

| | **Persona A — "Android"** | **Persona B — "iPhone"** |
|---|---|---|
| Aparelho principal | Android, Chrome | iPhone, Safari (iOS ≥ 16.4 exigido para push) |
| Aparelho secundário | Computador (análise do mês) | Computador (análise do mês) |
| Contexto do lançamento | Fila, caixa, muitas vezes sem sinal; uma mão livre | Igual |
| Bancos | Banco do Brasil e/ou Nubank (conta + cartão) | Banco do Brasil e/ou Nubank (conta + cartão) |
| Meios | Conta corrente (Pix/débito), cartão(ões) de crédito, dinheiro, VR/VA | Igual |
| Renda | Salário fixo + receitas variáveis | Igual |
| Hoje | Não controla, ou só olha o app do banco | Igual |
| Dor principal | "Não sei quanto ainda posso gastar; a fatura me surpreende" | Igual + push só funciona com o app instalado na tela inicial |
| Ganho esperado | Responder "quanto posso gastar" em 1 olhada; lançar em < 5 s | Igual |

Implicação: **toda entrega é testada nas duas plataformas móveis** (Android Chrome e iPhone Safari instalado), mais um navegador de computador.

### 1.5 Requisitos por prioridade (visão resumida; detalhe no backlog)

- **Must (P0)**: login Google com allowlist, isolamento por usuário, PWA instalável e offline-first, contas e cartões, lançamento rápido, faturas e parcelas, recorrências, receitas fixa/variável, categorias com faixa 50/30/20, regras que aprendem, painel "Quanto ainda posso gastar", reserva de emergência, instalação guiada iPhone/Android, lembrete diário, Open Finance BB e Nubank com conciliação, importação OFX do BB, leitura de NFC-e, exportação CSV, ocultar valores, estados vazios e de erro.
- **Should (P1)**: análise do mês no computador, fechar mês, limites por categoria, lembretes completos (limite, resumo semanal, contas fixas), CSV configurável com presets Nubank, backup/restauração JSON, tema escuro, excluir conta.
- **Could (P2)**: feedback refinado de ações e marcos (US-65), itens da NFC-e detalhados, limite disponível do cartão.
- **Won't (agora)**: itens da seção 1.3.

### 1.6 Métricas de sucesso

Toda métrica é medida **dentro do próprio app** (tabela `evento_uso` no Supabase do próprio usuário, RN-104), sem analytics de terceiros.

| Métrica | Tipo | Definição exata | Meta (sucesso) | Meta (stretch) | Quando avaliar |
|---|---|---|---|---|---|
| % de dias com lançamento | Leading | Dias (fuso America/Sao_Paulo) com ≥ 1 lançamento criado manualmente ou confirmado pelo usuário ÷ dias desde o onboarding | ≥ 80% (30 dias) | ≥ 90% | D+14 e D+30 após o uso diário começar (fim da S2) |
| Tempo de lançamento rápido | Leading | Mediana de `lancamento_salvo.duracao_ms` (do toque no botão "+" até a confirmação de salvo) | < 5 s | < 3 s | Semanal |
| p90 do tempo de lançamento | Leading | Percentil 90 da mesma medida | < 10 s | < 7 s | Semanal |
| Perda de lançamento offline | Guarda-corpo | Lançamentos criados offline que não chegaram ao servidor em 24 h após o aparelho voltar a ter rede | 0 | 0 | Contínuo |
| Mês fechado com conciliação | Lagging | Mês M marcado como fechado cumprindo RN-77 (nada pendente, nada "A classificar") até o dia 10 de M+1 | ≥ 1 mês por usuário até o fim do 2º mês | Todos os meses | Dia 10 de cada mês |
| Duplicidade | Guarda-corpo | Pares manual × automático marcados pelo usuário como "duplicado" depois da conciliação | 0 por mês | 0 | Mensal |
| Precisão das regras | Leading | % de importados cuja categoria sugerida não foi corrigida pelo usuário | ≥ 70% no 1º mês | ≥ 85% no 2º mês | Mensal |
| Custo | Guarda-corpo | Fatura mensal de infraestrutura | R$ 0,00 | R$ 0,00 | Mensal |
| Tempo de abertura do painel | Leading | Do lançamento do app até o valor "Quanto ainda posso gastar" visível, com dados locais | < 1,5 s em aparelho intermediário | < 1 s | Toda entrega |

### 1.7 Premissas

1. Cada usuário usa **principalmente um aparelho**; conflitos de edição simultânea são raros (base da regra "última edição vence", RN-97).
2. Os dois usuários estão no Brasil e usam o fuso **America/Sao_Paulo** (sem horário de verão).
3. Os bancos são **Banco do Brasil e Nubank**; ambos aparecem como conectores Open Finance PF na Pluggy (validar produtos no início da S3).
4. O uso diário dos dois usuários evita a pausa do Supabase Free por inatividade (com ping agendado como garantia, US-05).
5. O iPhone da Persona B roda **iOS 16.4 ou superior** (exigido para Web Push em web app instalado).
6. As NFC-e lidas são majoritariamente do **Paraná** (SEFAZ-PR).
7. O valor do salário fixo é conhecido no início do mês (por isso a receita fixa conta antes de cair, RN-35).

### 1.8 Restrições

| Restrição | Consequência no produto |
|---|---|
| **R$ 0/mês** | Supabase Free (Postgres + RLS + Auth + Edge Functions + pg_cron), Cloudflare Pages, Web Push com VAPID próprio, Pluggy no modo gratuito/teste; nada pago sem aprovação explícita do cliente |
| **Offline-first** | Todo fluxo do núcleo (lançar, editar, ver painel, faturas, orçamento) funciona sem rede com IndexedDB; integrações (Open Finance, NFC-e, push) exigem rede e degradam com mensagem clara |
| **Login Google** | Único método de login; acesso restrito a uma allowlist de 2 e-mails (RN-101) |
| **Prazo de 4 semanas em camadas** | S1–2 núcleo (uso diário começa); S3 Open Finance + conciliação; S4 OFX/CSV + NFC-e + push completo. O núcleo é protegido: integrações podem escorregar sem bloquear o uso |
| **Push no iPhone** | Só funciona com o app instalado na tela inicial e com permissão pedida por gesto do usuário → onboarding guiado obrigatório |
| **Acessibilidade** | WCAG 2.1 AA de contraste sobre o vidro; receita/despesa nunca só por cor; respeitar "reduzir movimento" |

### 1.9 Plano de entrega (camadas)

| Camada | Semana | Conteúdo | Saída |
|---|---|---|---|
| N1 | S1 | Fundação (login, RLS, PWA, sync offline), contas e cartões, lançamento rápido, categorias, atribuição de fatura, lista, instalação guiada, base visual Aero | Lançar offline e ver a lista; instalado nos dois celulares |
| N2 | S2 | Parcelas, recorrências, receitas, regras que aprendem, 50/30/20, painel "Quanto ainda posso gastar", reserva, faturas e pagamento, central de avisos, push básico (lembrete diário e vencimento de fatura), exportação, estados vazios/erros | **Uso diário começa** |
| OF | S3 | Open Finance BB e Nubank via Meu Pluggy, conciliação, revisão de importados, fechar mês | Dados dos bancos entram sozinhos, sem duplicar |
| IMP | S4 | OFX do BB, CSV configurável (presets Nubank), NFC-e por QR, lembretes push completos, excluir conta | MVP completo |

A ordem de corte se o prazo apertar (do primeiro a sair para o último): US-65 → US-56 → US-53 → US-36 → US-35 → US-44 → US-60 → US-32. Nenhuma história Must é cortada.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Conta** | Onde o dinheiro está ou por onde sai: `corrente` (ex.: BB, Nubank conta), `carteira` (dinheiro), `beneficio` (VR ou VA), `cartao` (cartão de crédito) |
| **Forma** | Para conta corrente: Pix, débito, boleto, TED/DOC, outro. Para as demais contas, não se aplica |
| **Meio** | Par (conta, forma) escolhido no lançamento. Ex.: "Pix · BB", "Crédito · Nubank", "Dinheiro", "VR" |
| **Meio imediato** | Meio cuja conta é `corrente`, `carteira` ou `beneficio` (o dinheiro sai na data do lançamento) |
| **Lançamento** | Registro de despesa, receita, transferência, pagamento de fatura, estorno ou resgate da reserva |
| **Fatura** | Conjunto de itens de um cartão com a mesma data de vencimento. Identificada por (cartão, mês de vencimento) |
| **Item de fatura** | Lançamento no cartão (compra à vista, parcela, ocorrência recorrente, estorno, encargo, saldo credor) |
| **Série parcelada** | Compra parcelada; gera N parcelas, uma por fatura |
| **Recorrência** | Modelo que gera ocorrências periódicas (contas fixas, assinaturas, salário) |
| **Ocorrência** | Lançamento gerado por uma recorrência |
| **Faixa** | Necessidades, Desejos ou Poupança (50/30/20) |
| **Base(M)** | Renda considerada no mês M para o 50/30/20 e para o painel (RN-38) |
| **Mês de impacto** | Mês em que um lançamento pesa no painel e no orçamento (RN-46) |
| **Transação externa (T)** | Registro vindo de Open Finance, OFX, CSV ou NFC-e |
| **Conciliar** | Ligar uma transação externa a um lançamento existente para que conte uma única vez |
| **M / H** | Mês corrente / data de hoje, no fuso America/Sao_Paulo |

---

## 3. Modelo de dados de referência

Orientativo (os nomes técnicos definitivos estão em `02-tech-spec.md` §3, com a tabela de correspondência em §3.0; os campos e unicidades citados são obrigatórios). Toda tabela tem `id uuid` (gerado no cliente), `user_id uuid` (= `auth.uid()`), `created_at`, `updated_at` (timestamptz UTC), `deleted_at` (exclusão lógica) e `device_id`.

| Entidade | Campos essenciais | Unicidade / observações |
|---|---|---|
| `config_usuario` | modo_calculo (`caixa`/`competencia`), pct_necessidades/desejos/poupanca, considerar_beneficios, horario_lembrete_diario, resumo_semanal_dia/hora, silencio_inicio/fim, ocultar_valores, tema, onboarding_concluido_em | 1 por usuário |
| `conta` | nome, tipo, banco (`bb`/`nubank`/`outro`/null), cor, ícone, saldo_inicial_centavos, arquivada | — |
| `cartao` (1:1 com conta tipo `cartao`) | dia_fechamento, dia_vencimento, regra_dia_fechamento (`proxima`/`atual`), limite_centavos? | — |
| `fatura` | cartao_id, competencia (AAAA-MM do vencimento), data_fechamento, data_vencimento, status, total_centavos (derivado) | único (cartao_id, competencia) |
| `categoria` | nome, tipo (`despesa`/`receita`), faixa (null para receita e "A classificar"), ícone, cor, limite_mensal_centavos?, alimenta_reserva (bool, só Poupança), sistema (bool), arquivada | nome único por usuário e tipo |
| `lancamento` | tipo, valor_centavos (> 0), data, conta_id, forma?, conta_destino_id? (transferência), fatura_id?, categoria_id?, descricao?, observacao?, status (`efetivada`/`prevista`/`cancelada`), contar_antes (receita variável), serie_id?, parcela_num?, parcela_total?, recorrencia_id?, origem (`manual`/`open_finance`/`ofx`/`csv`/`nfce`/`recorrencia`), revisado (bool), conciliacao_id? | único (recorrencia_id, data_prevista) |
| `lancamento_historico` | lancamento_id, versão (JSON completo), motivo (`edicao`/`conflito`/`conciliacao`), device_id | — |
| `serie_parcelas` | valor_total_centavos, n_parcelas, data_compra, cartao_id, categoria_id, descricao | — |
| `recorrencia` | tipo, valor_centavos, valor_variavel, categoria_id, conta_id, forma?, frequencia (`mensal`/`anual`), dia, mes (anual), inicio, fim_tipo, fim_data?, fim_n?, confirmacao_automatica, termo_conciliacao? | — |
| `regra_categorizacao` | termo (normalizado), categoria_id, conta_id?, origem (`seed`/`aprendida`/`manual`), acertos, ultimo_uso | único (user_id, termo, conta_id) |
| `reserva` | meta_centavos, meta_manual (bool), saldo_inicial_centavos, meta_atingida_em? | 1 por usuário |
| `transacao_externa` | fonte, conta_id, external_id, data, valor_centavos, direcao (`saida`/`entrada`), descricao_original, metadados (JSON: parcela, billId, categoria do agregador), estado (`conciliada`/`criou_lancamento`/`pendente_decisao`/`duplicada`/`ignorada`), lancamento_id? | único (user_id, fonte, conta_id, external_id) |
| `conexao_open_finance` | item_id, banco, status, ultimo_sync_em, consentimento_expira_em?, mapeamento contas Pluggy → `conta` | segredos (client secret) **só** em Vault/variáveis da Edge Function |
| `nfce` | chave_acesso (44 dígitos), cnpj_emitente, nome_emitente?, data_emissao?, valor_total_centavos?, itens (JSON), forma_pagamento?, lancamento_id, estado_leitura (`completa`/`parcial`) | único (user_id, chave_acesso) |
| `push_subscription` | endpoint, chaves, plataforma, ativa | único endpoint |
| `notificacao_log` | tipo, chave_referencia, data_ref, enviada_em, canal | único (user_id, tipo, chave_referencia, data_ref) |
| `aviso` (central in-app) | tipo, título, texto, ação (rota), lido_em | — |
| `mes_fechado` | competencia (AAAA-MM), fechado_em, snapshot (JSON com totais) | único (user_id, competencia) |
| `evento_uso` | nome, propriedades (JSON), ocorrido_em | retenção 180 dias |

---

## 4. Regras de negócio

### 4.1 Gerais

**RN-01 — Dinheiro em centavos.** Todo valor é armazenado e calculado como inteiro em centavos de real (BRL), nunca em ponto flutuante. Exibição no formato pt-BR: `R$ 1.234,56`; negativo: `−R$ 120,00` (sinal de menos U+2212, conforme o design system; nos cenários deste documento o hífen "-" antes de "R$" representa esse sinal). Faixa válida de um lançamento: 1 a 99.999.999 centavos (R$ 0,01 a R$ 999.999,99). O valor digitado é sempre positivo; o **tipo** do lançamento define se entra ou sai.

**RN-02 — Datas e fuso.** Lançamentos têm `data` (data civil, sem hora). "Hoje" (H), "mês corrente" (M), "dia" e todos os horários de lembrete usam o fuso **America/Sao_Paulo**. Mês = mês civil (dia 1 ao último dia). Timestamps técnicos (`created_at`, `updated_at`) ficam em UTC.

**RN-03 — Dia inexistente no mês.** Toda regra baseada em "dia D do mês" usa `min(D, último dia do mês)`. Ex.: dia 31 em fevereiro de 2027 → 28/02/2027; dia 30 em fevereiro de 2028 → 29/02/2028.

**RN-04 — Tipos de lançamento.** `despesa`, `receita`, `transferencia` (entre contas do próprio usuário), `pagamento_fatura` (transferência de conta corrente para uma fatura), `estorno` (crédito no cartão que reduz a fatura e a categoria original) e `resgate_reserva`. **Transferência e pagamento de fatura nunca contam como despesa nem receita** em nenhum cálculo (painel, 50/30/20, reserva, relatórios).

**RN-05 — Status.** `efetivada`, `prevista` ou `cancelada`. Ao criar despesa manual: data ≤ H → `efetivada`; data > H → `prevista` (exibida como "agendada"). `cancelada` nunca entra em cálculo nem em totais, mas permanece visível no histórico da série/recorrência. Uma despesa `prevista` avulsa passa a `efetivada` automaticamente quando a data chega (na abertura do app ou no job diário, o que ocorrer primeiro).

**RN-06 — Campos obrigatórios.** Para despesa e receita: **valor, categoria e meio** (conta + forma quando a conta for corrente). Padrões: data = H; meio = último meio usado pelo usuário em uma despesa; forma da conta corrente = última forma usada naquela conta (inicial: Pix). Descrição: opcional, até 120 caracteres. Observação: opcional, até 500 caracteres. Data: aceita qualquer data; se estiver a mais de 60 dias de H (passado ou futuro), pedir confirmação ("Essa data está longe de hoje. Confirmar?").

**RN-07 — Contas.** Tipos: `corrente`, `carteira`, `beneficio` (subtipo VR ou VA), `cartao`. Uma conta com lançamentos não pode ser excluída, só **arquivada**: some do seletor de meio e do lançamento rápido, mas mantém histórico, faturas e totais. Desarquivar é permitido. Nome obrigatório, até 40 caracteres, único entre as contas ativas do usuário.

**RN-08 — Transferências.** Uma transferência tem conta de origem e conta de destino diferentes, ambas não-cartão (para cartão use pagamento de fatura). Exemplos: saque (corrente → carteira) e Pix entre BB e Nubank do próprio usuário. Aporte na reserva **não** é transferência: é despesa em categoria da faixa Poupança (RN-54).

### 4.2 Cartões e faturas

**RN-09 — Parâmetros do cartão.** `dia_fechamento` F (1–31), `dia_vencimento` V (1–31), `regra_dia_fechamento` ∈ {`proxima` (padrão), `atual`} e limite opcional. A regra diz para qual fatura vai uma compra feita **no próprio dia do fechamento**. **[Decisão PO]** Padrão `proxima`, porque BB e Nubank tratam o dia do fechamento como "melhor dia de compra" (a compra entra na fatura seguinte). O usuário pode trocar por cartão.

**RN-10 — Data de fechamento.** Para cada mês m: `fech(m) = min(F, último dia de m)` (RN-03).

**RN-11 — Data de vencimento.** A fatura que fecha no mês m vence em `min(V, último dia do mês)` do mês **m** se V > F, ou do mês **m+1** se V ≤ F. A data de vencimento é nominal: não se ajusta para fim de semana nem feriado.

**RN-12 — Em qual fatura cai uma compra.** Para uma compra no cartão na data d, com m0 = mês de d:
- se `d < fech(m0)` → fatura que fecha em m0;
- se `d = fech(m0)` → regra `proxima`: fatura que fecha em m0+1; regra `atual`: fatura que fecha em m0;
- se `d > fech(m0)` → fatura que fecha em m0+1.

Casos de teste obrigatórios:

| Cartão | F | V | Regra | Compra | Fecha em | Vence em | Fatura |
|---|---|---|---|---|---|---|---|
| A | 3 | 10 | proxima | 02/11/2026 | 03/11/2026 | 10/11/2026 | nov/2026 |
| A | 3 | 10 | proxima | **03/11/2026** | 03/12/2026 | 10/12/2026 | dez/2026 |
| A | 3 | 10 | atual | **03/11/2026** | 03/11/2026 | 10/11/2026 | nov/2026 |
| A | 3 | 10 | proxima | 04/11/2026 | 03/12/2026 | 10/12/2026 | dez/2026 |
| B | 25 | 5 | proxima | 24/11/2026 | 25/11/2026 | 05/12/2026 | dez/2026 |
| B | 25 | 5 | proxima | **25/11/2026** | 25/12/2026 | 05/01/2027 | jan/2027 |
| C | 31 | 8 | proxima | 27/02/2027 | 28/02/2027 | 08/03/2027 | mar/2027 |
| C | 31 | 8 | proxima | **28/02/2027** | 31/03/2027 | 08/04/2027 | abr/2027 |
| C | 31 | 8 | proxima | 30/04/2027 | 30/04/2027 → **é o dia do fechamento** → 31/05/2027 | 08/06/2027 | jun/2027 |

**RN-13 — Identificação e período.** A fatura é identificada por (cartão, competência), onde competência = mês/ano do **vencimento** (rótulo "Fatura de dez/2026"). Com regra `proxima`, a fatura que fecha em m reúne compras com `fech(m−1) ≤ d < fech(m)`; com regra `atual`, `fech(m−1) < d ≤ fech(m)`. Faturas são criadas sob demanda (quando recebem o primeiro item).

**RN-14 — Status da fatura** (calculado, em ordem de precedência):
1. `paga` — soma dos pagamentos vinculados ≥ total (e total > 0);
2. `parcialmente_paga` — 0 < pagamentos < total, e H ≤ vencimento;
3. `vencida` — H > vencimento e pagamentos < total;
4. `fechada` — H ≥ data de fechamento (regra `proxima`) ou H > data de fechamento (regra `atual`), e H ≤ vencimento;
5. `aberta` — o período da fatura contém H;
6. `futura` — período posterior ao da fatura aberta (contém só parcelas e ocorrências projetadas).

Fatura com total ≤ 0 após o fechamento é exibida como "sem valor a pagar" e conta como `paga`.

**RN-15 — Total da fatura.** Soma dos itens não cancelados: compras à vista, parcelas, ocorrências de recorrência no cartão, encargos lançados manualmente (despesa no cartão em categoria escolhida pelo usuário) menos estornos. Se o total de uma fatura fechada for negativo (saldo credor) ou se houver pagamento acima do total, a diferença vira item negativo "Saldo credor da fatura anterior" (categoria de sistema, sem faixa) na fatura seguinte.

**RN-16 — Pagamento de fatura.** Registrado como `pagamento_fatura`: sai de uma conta corrente, aponta para uma fatura (padrão: a fatura `fechada`/`vencida` mais antiga não paga do cartão; senão a `aberta`), valor padrão = saldo restante da fatura. Pagamento parcial é permitido e deixa "saldo em aberto" informativo; **não** há cálculo de juros/rotativo (não-objetivo). Pagamento antecipado (antes do fechamento) vale para a fatura escolhida.

**RN-17 — Mudança de F, V ou regra do cartão.** Recalcula a fatura de todos os itens que estão em faturas `aberta` ou `futura`. Itens de faturas `fechada`, `parcialmente_paga`, `vencida` ou `paga` não mudam. O usuário vê antes uma prévia: "X itens vão mudar de fatura".

**RN-18 — Mover item manualmente.** O usuário pode mover um item para outra fatura do mesmo cartão que não esteja `paga` (para corrigir divergência com o banco). O item passa a ter `fatura_fixada = true` e deixa de ser recalculado pela RN-17.

**RN-19 — Fatura informada pelo banco prevalece.** Se uma transação externa de cartão trouxer referência de fatura (ex.: `billId` ou data de vencimento da fatura no Open Finance), o item conciliado ou criado vai para essa fatura (com `fatura_fixada = true`), mesmo que a RN-12 dê outro resultado.

### 4.3 Parcelamento

**RN-20 — Quando parcelar.** Só despesas com meio cartão de crédito. Número de parcelas n ∈ [2, 48]. O usuário informa **valor total** (padrão) **ou** valor da parcela (alternância "Total / Parcela"). Se informar a parcela p, total = p × n e todas as parcelas são iguais. Total mínimo = n centavos.

**RN-21 — Arredondamento.** `base = floor(total / n)`; `resto = total − base × n`. **A parcela 1 recebe o resto** (`base + resto`); as parcelas 2..n valem `base`. **[Decisão PO]** Diferença na primeira parcela, como é prática comum das operadoras. Casos de teste: R$ 100,00 em 3× → 33,34 + 33,33 + 33,33; R$ 1.000,00 em 10× → 10 × 100,00; R$ 99,99 em 2× → 50,00 + 49,99; R$ 0,10 em 3× → 0,04 + 0,03 + 0,03; parcela R$ 49,90 em 10× → total R$ 499,00 e 10 × 49,90.

**RN-22 — Distribuição nas faturas.** A parcela k (1..n) cai na fatura `F1 + (k−1) meses`, onde F1 é a fatura da data da compra pela RN-12. Todas as parcelas exibem a data da compra; descrição exibida "<descrição> (k/n)" (ou "<categoria> (k/n)" se não houver descrição). Categoria e faixa são as da série. Ex.: compra de R$ 1.000,00 em 10× no Cartão A em 05/11/2026 → parcelas nas faturas dez/2026 a set/2027. Compra de R$ 100,00 em 3× no Cartão A em 02/11/2026 → nov/2026 (33,34), dez/2026 (33,33), jan/2027 (33,33).

**RN-23 — Status das parcelas.** Parcela 1: `efetivada`. Parcela k > 1: `prevista` enquanto sua fatura estiver `futura` ou `aberta`; passa a `efetivada` quando a fatura fecha. Parcelas previstas **contam** no painel e no orçamento do seu mês de impacto (RN-46).

**RN-24 — Editar série.** Toda edição de um item de série pergunta o escopo quando aplicável:
- (a) **Descrição, categoria, observação**: "Toda a compra" (padrão) ou "Só esta parcela".
- (b) **Valor total, número de parcelas, data da compra ou cartão**: sempre para a série inteira; permitido **somente** se nenhuma parcela estiver em fatura `paga` ou `parcialmente_paga`. As parcelas são regeneradas pelas RN-21/RN-22, mantendo o mesmo `serie_id`. Se bloqueado, mensagem: "Algumas parcelas já estão em faturas pagas. Você pode cancelar as parcelas restantes e lançar o novo valor."
- (c) **Valor de uma parcela isolada**: permitido com escopo "Só esta parcela"; não redistribui as outras; o total da série passa a ser a soma das parcelas.
- O meio de uma série não pode passar para meio imediato.

**RN-25 — Excluir série.** Duas opções:
- **"Cancelar parcelas restantes"** (padrão): parcelas em faturas `aberta` e `futura` ficam `cancelada`; as demais ficam como estão. Uso típico: devolução ou quitação antecipada (lançada à parte).
- **"Apagar a compra inteira"**: exclusão lógica de todas as parcelas. Se alguma estiver em fatura `paga`, o diálogo mostra o valor que aquela fatura deixará de exibir e exige segunda confirmação.
Excluir uma única parcela não existe: a opção equivalente é editar o valor dela (RN-24c) ou cancelar as restantes.

### 4.4 Recorrências (contas fixas, assinaturas, salário)

**RN-26 — Definição.** Tipo (despesa ou receita), valor, categoria, meio, frequência ∈ {`mensal`, `anual`}, dia (1–31, RN-03) e mês (anual), início, fim ∈ {sem fim, até data, após N ocorrências}, `valor_variavel` (bool) e `confirmacao_automatica` (bool). Padrão de `confirmacao_automatica`: **ligada** para cartão de crédito (assinaturas cobram sozinhas) e **desligada** para meios imediatos e para receitas.

**RN-27 — Projeção e materialização.** As ocorrências são **projetadas** (calculadas no aparelho, sem linha no banco) até o último dia de M+12 e aparecem em listas, faturas futuras, painel e lembretes como se existissem. Uma ocorrência vira linha (`lancamento` com `recorrencia_id` + `data_prevista`) quando é confirmada, pulada (`cancelada`), editada só nela, conciliada ou confirmada automaticamente (RN-28). A materialização é idempotente: (recorrencia_id, data_prevista) é único no banco e o id é determinístico; se dois aparelhos (ou o servidor) materializarem a mesma ocorrência, não há duplicata nem erro para o usuário. (Decisão técnica ADR-08 de `02-tech-spec.md`.)

**RN-28 — Ciclo da ocorrência.** Nasce `prevista`. Na data prevista: com confirmação automática → `efetivada`; sem → continua `prevista` e, a partir de D+1, é exibida como **"atrasada"** (selo + aviso, RN-91). O usuário pode "Confirmar" (com o valor real, se variável), "Pular este mês" (→ `cancelada`) ou editar. Ocorrências `prevista` e "atrasada" **contam** no painel do mês.

**RN-29 — Ocorrência no cartão.** Vira item da fatura da sua data pela RN-12.

**RN-30 — Escopo de edição.** "Só esta ocorrência" altera apenas a ocorrência. "Esta e as próximas" encerra a recorrência original na véspera da ocorrência editada, cria uma nova recorrência a partir dela com os novos dados e regenera as ocorrências futuras; as ocorrências `efetivada` nunca mudam. "Encerrar" define fim = data escolhida e remove as ocorrências `prevista` posteriores. Excluir a recorrência = encerrar a partir de hoje (o histórico efetivado permanece).

**RN-31 — Valor variável.** Ocorrências de recorrência com `valor_variavel` exibem "≈ R$ X", onde X = valor da última ocorrência efetivada (ou o valor cadastrado, se nenhuma). Ao confirmar, o app pede o valor real (pré-preenchido com X).

### 4.5 Receitas

**RN-32 — Receita fixa.** É uma recorrência de receita (ex.: salário dia 5). **Conta na Base do mês pelo valor previsto mesmo antes de cair** (o brief usa "receita fixa do mês"). Ao confirmar o recebimento, o valor real substitui o previsto. "Não recebi este mês" → ocorrência `cancelada`, sai da Base.

**RN-33 — Receita variável.** Lançamento avulso com três estados visíveis:

| Estado | Como fica | Conta na Base e no painel? |
|---|---|---|
| **Recebida** | `efetivada`, data ≤ H | Sim |
| **A receber** | `prevista`, `contar_antes = false` | **Não** |
| **Prevista** | `prevista`, `contar_antes = true` (toggle "Contar antes de receber") | Sim, com rótulo "prevista" e estilo tracejado |

Ao criar: pergunta "Já caiu na conta?" (Sim → Recebida, data ≤ H obrigatória; Não → A receber, com o toggle disponível, desligado por padrão). Receitas variáveis contam no mês da sua `data`.

**RN-34 — Receita não confirmada.** Receita fixa, A receber ou Prevista com data < H e não confirmada gera aviso "Confirmar {descrição}" (UX 6.7, #20) com ações: Confirmar (valor real), Mudar data, Não vai cair (→ `cancelada`). Enquanto o usuário não age, ela continua com o comportamento do seu estado (fixa e Prevista contam; A receber não conta).

**RN-35 — VR/VA.** O crédito mensal do benefício é uma receita fixa na categoria "Benefícios (VR/VA)" com destino a conta `beneficio`. Configuração **"Considerar VR/VA nos cálculos"** (padrão ligado). Desligada: exclui da Base as receitas da categoria "Benefícios (VR/VA)" **e** exclui do painel e do 50/30/20 as despesas pagas com contas `beneficio` (as duas pontas saem juntas para não distorcer).

**RN-36 — Resgate da reserva.** Lançamento `resgate_reserva` (entrada em uma conta não-cartão). Soma no painel do mês, **não** entra na Base (não gera aporte de 20% sobre ele) e reduz o progresso da reserva (RN-56).

**RN-37 — Estorno.** Crédito no cartão referente a uma compra (devolução, cashback de compra). Usa a categoria da compra original (ou escolhida), entra como item negativo na fatura da sua data (RN-12) e reduz o consumo da categoria/faixa no mês de impacto.

**RN-38 — Base(M).** `Base(M) = RF(M) + RV(M)`, onde:
- `RF(M)` = soma das ocorrências de receita fixa com data em M e status ≠ `cancelada` (valor real se confirmada, senão previsto);
- `RV(M)` = soma das receitas variáveis com data em M que estão **Recebidas** ou **Previstas** (`contar_antes = true`).
Não entram: transferências, resgates da reserva, receitas canceladas, receitas "A receber", e Benefícios se RN-35 estiver desligada.

### 4.6 Categorias e 50/30/20

**RN-39 — Faixa obrigatória.** Toda categoria de despesa tem exatamente uma faixa: Necessidades, Desejos ou Poupança. Categorias de receita não têm faixa.

**RN-40 — Lista padrão** (criada no primeiro login, editável):

| Faixa | Categorias de despesa padrão |
|---|---|
| Necessidades | Moradia (aluguel/condomínio), Contas da casa (luz/água/gás/internet), Mercado, Transporte, Combustível, Saúde, Farmácia, Educação, Seguros, Impostos e taxas, Pets |
| Desejos | Restaurantes e delivery, Lazer, Assinaturas, Compras e vestuário, Beleza e cuidados, Viagens, Presentes, Outros |
| Poupança | Reserva de emergência (`alimenta_reserva = true`), Outros aportes (`alimenta_reserva = true`) |

Receitas padrão: Salário, Renda extra, Benefícios (VR/VA), Reembolsos, Outras receitas. Categorias de sistema (não editáveis, não excluíveis, sem faixa): **"A classificar"** e **"Saldo credor da fatura anterior"**.

**RN-41 — "A classificar".** Usada apenas por transações externas sem categoria sugerida. Não aparece no seletor do lançamento manual. Conta normalmente no painel; no 50/30/20 aparece como grupo **"Sem faixa"** com aviso "X lançamentos para classificar".

**RN-42 — Editar categoria.** Renomear, trocar ícone/cor, trocar faixa (efeito **retroativo** em todos os meses, com aviso), definir limite mensal opcional, arquivar (some do seletor, mantém histórico). Excluir só se não houver lançamentos, recorrências ou regras; caso contrário, o app exige escolher uma categoria de destino e move tudo antes de excluir.

**RN-43 — Percentuais.** Inteiros de 0 a 100, padrão 50/30/20; a soma deve ser exatamente 100 (validação bloqueia salvar, mensagem "Os percentuais somam X%. Ajuste para totalizar 100%.").

**RN-44 — Meta de cada faixa.** `meta_faixa(M) = arredonda(Base(M) × pct_faixa / 100)` em centavos, arredondamento meio para cima (0,5 centavo → 1). Para Necessidades e Desejos a meta é **teto**; para Poupança é **mínimo a atingir**.

**RN-45 — Consumo da faixa.** `consumo_faixa(M)` = soma das despesas não canceladas (efetivadas **e** previstas) das categorias da faixa cujo mês de impacto (RN-46) é M, menos os estornos dessas categorias. A barra mostra separadamente "já foi" (efetivadas) e "vai sair" (previstas). Consumo de Poupança = aportes do mês. Limites por categoria seguem a mesma soma restrita à categoria.

### 4.7 "Quanto ainda posso gastar"

**RN-46 — Mês de impacto.** Define em que mês cada despesa pesa. Configuração `modo_calculo`:
- **`caixa` (padrão) [Decisão do cliente, 05/11]** — a compra no cartão conta no mês do **vencimento** da fatura (interpretação literal da fórmula do brief): despesa em meio imediato → mês da sua data; item de cartão (compra, parcela, ocorrência, estorno, encargo) → mês de **vencimento** da fatura em que está.
- **`competencia`** — despesa em meio imediato → mês da sua data; compra no cartão à vista ou ocorrência → mês da data da compra; parcela k → mês da compra + (k−1).
Transferências e pagamentos de fatura não têm mês de impacto (nunca contam). No modo `caixa`, o pagamento da fatura não é despesa: quem conta são os itens da fatura, o que evita contar duas vezes.

**RN-47 — Fórmula (cálculo exato).** Para o mês corrente M e hoje H:

```
Disponível(M) = RF(M) + RV(M) + Resgates(M)
              − GR(M)        // gastos realizados
              − CP(M)        // faturas, parcelas e contas fixas que ainda vencem no mês
              − AporteRestante(M)
```

- `GR(M)` = despesas `efetivada` com mês de impacto M que já ocorreram: em meio imediato com data ≤ H; e itens de faturas com vencimento em M que já estão `paga`. (Inclui os aportes já feitos, que são despesas da faixa Poupança.) Menos estornos com mês de impacto M.
- `CP(M)` = demais despesas não canceladas com mês de impacto M: despesas em meio imediato com data > H (agendadas e ocorrências previstas); ocorrências previstas ou "atrasadas" com data ≤ H; e todos os itens das faturas com vencimento em M que **não** estão `paga` (inclui parcelas e ocorrências no cartão).
- No modo `competencia`, "itens de fatura com vencimento em M" é substituído por "itens de cartão com mês de impacto M": efetivados vão para GR e previstos para CP.
- Despesas pagas com conta `beneficio` saem de GR e CP se a RN-35 estiver desligada.
- `AporteRestante(M) = max(0, meta_poupanca(M) − AportesFeitos(M))`, com `meta_poupanca(M)` da RN-44 e `AportesFeitos(M)` = consumo **efetivado** da faixa Poupança no mês (RN-45). Assim o aporte nunca é descontado duas vezes: o efeito total no painel é `max(meta, aportes feitos)`.
- Todo o cálculo é em centavos inteiros; nenhuma etapa intermediária arredonda além da RN-44.
- Ajustes do usuário (US-34, tela S06 do UX), todos com padrão conservador: "Incluir receitas previstas" (ligado: respeita o "Contar antes de receber" de cada receita; desligado: nenhuma Prevista conta), "Descontar a poupança do mês" (ligado; desligado → AporteRestante = 0) e "Descontar faturas e contas que ainda vencem no mês" (ligado; desligado → CP = 0, com aviso de que o valor deixa de ser conservador).
- Pendentes de decisão (RN-67) e itens `cancelada` nunca entram em nenhuma parcela da fórmula.

**Caso de teste de referência** (modo `caixa`, H = 15/11/2026, Cartão A F=3/V=10):
- Salário fixo dia 5: R$ 5.000,00 (confirmado). Freela recebido em 10/11: R$ 800,00. Freela "A receber" em 25/11: R$ 300,00 (não conta). → Base = R$ 5.800,00; meta de poupança 20% = R$ 1.160,00.
- Pix para a reserva em 06/11: R$ 200,00 (Poupança). Mercado no débito em 08/11: R$ 450,00. Aluguel por Pix em 10/11: R$ 1.500,00. Fatura nov/2026 do Cartão A (vence 10/11) de R$ 1.200,00, paga. → GR = 200 + 450 + 1.500 + 1.200 = R$ 3.350,00.
- Conta de luz recorrente dia 20 (≈ R$ 180,00, prevista) e internet dia 25 (R$ 100,00, prevista). → CP = R$ 280,00.
- AporteRestante = 1.160 − 200 = R$ 960,00.
- **Disponível = 5.800 − 3.350 − 280 − 960 = R$ 1.210,00.**
- Compras no Cartão A feitas entre 03/11 e 15/11 caem na fatura dez/2026 e **não** reduzem este valor no modo `caixa`; elas aparecem na linha informativa da RN-49.

**RN-48 — Casos de borda.**
- **Mês sem renda lançada** (Base(M) = 0 e nenhuma recorrência de receita com ocorrência em M): o painel **não exibe** o número; mostra "Cadastre sua renda para ver quanto pode gastar" com os botões "Cadastrar renda" (receita fixa) e "Lançar receita" (avulsa), e abaixo "Você já gastou R$ X este mês" (GR + CP). Meta das faixas = 0 e alertas de limite de faixa ficam desligados.
- **Disponível negativo**: exibir o valor com sinal (`-R$ 120,00`) e o selo "Acima do planejado em R$ 120,00" (RN-50, texto e ícone, nunca só cor); **não** truncar em zero; texto direto e sem culpa, com o atalho "Ver onde ajustar" para o 50/30/20.
- **Disponível zero**: valor `R$ 0,00`, selo `Atenção` com o texto "No limite do planejado" (RN-50) e sem valor por dia.
- **Valor por dia**: se Disponível > 0, mostrar `floor(Disponível / dias_restantes)` com `dias_restantes` = dias de H até o último dia de M, inclusive (no exemplo da RN-47: R$ 1.210,00 ÷ 16 = R$ 75,62/dia). Se Disponível ≤ 0, não mostrar.
- **Virada do mês**: à 00:00 do dia 1 o painel passa a calcular o novo mês. Sobras ou déficits do mês anterior **não** são transportados (o painel é de fluxo mensal, não saldo bancário).
- **Ocultar valores ligado**: o número é mascarado (RN-103), mas o rótulo de estado (no planejado / acima) continua visível.

**RN-49 — Início pelo gasto do mês (D-081).** O H01 mostra: (1) herói **"Gasto em {mês}"** = GR(M) da RN-47 (despesas efetivadas não canceladas cujo mês de impacto, RN-46, é M, menos os estornos); (2) **"Saldo nas contas"** = soma dos saldos atuais das contas (saldo inicial na data dele + entradas − saídas efetivadas até hoje; cartões não são contas), com toque para a lista de contas; (3) linha informativa **"Ainda vai sair este mês: R$ X"** = CP(M) (previstas, fora do herói); (4) card **"Saúde do mês"** com uma barra por faixa do 50/30/20 sobre a renda (RN-43, RN-44): Necessidades e Desejos comparam o gasto com a meta (teto) e ficam "No caminho", "Atenção" (≥ 80%) ou "Passou do planejado" (≥ 100%) pelos limiares da D-082; Poupança compara os aportes com a meta (mínimo), nunca "passa do planejado" e só fica em "Atenção" nos últimos 5 dias do mês abaixo da meta; estado em texto e ícone, e o atalho "Ajustar percentuais". Sem renda (RN-48), o card pede a renda ("Cadastre sua renda para acompanhar as faixas do mês." + "Cadastrar renda") e o herói continua mostrando o gasto. A folha `H01-S` e a linha "No cartão para os próximos meses" saíram do Início (D-081); a fórmula da RN-47 continua no domínio.

**RN-50 — Indicador de status do mês (selo). Substituída pela D-081:** o selo "No ritmo do mês" saiu do Início; o estado do mês passa a ser o de cada faixa no card "Saúde do mês" (RN-49). O cálculo `monthStatus` (Disponível ≥ 20% da Base → `on_track`; 0 ≤ Disponível < 20% → `attention`; Disponível < 0 → `over`; Base = 0 → `no_income`) continua no domínio, com os testes, sem uso na tela.

**RN-51 — Recalcular sempre localmente.** O painel é recalculado no aparelho a cada mudança de dados (inclusive offline) em < 200 ms para até 5.000 lançamentos; não depende de rede.

### 4.8 Reserva de emergência

**RN-52 — Meta sugerida.** `sugestão = 6 × média(Necessidades efetivadas por mês)` considerando os **até 6 meses civis completos mais recentes** (anteriores a M) que tenham pelo menos 5 despesas efetivadas lançadas. Se não houver nenhum mês assim: `sugestão = 6 × meta_necessidades(M)` (50% da Base atual), marcada como "estimativa provisória"; se Base(M) = 0 também, não há sugestão e o card pede para lançar a renda. Média arredondada para o centavo (meio para cima). Exemplo: Necessidades de ago/set/out = 2.900 / 3.100 / 3.000 → média 3.000,00 → meta sugerida R$ 18.000,00.

**RN-53 — Meta manual.** O usuário pode aceitar a sugestão ou digitar outra meta (`meta_manual = true`). A sugestão é recalculada no dia 1 de cada mês e quando o usuário abre a tela, mas **nunca sobrescreve** uma meta manual; se a sugestão mudar mais de 10%, o card mostra "Sugestão atualizada: R$ X — usar?".

**RN-54 — Aporte.** Aporte = despesa em categoria da faixa Poupança com `alimenta_reserva = true`, em meio imediato (dinheiro saindo da conta para guardar). Categorias de Poupança com `alimenta_reserva = false` contam no 50/30/20, mas não na barra da reserva.

**RN-55 — Saldo inicial.** No onboarding ou na tela da reserva o usuário pode informar quanto já tem guardado (`saldo_inicial`, padrão 0).

**RN-56 — Progresso.** `progresso = saldo_inicial + Σ aportes efetivados − Σ resgates efetivados` (todos os meses). Percentual exibido = `min(100, floor(progresso × 100 / meta))`; o valor absoluto pode passar da meta ("Meta batida + R$ X"). Progresso negativo é exibido como 0% com aviso "Os resgates passaram do que foi guardado". A primeira vez que o progresso ≥ meta registra `meta_atingida_em` e exibe uma única vez o aviso informativo "Reserva de emergência completa", sem animação comemorativa (US-65).

### 4.9 Regras de categorização que aprendem

**RN-57 — Normalização de descrição.** Para comparar: (1) maiúsculas; (2) remover acentos (Unicode NFD sem marcas); (3) trocar todo caractere não alfanumérico por espaço; (4) remover tokens que contenham dígito; (5) remover stopwords; (6) colapsar espaços. Exemplo: `"PAG*PostoIpiranga 1234 - Campo Mourão"` → `"POSTOIPIRANGA CAMPO MOURAO"`.

**RN-58 — Stopwords** (lista inicial, configurável em código): PAG, PAGTO, PGTO, PAGAMENTO, COMPRA, COMPRAS, CARTAO, CREDITO, DEBITO, DEB, CRED, PIX, ENVIADO, RECEBIDO, TRANSF, TRANSFERENCIA, TED, DOC, BOLETO, NU, BB, EC, ELO, VISA, MASTER, MASTERCARD, LTDA, ME, EIRELI, SA, DE, DA, DO, DAS, DOS, E.

**RN-59 — Casamento.** Uma regra com termo `t` (já normalizado, ≥ 4 caracteres) casa com a descrição normalizada `d` se `t` aparece em `d` **começando no início de um token** (não exige terminar no fim de token). Ex.: termo "POSTO" casa com "POSTOIPIRANGA CAMPO MOURAO" e com "AUTO POSTO SAO JOSE", mas não com "IMPOSTO". Regra com `conta_id` só vale para transações daquela conta.

**RN-60 — Precedência.** Se várias regras casam: (1) regra com `conta_id` vence a sem conta; (2) termo mais longo vence; (3) empate → `ultimo_uso`/`updated_at` mais recente. Regra `manual` ou `aprendida` sempre vence regra `seed` de termo de mesmo tamanho.

**RN-61 — Onde se aplica.**
- Transação externa nova sem conciliação: categoria = regra que casar; senão a categoria do agregador mapeada (quando houver tabela de mapeamento para aquela categoria); senão "A classificar".
- Lançamento manual: quando o usuário digita a descrição **antes** de escolher a categoria, a regra pré-seleciona a categoria (destacada como "sugerida"). Nunca substitui uma categoria que o usuário já escolheu.
- Regras não alteram retroativamente lançamentos já revisados.

**RN-62 — Aprendizado.** Quando o usuário muda a categoria de um lançamento com descrição não vazia (manual ou importado), o app cria (ou atualiza, se o termo já existir) uma regra automaticamente: termo sugerido = os **2 primeiros tokens** da descrição normalizada (ou 1 token, se só houver 1), com no máximo 30 caracteres e mínimo de 4; categoria = a nova. Um toast de 8 s informa: "Regra criada: 'POSTOIPIRANGA CAMPO' → Combustível" com **Desfazer** (apaga a regra criada/restaura a anterior) e **Editar** (abre a regra para ajustar o termo). Se o termo resultante tiver < 4 caracteres, nenhuma regra é criada. Em seguida, se houver lançamentos **não revisados ou "A classificar"** que casam com a nova regra, o toast oferece "Aplicar a mais N parecidos".

**RN-63 — Contadores.** Cada vez que uma regra categoriza algo e o usuário não corrige até marcar revisado, `acertos += 1` e `ultimo_uso` = agora. Se o usuário corrigir um lançamento categorizado pela regra R para outra categoria com o mesmo termo, R é atualizada (a última correção vence).

**RN-64 — Regras seed** (origem `seed`; lista completa e idêntica a `02-tech-spec.md` §3.8): POSTO, COMBUSTIVEL, SHELL, IPIRANGA, PETROBRAS → Combustível; SUPERMERC, MERCADO, ATACADO, ATACADAO, ASSAI, CONDOR → Mercado; FARMACIA, DROGARIA, DROGA, PANVEL, RAIA, NISSEI, PAGUE MENOS → Farmácia; UBER, CABIFY → Transporte; IFOOD, RAPPI → Restaurantes e delivery; NETFLIX, SPOTIFY, DISNEY, PRIME, YOUTUBE → Assinaturas; COPEL, SANEPAR, VIVO, CLARO, TIM → Contas da casa. Termos com dígito (ex.: "99APP") não são usados, porque a etapa 4 da RN-57 remove tokens com dígito; termos com menos de 4 caracteres ("TIM") são exceção permitida só para seeds e casam apenas como token inteiro. A detecção de pagamento de fatura (RN-71) não é regra de categoria. Todo o processamento é determinístico, em código do próprio app (cliente ou Edge Function), **sem serviço pago nem IA externa**.

### 4.10 Conciliação e deduplicação

**RN-65 — Deduplicação dentro da mesma fonte.** Cada transação externa tem chave `(fonte, conta_id, external_id)` única:
- Open Finance: id da transação no agregador;
- OFX: `FITID|data|valor` (o BB pode repetir `FITID` entre lançamentos diferentes; se `FITID` ausente: hash de DTPOSTED + TRNAMT + NAME/MEMO + ordem da linha no arquivo);
- CSV: hash SHA-256 de (data, valor, descrição, identificador se houver) + ordinal para linhas idênticas no mesmo arquivo;
- NFC-e: chave de acesso de 44 dígitos.
Reimportar o mesmo arquivo ou sincronizar de novo **não** cria nada novo; o resumo mostra "N já existiam".

**RN-66 — Candidatos.** Para uma transação externa T, um lançamento L é candidato se: mesmo usuário; L não conciliado com outra T; L não `cancelada`; mesma direção (saída ↔ despesa/estorno negativo; entrada ↔ receita/estorno); **mesma conta** (a conta do app mapeada para a origem de T; para NFC-e qualquer conta); e `|data_T − data_L| ≤ J`, com J = **3 dias** para cartão de crédito e débito, **1 dia** para Pix, TED/DOC e boleto (forma informada ou inferida da descrição), **5 dias** para ocorrências de recorrência, **1 dia** para NFC-e. Só se consideram L com data nos últimos 90 dias.

**RN-67 — Decisão.**
1. **Um único** candidato com valor exatamente igual (centavos) → **conciliação automática**.
2. **Vários** candidatos com valor exato → escolhe o de menor |Δdata|; em empate → `pendente_decisao` (o usuário escolhe).
3. Nenhum exato, mas candidato com `|valor_T − valor_L| ≤ max(R$ 2,00; 2% de valor_L)` dentro de J + 2 dias → `pendente_decisao` com a sugestão "É o mesmo?".
4. Nenhum candidato → cria lançamento novo com `origem` = fonte, categoria pela RN-61, `revisado = false`.
Transações `pendente_decisao` **não contam** em nenhum cálculo até a decisão (o lançamento manual candidato já conta).

**RN-68 — Resultado da conciliação.** O lançamento L mantém categoria, descrição (se L não tinha descrição, recebe a original de T), observação e data. Se a conciliação foi aceita com valor aproximado, o valor de L passa a ser o de T (banco = verdade) e a versão anterior vai para o histórico. L recebe o vínculo com T, `revisado = true`; fatura pela RN-19 quando T trouxer referência. Conciliações automáticas dos últimos 7 dias ficam listadas em "Conciliados automaticamente" para conferência.

**RN-69 — Parcelas importadas.** Se T for parcela (metadado de parcela do agregador ou padrão `k/n` na descrição, regex `\b(\d{1,2})\s*/\s*(\d{1,2})\b` com 1 ≤ k ≤ n ≤ 48):
- existe série com mesmo cartão, mesmo n e parcela k de valor exato (tolerância R$ 0,01) na mesma fatura ±1 → concilia com a parcela k;
- não existe série e k = 1 → cria a série completa (n parcelas, total = valor × n, ajustado pela RN-21 só se o agregador informar o total) com categoria pela RN-61;
- não existe série e k > 1 (compra anterior ao app) → cria série com as parcelas k..n projetadas (as anteriores não são criadas), marcada "importada parcialmente".
Parcelas futuras projetadas pelo app e confirmadas depois pelo banco são conciliadas pela mesma regra a cada sincronização.

**RN-70 — Recorrências previstas.** T concilia com ocorrência prevista de recorrência (mesma conta, J = 5 dias) se o valor for exato, **ou** se a recorrência tiver `valor_variavel = true` e a descrição normalizada de T casar com `termo_conciliacao` da recorrência (RN-59). Nesse segundo caso o valor da ocorrência passa a ser o de T e ela vira `efetivada`. O `termo_conciliacao` é preenchido automaticamente na primeira conciliação manual aceita (2 primeiros tokens, RN-62).

**RN-71 — Pagamento de fatura e créditos no cartão.**
- Saída em conta corrente cujo valor é exatamente o total ou o saldo restante de uma fatura `fechada`, `vencida` ou `parcialmente_paga` do usuário, com data entre o fechamento e o vencimento + 5 dias, **ou** cuja descrição normalizada contenha FATURA, NUBANK, NU PAGAMENTOS, CARTAO ou OUROCARD → vira `pagamento_fatura` automaticamente se o valor for exato; senão `pendente_decisao` com sugestão "Pagamento da fatura de <mês>?".
- Entradas na conta do cartão que representem pagamento recebido ("Pagamento recebido", "PAGAMENTO EFETUADO") são marcadas `ignorada` (o pagamento já é registrado pela saída da conta corrente).
- Saída numa conta corrente e entrada em outra conta do usuário com o mesmo valor e |Δdata| ≤ 1 dia → sugestão de transferência (`pendente_decisao`).

**RN-72 — Deduplicação entre fontes.** Se T nova (ex.: OFX) casar com T já existente de outra fonte (ex.: Open Finance) — mesma conta, valor exato, |Δdata| ≤ 1 dia, e a existente ainda não pareada com outra T da nova fonte — a nova é marcada `duplicada` e vinculada à existente (pareamento 1:1: duas compras iguais no mesmo dia só se anulam par a par). NFC-e nunca é duplicata de transação bancária: ela **enriquece** o lançamento (RN-82).

**RN-73 — Desfazer conciliação.** Em qualquer lançamento conciliado, "Não é o mesmo" separa os dois: L volta ao estado anterior (do histórico) e T vira lançamento próprio (`revisado = false`) com categoria pela RN-61. Desfazer uma deduplicação (`duplicada`) cria o lançamento da T.

**RN-74 — Revisado.** Lançamentos criados por importação nascem `revisado = false` e aparecem na fila "Revisar importados". Marcam-se revisados ao tocar "OK", ao editar, ao conciliar manualmente, ou em lote ("Marcar todos como revisados", que exige que nenhum esteja em "A classificar").

### 4.11 Importação OFX/CSV e Open Finance

**RN-75 — OFX.** Aceitar OFX 1.x (SGML, sem fechamento de tags) e 2.x (XML); codificação declarada no cabeçalho (`CHARSET:1252`/`ENCODING:USASCII`) ou detectada (UTF-8 → Windows-1252 como fallback). Usar `STMTTRN`: `DTPOSTED` (primeiros 8 dígitos AAAAMMDD), `TRNAMT` (ponto ou vírgula como decimal; negativo = saída), `FITID`, `NAME`/`MEMO` (descrição = MEMO se existir, senão NAME). Ler `BANKID`/`ACCTID` para sugerir a conta. Arquivo até 5 MB e 5.000 transações. Processamento **no aparelho**.

**RN-76 — CSV.** Mapeador configurável: separador (`,` `;` tab, detectado), codificação, linha de cabeçalho, coluna de data e formato (DD/MM/AAAA ou AAAA-MM-DD), coluna de valor (decimal `,` ou `.`), convenção de sinal (negativo = saída, ou positivo = saída para fatura de cartão), coluna de descrição e coluna de identificador opcional. Presets **"Nubank — fatura"** (colunas `date,title,amount`, AAAA-MM-DD, positivo = compra) e **"Nubank — conta"** (colunas `Data,Valor,Identificador,Descrição`, DD/MM/AAAA, negativo = saída) **a validar com arquivos reais do cliente** (pergunta Q1). O mapeamento escolhido é salvo por conta para a próxima importação.

**RN-77 — Mês fechado com conciliação.** O mês M pode ser fechado (US-36) quando: nenhuma T com data em M está `pendente_decisao`; nenhum lançamento com mês de impacto M está em "A classificar"; todos os importados com data em M estão `revisado = true`; e todas as faturas com vencimento em M estão `paga` ou o usuário confirmou o saldo em aberto. Fechar grava um snapshot dos totais; editar depois é permitido, com aviso "Este mês já foi fechado" e o snapshot é refeito ao fechar de novo.

**RN-78 — Fluxo de importação.** Todo arquivo passa por uma **prévia** (quantas novas, quantas já existiam, quantas serão conciliadas, quantas ficam para decidir) antes de gravar; gravar é tudo-ou-nada; "Desfazer importação" fica disponível por 24 h e remove o que a importação criou (sem tocar em lançamentos manuais, que só perdem o vínculo).

**RN-79 — Open Finance: conexão.** Cada usuário conecta os próprios bancos no **Meu Pluggy** e informa no app o(s) Item ID(s). Client ID/Secret da Pluggy ficam **apenas** no servidor (segredos da Edge Function ou Vault), nunca no aparelho nem no banco em texto puro. Ao validar o item, o app lista as contas do agregador (conta corrente, cartão) e o usuário as mapeia para contas do app (ou cria novas).

**RN-80 — Open Finance: sincronização.** Automática 2×/dia às 07:40 e 19:40 (pg_cron → Edge Function; a Pluggy atualiza os dados do banco 1×/dia), por webhook quando a Pluggy avisar, e manual pelo botão "Atualizar agora" (no máximo 1 vez por hora por conexão, limite do `PATCH /items`). Primeira sincronização: últimos 90 dias. Seguintes: desde a maior data já importada − 10 dias (janela de sobreposição; RN-65 evita duplicar). Lançamentos com data anterior ao início do uso do app (data do onboarding) entram como `revisado = true` e não geram pendências de mês fechado.

**RN-81 — Open Finance: estados.** `ativa`, `atualizando`, `erro_login`/`expirada` (precisa reconectar no Meu Pluggy), `erro_temporario` (nova tentativa automática em 1 h, até 3 vezes). Mudança para `expirada`/`erro_login` ou consentimento vencendo em ≤ 7 dias gera aviso (RN-94). Com conexão expirada, o app continua funcionando e sugere OFX/CSV como plano B.

### 4.12 NFC-e

**RN-82 — Leitura do QR.** O QR da NFC-e contém uma URL com parâmetro `p` = `chave|versão|ambiente|...`. O app extrai a **chave de acesso** (44 dígitos) e valida o dígito verificador (módulo 11). Da chave tira: UF (2 primeiros dígitos; 41 = PR), AAMM de emissão, CNPJ do emitente (posições 7–20) e modelo (65 = NFC-e). No formato de emissão em contingência (offline), o QR também traz dia e valor total. A Edge Function busca a página pública **somente** se o host da URL estiver na allowlist da SEFAZ-PR (domínios `*.fazenda.pr.gov.br`; demais → fallback RN-84), extrai nome do emitente, data/hora, valor total, forma de pagamento e itens (descrição, quantidade, unidade, valor unitário, valor total).

**RN-83 — Uso dos dados.** Com o valor total e a data: procura lançamento candidato (RN-66 com J = 1 dia, qualquer conta, valor exato). Se achar → **enriquece** o lançamento (anexa loja e itens, preenche descrição se vazia). Se não achar → abre o lançamento pré-preenchido (valor, data, descrição = nome do emitente, categoria pela RN-61 com o nome; meio sugerido pela forma de pagamento da nota quando houver só um meio compatível) para o usuário confirmar meio e categoria.

**RN-84 — Fallback.** Se a página falhar (timeout 10 s, formato desconhecido, UF ≠ PR, sem rede): registra o que a chave e o QR permitem (CNPJ formatado do emitente como descrição, mês/ano de emissão; dia e valor quando o QR for de contingência) e o usuário digita o valor. A NFC-e fica `estado_leitura = parcial` com ação "Tentar ler a nota de novo" (disponível por 7 dias).

**RN-85 — NFC-e repetida.** A mesma chave lida de novo mostra "Essa nota já foi lida em dd/mm" com link para o lançamento; não cria nada.

### 4.13 Lembretes e avisos

**RN-86 — Regras gerais.** Horários no fuso America/Sao_Paulo. Um job pg_cron a cada 15 min avalia os gatilhos (tolerância: até 15 min depois do horário). Janela de silêncio padrão 22:00–07:59: push que cairia nela vai para 08:00. Deduplicação por `(user_id, tipo, chave_referencia, data_ref)` em `notificacao_log`. Todo push também cria um item na **central de avisos** do app; sem permissão de push (ou sem app instalado no iPhone), só a central. Cada tipo pode ser desligado nas configurações. Assinatura que retornar 404/410 do serviço de push é desativada.

**RN-87 — Lembrete diário de lançar.** No horário configurado (padrão **20:00**), se o usuário **não criou nenhum lançamento manual** naquele dia (por `created_at` no fuso local). Máximo 1 por dia. Texto (UX 6.7, #7): título "Registrar gastos de hoje", corpo "Nenhum lançamento hoje. Registre agora para manter o mês atualizado."

**RN-88 — Fatura fechou.** No dia do fechamento, às 09:00: "Fatura <cartão> de <mês> fechou" / "Total de R$ X, com vencimento em dd/mm." (UX 6.7, #18). Só se total > 0.

**RN-89 — Vencimento de fatura.** Às 09:00 de **D−3** e de **D0** (D = data de vencimento), se a fatura não estiver `paga`. Texto com valor restante. Se o Open Finance já registrou o pagamento, não envia.

**RN-90 — Conta fixa a pagar.** Para ocorrências de recorrência de **despesa** em meio imediato com `confirmacao_automatica = false`: às 09:00 de **D−1** ("<descrição> vence amanhã" / "≈ R$ X em dd/mm.", UX 6.7, #3).

**RN-91 — Conta fixa atrasada / receita não confirmada.** Às 09:00 de **D+1**, se a ocorrência de despesa (RN-90) ainda estiver `prevista` ("Confirmar <descrição>", UX #19) ou se uma receita fixa/A receber/Prevista não estiver confirmada ("Confirmar <descrição>", UX #20). Uma vez por ocorrência.

**RN-92 — Limite perto/estourado.** Depois de qualquer mudança que altere o consumo, se `consumo/meta` de **Necessidades** ou **Desejos**, ou `consumo/limite` de uma categoria com limite, cruzar **80%** ou **100%** pela primeira vez no mês → aviso. Máximo 1 por (faixa ou categoria, limiar, mês). No aparelho onde a mudança ocorreu, aparece na hora como toast; o push é enviado pelo job seguinte. Não se aplica a Poupança nem quando Base(M) = 0.

**RN-93 — Resumo semanal.** Padrão **domingo às 19:00** (dia e hora configuráveis). Conteúdo: total gasto na semana (segunda a domingo da semana corrente, despesas efetivadas por data), 3 categorias com maior gasto, dias com lançamento na semana (x/7), **"Gasto no mês: R$ X"** (GR da RN-47) e, se houver, o estado da faixa mais crítica ("Necessidades: passou do planejado." / "Desejos: atenção."; D-081). Se não houve nenhum lançamento na semana, o resumo completo **não** é enviado; no lugar dele vai a versão curta "Nenhum lançamento nesta semana. Registre seus gastos para manter o mês em dia."

**RN-94 — Conexão bancária.** Ao entrar em `expirada`/`erro_login` (uma vez por mudança de estado) e quando o consentimento vencer em ≤ 7 dias (uma vez). Texto com ação "Reconectar".

### 4.14 Offline e sincronização

**RN-95 — Escrita local primeiro.** Toda criação/edição/exclusão é gravada no IndexedDB e entra numa fila de alterações; a interface confirma na hora, com ou sem rede. IDs são UUID gerados no aparelho.

**RN-96 — Envio.** A fila é enviada em ordem quando há rede (evento `online`, abertura do app, a cada 60 s com o app aberto e via Background Sync onde houver). Falha → nova tentativa com espera exponencial (5 s, 15 s, 1 min, 5 min, depois a cada 5 min). Em seguida o app baixa as mudanças do servidor desde o último `updated_at` recebido.

**RN-97 — Conflito: última edição vence.** Se o mesmo registro foi alterado em dois aparelhos desde a última sincronização, vence a versão com maior `client_updated_at` (relógio híbrido do aparelho, limitado pelo servidor a `now() + 5 min`; empate: maior `device_id` em ordem lexicográfica). A versão perdedora é gravada em `lancamento_historico` com motivo `conflito` e fica visível no "Histórico" do lançamento, com opção "Restaurar esta versão".

**RN-98 — Histórico.** Toda edição de lançamento guarda a versão anterior em `lancamento_historico` (motivo `edicao`). Retenção: todas as versões por 12 meses.

**RN-99 — Exclusão lógica.** Exclusões usam `deleted_at` para sincronizar; o item some da interface na hora e o toast oferece "Desfazer" por 8 s (padrão de toast com ação do UX). Expurgo físico após 90 dias.

**RN-100 — Nuvem é a fonte da verdade.** O app pede armazenamento persistente (`navigator.storage.persist()`). Se o IndexedDB for limpo (comum no iPhone), o app baixa tudo de novo ao abrir com rede. Ao **sair** da conta: se houver alterações não enviadas, avisa "Há N alterações que ainda não foram para a nuvem" e só sai após enviar ou após confirmação explícita de descarte; ao sair, apaga os dados locais.

### 4.15 Segurança, privacidade e telemetria

**RN-101 — Allowlist.** Só os 2 e-mails Google configurados no servidor (tabela `app.allowed_emails`, preenchida pelo cliente no SQL Editor; **nunca** no código do cliente nem no repositório, que é público) conseguem criar sessão. Outro e-mail vê "Este app é de uso privado" e a sessão é encerrada; nenhum dado é criado.

**RN-102 — RLS.** Toda tabela com dados de usuário tem RLS ativa e forçada com política `user_id = auth.uid()` para SELECT, INSERT e UPDATE; DELETE é **revogado** do cliente (a exclusão é lógica, RN-99, e o expurgo físico é job do servidor). Edge Functions usam a identidade do usuário (JWT) e só usam a service role em jobs agendados, sempre filtrando por `user_id`. Teste automatizado obrigatório: usuário A não lê nem altera nada de B.

**RN-103 — Ocultar valores.** Configuração "Ocultar valores" (e atalho por toque no ícone de olho do painel) substitui todos os valores monetários da interface por `R$ ••••` (4 pontos, igual no UX e na técnica); textos lidos por leitor de tela dizem "valor oculto". Notificações push respeitam: com a opção ligada, não mostram valores.

**RN-104 — Telemetria interna.** O app registra só eventos de uso necessários às métricas (seção 1.6): `app_aberto`, `lancamento_iniciado`, `lancamento_salvo {duracao_ms, offline, origem}`, `sync_ok`, `sync_falha {codigo}`, `importacao_concluida {fonte, novas, conciliadas, pendentes}`, `mes_fechado`, `push_recebido {tipo}`, `regra_corrigida`. Sem valores monetários nem descrições nos eventos. Ficam no Supabase do próprio usuário (RLS), retenção 180 dias, sem terceiros.

---

## 5. Backlog

### 5.1 Convenções

- **Prioridade (MoSCoW):** Must / Should / Could. Os itens Won't estão na seção 1.3.
- **Estimativa relativa:** **P** (≤ 0,5 dia de uma sessão de desenvolvimento), **M** (~1 dia), **G** (2–3 dias; candidata a ser quebrada se passar disso).
- **Camada/semana:** N1 = S1, N2 = S2 (núcleo, S1–2), OF = S3, IMP = S4.
- **Depende de:** histórias que precisam estar *Done* antes desta começar.
- Cenários em Gherkin pt-BR. "Dado que hoje é dd/mm/aaaa" significa relógio simulado no fuso America/Sao_Paulo.
- Toda história com interface vale para **Android Chrome, iPhone Safari (instalado) e Chrome de computador** (DoD).

### 5.2 Visão por semana

| Semana | Histórias |
|---|---|
| **S1 (N1)** | US-01, US-02, US-03, US-04, US-05, US-06, US-07, US-09, US-10, US-12, US-13, US-14, US-15, US-17, US-23, US-24, US-27, US-57, US-62 |
| **S2 (N2)** | US-08, US-11, US-16, US-18, US-19, US-20, US-21, US-22, US-25, US-26, US-28, US-29, US-30, US-31, US-32, US-33, US-34, US-37, US-38, US-39, US-40, US-59, US-63, US-64 · *se sobrar tempo (senão vão para a S4)*: US-35, US-58, US-60, US-65 |
| **S3 (OF)** | US-45, US-46, US-47, US-48, US-49, US-50, US-51, US-36 |
| **S4 (IMP)** | US-52, US-53, US-54, US-55, US-56, US-41, US-42, US-43, US-44, US-61 |

Ordem de corte se o prazo apertar (primeiro a sair → último): US-65 → US-56 → US-53 → US-36 → US-35 → US-44 → US-60 → US-32. Nenhuma Must do núcleo é cortada.

### 5.3 Mapa de épicos

| Épico | Histórias |
|---|---|
| E01 Fundação e acesso | US-01 a US-05 |
| E02 Onboarding e instalação | US-06 a US-08 |
| E03 Contas e cartões | US-09 a US-11 |
| E04 Lançamentos | US-12 a US-16 |
| E05 Faturas e parcelamento | US-17 a US-22 |
| E06 Receitas e recorrências | US-23 a US-26 |
| E07 Categorias e regras | US-27 a US-29 |
| E08 Orçamento, painel e reserva | US-30 a US-36 |
| E09 Lembretes e avisos | US-37 a US-44 |
| E10 Open Finance | US-45 a US-47 |
| E11 Conciliação | US-48 a US-51 |
| E12 Importação OFX/CSV | US-52, US-53 |
| E13 NFC-e | US-54 a US-56 |
| E14 Configurações, privacidade e dados | US-57 a US-61 |
| E15 Visual, estados vazios e erros | US-62 a US-65 |

---

### E01 — Fundação e acesso

#### US-01 — Entrar com a minha conta Google
**Como** usuário, **quero** entrar com a minha conta Google **para** acessar meus dados sem criar senha.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | — | RN-100, RN-101, RN-40, RN-64 |

```gherkin
Cenário: Primeiro login de um e-mail autorizado
  Dado que meu e-mail Google está na allowlist do servidor
  E que eu nunca entrei no app
  Quando eu toco em "Entrar com Google" e concluo o login
  Então minha conta é criada com as categorias padrão da RN-40, as regras seed da RN-64 e as configurações padrão
  E eu sou levado ao onboarding (US-06/US-07)

Cenário: E-mail fora da allowlist
  Dado que meu e-mail Google não está na allowlist
  Quando eu concluo o login com Google
  Então vejo "Este app é de uso privado" e a sessão é encerrada
  E nenhum registro com o meu id é criado em nenhuma tabela

Cenário: Abrir o app sem internet com sessão anterior
  Dado que eu já entrei antes neste aparelho
  E que o aparelho está sem rede
  Quando eu abro o app
  Então vejo meus dados locais sem tela de login
  E consigo lançar normalmente

Cenário: Sair com alterações ainda não enviadas
  Dado que tenho 3 alterações na fila de sincronização
  Quando eu toco em "Sair"
  Então vejo "Há 3 alterações que ainda não foram para a nuvem" com as opções "Enviar e sair" e "Sair e descartar"
  E ao concluir a saída os dados locais deste aparelho são apagados
```

#### US-02 — Meus dados só meus
**Como** usuário, **quero** que a outra pessoa que usa o app não consiga ver nem alterar nada meu **para** ter privacidade total.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-01 | RN-102 |

```gherkin
Cenário: Leitura cruzada bloqueada
  Dado os usuários A e B, cada um com lançamentos
  Quando A consulta qualquer tabela pela API com o próprio token
  Então só recebe linhas com user_id = A

Cenário: Escrita cruzada bloqueada
  Quando A tenta inserir ou atualizar uma linha com user_id = B
  Então a operação é rejeitada pela política RLS

Cenário: Nova tabela sem RLS
  Dado uma migração que cria uma tabela com coluna user_id
  Quando a suíte de testes roda
  Então o teste "toda tabela com user_id tem RLS forçada, políticas de select/insert/update e DELETE revogado" falha se algo estiver ausente
```

#### US-03 — App instalável que abre sem internet
**Como** usuário, **quero** que o app abra e funcione mesmo sem sinal **para** lançar na fila do caixa.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | — | RN-95 |

```gherkin
Cenário: Requisitos de instalação
  Quando o app é auditado
  Então o manifest tem name "OakFinance", short_name "OakFinance", start_url, display "standalone", theme_color, background_color e ícones 192, 512 e maskable com o monograma tipográfico do OakFinance (sem figuras)
  E existe apple-touch-icon 180x180 (monograma tipográfico) e meta tag apple-mobile-web-app-title "OakFinance"
  E o service worker pré-carrega o shell do app

Cenário: Abrir offline depois do primeiro acesso
  Dado que abri o app uma vez com rede
  Quando abro o app em modo avião
  Então a tela inicial carrega em menos de 1,5 s sem erro de rede

Cenário: Nova versão publicada
  Dado que uma nova versão foi publicada
  Quando abro o app
  Então vejo o aviso "Nova versão disponível" com o botão "Atualizar"
  E a atualização nunca recarrega a página enquanto um lançamento está sendo digitado
```

#### US-04 — Lançar offline e sincronizar sozinho
**Como** usuário, **quero** que o que eu lanço sem rede vá para a nuvem quando a rede voltar **para** nunca perder um gasto.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | G | N1 · S1 | US-01, US-03 | RN-95 a RN-99 |

```gherkin
Cenário: Salvar sem rede
  Dado que o aparelho está sem rede
  Quando salvo um lançamento
  Então ele aparece na lista na hora com o selo textual "Não sincronizado"
  E o painel é recalculado

Cenário: Rede volta
  Dado 5 lançamentos não sincronizados
  Quando o aparelho volta a ter rede com o app aberto
  Então em até 60 s os 5 estão no servidor, na ordem em que foram feitos, e o selo some

Cenário: Conflito entre dois aparelhos
  Dado o lançamento L sincronizado no celular e no computador
  E que, offline, mudo o valor para R$ 50,00 no celular às 10:00 e para R$ 60,00 no computador às 10:05
  Quando os dois sincronizam
  Então L fica com R$ 60,00 nos dois aparelhos
  E o histórico de L mostra a versão de R$ 50,00 com o motivo "conflito" e a opção "Restaurar esta versão"

Cenário: Servidor indisponível
  Dado que o envio falha com erro 5xx
  Então o app tenta de novo em 5 s, 15 s, 1 min, 5 min e depois a cada 5 min
  E depois da 3ª falha seguida mostra o banner G04 "{n} lançamentos não foram sincronizados. Eles continuam salvos no aparelho." com "Tentar novamente"

Cenário: Exclusão sincronizada
  Quando excluo um lançamento no celular e sincronizo
  Então ele some do computador na próxima sincronização
```

#### US-05 — App sempre de pé e dados que não somem
**Como** usuário, **quero** que o app não "durma" nem perca meus dados locais **para** confiar nele todo dia.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-01 | RN-100 |

```gherkin
Cenário: Ping contra pausa do Supabase Free
  Dado um agendador gratuito externo ao Supabase (ex.: Cloudflare Worker com Cron Trigger ou GitHub Actions agendado)
  Quando passam 3 dias
  Então ele faz uma consulta leve a um endpoint de saúde que toca o banco
  E a execução fica registrada com sucesso ou falha

Cenário: Armazenamento persistente
  Quando o app abre pela primeira vez instalado
  Então chama navigator.storage.persist() e guarda o resultado na telemetria

Cenário: Dados locais apagados pelo sistema
  Dado que o iPhone limpou o IndexedDB do app
  Quando abro o app com rede
  Então vejo "Recuperando seus dados…" e em seguida todos os meus dados da nuvem
```

---

### E02 — Onboarding e instalação

#### US-06 — Instalação guiada no iPhone
**Como** usuário de iPhone, **quero** um passo a passo para colocar o app na tela de início **para** receber lembretes e abrir com um toque.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | US-03 | RN-86 |

No iPhone o guia vem **antes** do login (UX §2.3): o app instalado na Tela de Início tem armazenamento e sessão separados do Safari, então entrar no Safari e instalar depois obrigaria a entrar de novo.

```gherkin
Cenário: Safari no iPhone sem o app instalado
  Dado que abro o app no Safari do iPhone e ele não está em modo standalone
  Quando toco em "Começar" na tela de boas-vindas
  Então vejo o guia em 3 passos (capturas estilizadas do Safari, sem ilustrações): tocar em "Compartilhar", escolher "Adicionar à Tela de Início", tocar em "Adicionar"
  E o guia explica em uma frase que os lembretes só funcionam com o app instalado
  E existe a opção "Continuar no navegador por enquanto", que leva ao login e mantém o card "Instale o app para receber lembretes" no Início

Cenário: Navegador embutido de outro app (WhatsApp, Instagram) ou navegador que não instala
  Dado que abri o link fora do Safari
  Então vejo "Abra este link no Safari para instalar" com o botão "Copiar link"

Cenário: App aberto pelo ícone
  Dado que o app está em modo standalone (navigator.standalone ou display-mode standalone)
  Então o guia de instalação não aparece mais
  E o próximo passo é "Ativar lembretes" (US-38), pedido somente após toque do usuário

Cenário: iOS antigo
  Dado iOS anterior à 16.4
  Então vejo "Neste iOS os lembretes não chegam como notificação; você os verá dentro do app"
  E o app funciona normalmente sem push
```

#### US-07 — Instalação guiada no Android e no computador
**Como** usuário de Android (ou no computador), **quero** instalar o app com um toque **para** usá-lo como um app comum.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-03 | — |

```gherkin
Cenário: Chrome oferece instalação
  Dado que o evento beforeinstallprompt foi capturado
  Quando toco em "Instalar app"
  Então o diálogo nativo de instalação é exibido
  E após o evento appinstalled vejo o passo "Ativar lembretes"

Cenário: Instalação nativa indisponível
  Dado que o navegador não disparou beforeinstallprompt e o app não está instalado
  Então vejo instruções manuais: menu ⋮ → "Instalar app" ou "Adicionar à tela inicial"

Cenário: Já instalado
  Dado que o app está em modo standalone
  Então nenhum convite de instalação aparece
```

#### US-08 — Configuração inicial em poucos minutos
**Como** usuário novo, **quero** cadastrar contas, cartões, salário e reserva num fluxo curto **para** ver o "Quanto ainda posso gastar" já no primeiro dia.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-09, US-10, US-23, US-33 | RN-07, RN-09, RN-32, RN-55 |

```gherkin
Cenário: Fluxo completo
  Dado que concluí a instalação
  Quando sigo os 5 passos do UX: ON04 "Lembretes", ON05 "Renda" (valor, dia, conta), ON06 "Contas e meios" (atalhos BB, Nubank, Carteira, VR, VA), ON07 "Cartões" (nome, dia de fechamento, dia de vencimento) e ON07b "Reserva" (quanto já tem guardado)
  Então vejo ON08 "Configuração concluída" e, ao seguir, o painel com o valor "Disponível para gastar"
  E onboarding_concluido_em é gravado

Cenário: Pular passos
  Quando toco em "Pular" em qualquer passo
  Então avanço sem criar nada daquele passo
  E o painel mostra o estado vazio correspondente (US-63)

Cenário: Retomar
  Dado que fechei o app no passo 3
  Quando abro de novo (mesmo offline, depois do primeiro login)
  Então volto ao passo 3 com o que já tinha preenchido (o progresso fica em profiles.onboarding)

Cenário: Refazer depois
  Então em Configurações existe "Refazer configuração inicial", que não apaga dados existentes
```

---

### E03 — Contas e cartões

#### US-09 — Cadastrar minhas contas
**Como** usuário, **quero** cadastrar conta corrente, carteira e VR/VA **para** escolher de onde sai cada gasto.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-04 | RN-07 |

```gherkin
Cenário: Criar conta corrente
  Quando crio a conta "BB" do tipo corrente, banco Banco do Brasil
  Então ela aparece como meio com as formas Pix, Débito, Boleto, TED/DOC e Outro

Cenário: Nome repetido
  Dado uma conta ativa chamada "Nubank"
  Quando tento criar outra conta ativa "nubank"
  Então vejo "Você já tem uma conta com esse nome"

Cenário: Conta de benefício
  Quando crio a conta "VR" do tipo benefício, subtipo VR
  Então ela aparece como meio imediato sem formas
```

#### US-10 — Cadastrar meus cartões de crédito
**Como** usuário, **quero** cadastrar cada cartão com dia de fechamento e de vencimento **para** que as compras caiam na fatura certa.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-09 | RN-09 a RN-11 |

```gherkin
Cenário: Criar cartão com prévia
  Dado que hoje é 05/11/2026
  Quando crio o cartão "Nubank" com fechamento dia 3 e vencimento dia 10
  Então vejo a prévia "Compras de hoje vão para a fatura de dez/2026, que vence em 10/12/2026"
  E a regra "Compra no dia do fechamento vai para a próxima fatura" vem marcada, com explicação de uma linha e opção de trocar

Cenário: Dias inválidos
  Quando informo fechamento 0 ou 32
  Então vejo "Escolha um dia entre 1 e 31" e não consigo salvar

Cenário: Dia 31
  Quando crio um cartão com fechamento dia 31
  Então vejo a nota "Em meses mais curtos, o fechamento será no último dia do mês"
```

#### US-11 — Editar e arquivar contas e cartões
**Como** usuário, **quero** corrigir dados de contas e cartões ou deixar de usá-los **para** manter a lista limpa sem perder histórico.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | N2 · S2 | US-10, US-17 | RN-07, RN-17 |

```gherkin
Cenário: Mudar dia de fechamento
  Dado o cartão A com 4 itens na fatura aberta, 2 parcelas em faturas futuras e 3 itens na fatura fechada
  Quando mudo o fechamento de 3 para 8
  Então vejo "6 itens podem mudar de fatura" antes de confirmar
  E após confirmar, só itens de faturas aberta e futuras são recalculados pela RN-12
  E itens com fatura_fixada não mudam

Cenário: Arquivar conta com lançamentos
  Quando arquivo a conta "Carteira"
  Então ela some do lançamento rápido e dos seletores
  E os lançamentos antigos continuam visíveis com o nome da conta e o selo "arquivada"

Cenário: Excluir conta sem lançamentos
  Dado uma conta sem nenhum lançamento, fatura ou recorrência
  Então a opção "Excluir" fica disponível; caso contrário só "Arquivar"
```

---

### E04 — Lançamentos

#### US-12 — Lançamento rápido de despesa
**Como** usuário na fila do caixa, **quero** registrar um gasto com valor, categoria e meio em poucos toques **para** não perder o hábito por preguiça.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | US-04, US-09, US-27 | RN-01, RN-05, RN-06, RN-104 |

```gherkin
Cenário: Caminho feliz em 3 toques
  Dado que estou em qualquer tela principal
  Quando toco no botão "+"
  Então o campo de valor já está focado com teclado numérico
  Quando digito "4590"
  Então o campo mostra "R$ 45,90"
  Quando toco no chip "Mercado"
  E toco em "Lançar"
  Então o lançamento é gravado como despesa efetivada, data de hoje, meio = último meio usado
  E vejo a confirmação (ícone de check no botão e o toast "Lançamento salvo." com "Desfazer") em menos de 300 ms, com ou sem rede
  E o evento lancamento_salvo registra duracao_ms do toque no "+" até o salvo

Cenário: Chips de categoria
  Então aparecem as 5 categorias de despesa sugeridas (UX Q01: regra aprendida, depois frequência nos últimos 30 dias) e o chip "Mais"
  E sem histórico aparecem Mercado, Restaurantes e delivery, Transporte, Combustível e Farmácia

Cenário: Campos obrigatórios
  Dado valor R$ 0,00 ou sem categoria
  Então o botão "Lançar" fica desabilitado e o texto "Informe o valor" ou "Escolha a categoria" indica o que falta

Cenário: Meio cartão de crédito
  Quando escolho o meio "Crédito · Nubank"
  Então aparece o seletor de parcelas "À vista | 2x … 48x" (US-20)
  E antes de salvar vejo "Entra na fatura de <mês>, vence <dd/mm>" (US-17)

Cenário: Abrir mais detalhes sem perder o que digitei
  Quando toco em "Mais detalhes"
  Então abro o formulário completo (US-13) com valor, categoria e meio preservados
```

#### US-13 — Lançamento completo e edição
**Como** usuário, **quero** informar data, descrição, observação e tipo, e corrigir qualquer lançamento depois **para** ter o registro certo.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | US-12 | RN-04 a RN-06, RN-61, RN-98 |

```gherkin
Cenário: Despesa agendada
  Dado que hoje é 05/11/2026
  Quando lanço uma despesa com data 20/11/2026
  Então ela fica com status prevista e selo "agendada"
  E em 20/11/2026 passa a efetivada automaticamente

Cenário: Data distante
  Quando escolho uma data mais de 60 dias antes ou depois de hoje
  Então vejo "Essa data está longe de hoje. Confirmar?" antes de salvar

Cenário: Descrição sugere categoria
  Dado a regra "POSTO" → Combustível
  E que ainda não escolhi categoria
  Quando digito a descrição "Posto Ipiranga"
  Então a categoria Combustível é pré-selecionada com o rótulo "sugerida"
  Mas se eu já tinha escolhido Mercado, a categoria continua Mercado

Cenário: Editar guarda histórico
  Quando mudo o valor de um lançamento de R$ 45,90 para R$ 49,50
  Então o histórico do lançamento mostra a versão anterior com data e aparelho

Cenário: Lançar receita e transferência
  Então o formulário permite tipo despesa, receita e transferência, e cada tipo mostra só os campos dele
```

#### US-14 — Excluir com desfazer
**Como** usuário, **quero** excluir um lançamento errado e poder desfazer **para** corrigir sem medo.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-13 | RN-99, RN-25, RN-30 |

```gherkin
Cenário: Excluir avulso
  Quando excluo um lançamento avulso
  Então ele some da lista e do painel na hora
  E o toast "Lançamento excluído." oferece "Desfazer" por 8 s

Cenário: Excluir item de série ou recorrência
  Quando excluo uma parcela
  Então vejo as opções da RN-25
  Quando excluo uma ocorrência de recorrência
  Então vejo "Pular este mês", "Encerrar a partir desta" (RN-30) e "Cancelar"
```

#### US-15 — Ver, filtrar e buscar lançamentos
**Como** usuário, **quero** ver os lançamentos do mês agrupados por dia, filtrar e buscar **para** achar qualquer gasto rápido.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | US-12 | RN-05, RN-74 |

```gherkin
Cenário: Lista do mês
  Então os lançamentos do mês aparecem agrupados por dia, do mais recente ao mais antigo, com total de saídas e entradas por dia
  E cada item mostra ícone da categoria, descrição (ou categoria), meio, valor com sinal e selos em texto (Agendada, Prevista, A receber, Atrasada, Não sincronizado, Conferir, Vinculado), conforme TransactionRow do UX

Cenário: Filtros combináveis
  Quando filtro por conta "Nubank", faixa "Desejos" e status "previstas"
  Então só vejo lançamentos que atendem aos três filtros e o total filtrado

Cenário: Busca sem acento e por valor
  Quando busco "farmacia"
  Então encontro "Farmácia São João"
  Quando busco "45,90"
  Então encontro lançamentos de R$ 45,90

Cenário: Desempenho
  Dado 5.000 lançamentos locais
  Então a lista abre e rola sem travar (virtualização) e a busca responde em menos de 300 ms
```

#### US-16 — Transferir entre minhas contas
**Como** usuário, **quero** registrar saque e Pix entre minhas próprias contas **para** que isso não conte como gasto.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | N2 · S2 | US-13 | RN-04, RN-08 |

```gherkin
Cenário: Saque
  Quando registro transferência de R$ 200,00 de "BB" para "Carteira"
  Então o painel, o 50/30/20 e a reserva não mudam

Cenário: Mesma conta ou cartão
  Então não consigo escolher a mesma conta como origem e destino
  E cartão de crédito não aparece como destino (use pagamento de fatura)
```

---

### E05 — Faturas e parcelamento

#### US-17 — Compra no cartão cai na fatura certa
**Como** usuário, **quero** que cada compra no cartão vá automaticamente para a fatura correta **para** saber quanto vou pagar em cada mês.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | US-10, US-12 | RN-10 a RN-13 |

```gherkin
Esquema do Cenário: Atribuição de fatura (casos da RN-12)
  Dado o cartão com fechamento <F>, vencimento <V> e regra <regra>
  Quando lanço uma compra à vista em <compra>
  Então ela entra na fatura que fecha em <fecha> e vence em <vence>

  Exemplos:
    | F  | V  | regra   | compra     | fecha      | vence      |
    | 3  | 10 | proxima | 02/11/2026 | 03/11/2026 | 10/11/2026 |
    | 3  | 10 | proxima | 03/11/2026 | 03/12/2026 | 10/12/2026 |
    | 3  | 10 | atual   | 03/11/2026 | 03/11/2026 | 10/11/2026 |
    | 3  | 10 | proxima | 04/11/2026 | 03/12/2026 | 10/12/2026 |
    | 25 | 5  | proxima | 24/11/2026 | 25/11/2026 | 05/12/2026 |
    | 25 | 5  | proxima | 25/11/2026 | 25/12/2026 | 05/01/2027 |
    | 31 | 8  | proxima | 27/02/2027 | 28/02/2027 | 08/03/2027 |
    | 31 | 8  | proxima | 28/02/2027 | 31/03/2027 | 08/04/2027 |
    | 31 | 8  | proxima | 30/04/2027 | 31/05/2027 | 08/06/2027 |

Cenário: Confirmação visível
  Quando escolho um cartão como meio no lançamento
  Então vejo "Entra na fatura de <mês>, vence <dd/mm>" antes de salvar
```

#### US-18 — Ver minhas faturas
**Como** usuário, **quero** ver a fatura aberta, as fechadas e as futuras com seus itens **para** não ser surpreendido.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-17 | RN-13 a RN-15, RN-18 |

```gherkin
Cenário: Visão do cartão
  Dado que hoje é 15/11/2026 e o cartão A (F=3, V=10)
  Então vejo a fatura dez/2026 como "aberta — fecha em 03/12 (18 dias)" com total parcial
  E as faturas futuras com as parcelas projetadas e seus totais
  E as faturas anteriores com status em texto (paga, vencida, parcialmente paga)

Cenário: Status vencida
  Dado a fatura nov/2026 de R$ 1.200,00 sem pagamento e hoje 11/11/2026
  Então ela aparece como "vencida" com "R$ 1.200,00 em aberto"

Cenário: Saldo credor
  Dado a fatura nov/2026 fechada com total -R$ 30,00
  Então a fatura dez/2026 recebe o item "Saldo credor da fatura anterior" de -R$ 30,00

Cenário: Mover item de fatura
  Quando uso "Mover para a fatura de jan/2027" em um item de uma fatura não paga
  Então o item muda de fatura, recebe fatura_fixada e não é recalculado se eu mudar o fechamento do cartão
```

#### US-19 — Registrar pagamento da fatura
**Como** usuário, **quero** marcar que paguei a fatura (total ou parcial) **para** que o painel e a conta corrente fiquem certos sem contar o gasto duas vezes.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N2 · S2 | US-18, US-09 | RN-04, RN-14 a RN-16 |

```gherkin
Cenário: Pagamento total
  Dado a fatura nov/2026 fechada de R$ 1.200,00
  Quando toco em "Registrar pagamento" e confirmo R$ 1.200,00 saindo de "BB"
  Então a fatura fica "paga"
  E o painel não muda de valor (os itens já contavam; o pagamento não é despesa)

Cenário: Pagamento parcial
  Quando pago R$ 500,00 dessa fatura
  Então ela fica "parcialmente paga" com "R$ 700,00 em aberto"
  E nenhum juro é calculado

Cenário: Pagamento acima do total
  Quando pago R$ 1.250,00
  Então a fatura fica "paga" e a próxima recebe o item "Saldo credor da fatura anterior" de -R$ 50,00
```

#### US-20 — Compra parcelada projetada
**Como** usuário, **quero** lançar uma compra parcelada uma única vez **para** ver todas as parcelas nas faturas futuras.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-17 | RN-20 a RN-23 |

```gherkin
Esquema do Cenário: Divisão das parcelas
  Quando lanço <entrada> em <n> parcelas
  Então as parcelas são <parcelas>

  Exemplos:
    | entrada             | n  | parcelas                    |
    | total R$ 100,00     | 3  | 33,34 · 33,33 · 33,33       |
    | total R$ 1.000,00   | 10 | 10 × 100,00                 |
    | total R$ 99,99      | 2  | 50,00 · 49,99               |
    | total R$ 0,10       | 3  | 0,04 · 0,03 · 0,03          |
    | parcela R$ 49,90    | 10 | 10 × 49,90 (total 499,00)   |

Cenário: Parcelas nas faturas
  Dado o cartão A (F=3, V=10, proxima)
  Quando lanço R$ 1.000,00 em 10x em 05/11/2026
  Então existem parcelas de 1/10 em dez/2026 até 10/10 em set/2027
  E a parcela 1 está efetivada e as demais previstas

Cenário: Limites
  Quando informo 1 ou 49 parcelas, ou total menor que o número de parcelas em centavos
  Então vejo a mensagem de validação e não salvo

Cenário: Só no crédito
  Dado o meio "Pix · BB"
  Então a opção "Parcelar" não aparece
```

#### US-21 — Editar ou cancelar compra parcelada
**Como** usuário, **quero** corrigir ou cancelar uma compra parcelada **para** refletir devolução ou erro de digitação.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-20, US-19 | RN-24, RN-25 |

```gherkin
Cenário: Mudar categoria da compra toda
  Quando mudo a categoria da parcela 3/10 e escolho "Toda a compra"
  Então as 10 parcelas mudam de categoria

Cenário: Mudar total sem faturas pagas
  Dado nenhuma parcela em fatura paga
  Quando mudo o total de R$ 1.000,00 para R$ 1.200,00
  Então as 10 parcelas são regeneradas com R$ 120,00 cada, mesmo serie_id

Cenário: Mudar total com fatura paga
  Dado a parcela 1/10 em fatura paga
  Quando tento mudar o total
  Então vejo "Algumas parcelas já estão em faturas pagas. Você pode cancelar as parcelas restantes e lançar o novo valor."

Cenário: Cancelar parcelas restantes
  Dado hoje 15/01/2027 e a série com parcelas em dez/2026 (paga), jan/2027 (fechada), fev/2027 (aberta) e mar..set/2027 (futuras)
  Quando escolho "Cancelar parcelas restantes"
  Então as parcelas de fev/2027 a set/2027 ficam canceladas e as de dez/2026 e jan/2027 permanecem

Cenário: Apagar a compra inteira com fatura paga
  Quando escolho "Apagar a compra inteira"
  Então vejo "A fatura de dez/2026, já paga, vai deixar de mostrar R$ 100,00" e preciso confirmar duas vezes
```

#### US-22 — Estorno no cartão
**Como** usuário, **quero** lançar um estorno **para** que a devolução reduza a fatura e o gasto da categoria.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | N2 · S2 | US-17 | RN-37 |

```gherkin
Cenário: Estorno vinculado
  Quando lanço estorno de R$ 80,00 em "Compras e vestuário" no cartão A em 06/11/2026
  Então a fatura dez/2026 recebe um item de -R$ 80,00
  E o consumo de Desejos no mês de impacto cai R$ 80,00
```

---

### E06 — Receitas e recorrências

#### US-23 — Salário como receita fixa
**Como** usuário com salário fixo, **quero** cadastrá-lo uma vez **para** que todo mês ele já entre no cálculo.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 | US-09 | RN-26 a RN-28, RN-32, RN-34, RN-38 |

```gherkin
Cenário: Cadastro e projeção
  Quando cadastro "Salário" de R$ 5.000,00 todo dia 5 na conta BB
  Então as ocorrências previstas são projetadas até o último dia de M+12 (RN-27)
  E a Base do mês corrente inclui R$ 5.000,00 mesmo antes do dia 5

Cenário: Confirmar com valor diferente
  Quando confirmo o salário de novembro com R$ 4.870,00
  Então a ocorrência fica efetivada com R$ 4.870,00 e a Base de novembro usa R$ 4.870,00

Cenário: Não recebido
  Quando marco "Não recebi este mês"
  Então a ocorrência fica cancelada e sai da Base

Cenário: Idempotência
  Dado que o celular e o computador confirmam a ocorrência de 05/12/2026 offline
  Quando os dois sincronizam
  Então existe uma única linha para (recorrência, 05/12/2026), com id determinístico, e a última edição vence (RN-97)
```

#### US-24 — Receita variável: recebida, a receber ou prevista
**Como** usuário com renda variável, **quero** lançar entradas avulsas e escolher se contam antes de cair **para** não planejar com dinheiro que não tenho.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-13 | RN-33, RN-34, RN-38 |

```gherkin
Cenário: Já caiu
  Quando lanço "Freela" de R$ 800,00 e respondo "Já caiu na conta? Sim"
  Então ela fica Recebida e soma na Base

Cenário: A receber (padrão)
  Quando lanço "Freela" de R$ 300,00 para 25/11 e respondo "Não"
  Então ela fica "A receber" e não soma na Base

Cenário: Prevista
  Quando ligo "Contar antes de receber"
  Então ela fica "Prevista", soma na Base e aparece com o rótulo "prevista" e borda tracejada

Cenário: Data passou sem confirmação
  Dado uma receita "A receber" de 25/11 não confirmada
  Quando chega 26/11
  Então vejo o aviso "Confirmar Freela" com Confirmar, Mudar data e Não vai cair
```

#### US-25 — Contas fixas e assinaturas
**Como** usuário, **quero** cadastrar aluguel, luz, internet e assinaturas como recorrências **para** que já contem no mês antes de eu pagar.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-23, US-17 | RN-26 a RN-29, RN-31 |

```gherkin
Cenário: Conta fixa no Pix com valor variável
  Quando cadastro "Luz" ≈ R$ 180,00 todo dia 20, Pix BB, valor variável, sem confirmação automática
  Então a ocorrência de novembro aparece como "≈ R$ 180,00" prevista e conta no painel
  E em 21/11, se não confirmada, aparece como "atrasada"

Cenário: Confirmar valor real
  Quando confirmo a luz de novembro com R$ 203,45
  Então a ocorrência fica efetivada com R$ 203,45 e a próxima mostra "≈ R$ 203,45"

Cenário: Assinatura no cartão
  Quando cadastro "Streaming" R$ 39,90 todo dia 15 no cartão A
  Então a confirmação automática vem ligada
  E a ocorrência de 15/11/2026 entra na fatura dez/2026

Cenário: Anual e dia 31
  Quando cadastro uma recorrência anual dia 31 de fevereiro
  Então ela ocorre no último dia de fevereiro de cada ano
```

#### US-26 — Editar, pular e encerrar recorrências
**Como** usuário, **quero** mudar o valor a partir de um mês, pular um mês ou encerrar uma assinatura **para** manter as projeções certas.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-23, US-25 | RN-30 |

```gherkin
Cenário: Reajuste a partir de um mês
  Dado o aluguel de R$ 1.500,00 com ocorrências efetivadas até nov/2026
  Quando edito a ocorrência de jan/2027 para R$ 1.600,00 com "Esta e as próximas"
  Então a recorrência original termina em 09/01/2027, uma nova começa em 10/01/2027 com R$ 1.600,00
  E as ocorrências de nov e dez/2026 não mudam

Cenário: Pular
  Quando escolho "Pular este mês" na ocorrência de dez/2026
  Então ela fica cancelada e sai do painel de dezembro

Cenário: Encerrar
  Quando encerro a assinatura em 30/11/2026
  Então as ocorrências previstas depois de 30/11/2026 são removidas e as efetivadas permanecem
```

---

### E07 — Categorias e regras

#### US-27 — Categorias padrão editáveis com faixa 50/30/20
**Como** usuário, **quero** começar com uma lista de categorias pronta, cada uma numa faixa, e poder ajustá-la **para** classificar sem pensar.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-01 | RN-39 a RN-42 |

```gherkin
Cenário: Lista inicial
  Então tenho as categorias da RN-40 com suas faixas e as categorias de sistema "A classificar" e "Saldo credor da fatura anterior"

Cenário: Trocar faixa
  Quando mudo "Pets" de Necessidades para Desejos
  Então vejo "Isso muda os totais de todos os meses" e, ao confirmar, o 50/30/20 de todos os meses é recalculado

Cenário: Excluir com uso
  Dado a categoria "Viagens" com 4 lançamentos
  Quando tento excluí-la
  Então preciso escolher uma categoria de destino e os 4 lançamentos, recorrências e regras são movidos antes da exclusão

Cenário: Categoria de sistema
  Então "A classificar" não pode ser renomeada, excluída nem escolhida no lançamento manual
```

#### US-28 — Regras que aprendem com minhas correções
**Como** usuário, **quero** que o app aprenda quando eu corrijo uma categoria **para** não corrigir a mesma coisa duas vezes.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-27, US-13 | RN-57 a RN-64 |

```gherkin
Esquema do Cenário: Normalização e casamento
  Dado a regra com termo "<termo>"
  Então a descrição "<descricao>" <resultado>

  Exemplos:
    | termo   | descricao                              | resultado   |
    | POSTO   | PAG*PostoIpiranga 1234 - Campo Mourão  | casa        |
    | POSTO   | AUTO POSTO SÃO JOSÉ                    | casa        |
    | POSTO   | IMPOSTO MUNICIPAL                      | não casa    |
    | MERCADO | SUPERMERCADO BOM PRECO                 | não casa    |

Cenário: Aprender com correção
  Dado um lançamento importado "UNIMED PARANA 0001" categorizado como "A classificar"
  Quando mudo a categoria para Saúde
  Então é criada a regra "UNIMED PARANA" → Saúde
  E vejo o toast "Regra criada: 'UNIMED PARANA' → Saúde" com Desfazer e Editar por 8 s
  E se houver outros não revisados que casam, o toast oferece "Aplicar a mais N parecidos"

Cenário: Desfazer aprendizado
  Quando toco em "Desfazer" no toast
  Então a regra criada é apagada (ou a anterior restaurada) e a categoria do lançamento continua Saúde

Cenário: Precedência
  Dado as regras "POSTO" → Combustível e "POSTO SHELL SELECT" → Lanches em Desejos
  Então "POSTO SHELL SELECT MOURAO" recebe a categoria da regra de termo mais longo

Cenário: Termo curto
  Dado a descrição "BAR"
  Quando corrijo a categoria
  Então nenhuma regra é criada
```

#### US-29 — Gerenciar regras
**Como** usuário, **quero** ver, editar e apagar regras **para** corrigir um aprendizado errado.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | N2 · S2 | US-28 | RN-59, RN-60 |

```gherkin
Cenário: Lista
  Então vejo cada regra com termo, categoria, conta (se houver), origem, acertos e último uso, ordenadas por último uso

Cenário: Testar termo
  Quando edito o termo para "UNIMED"
  Então vejo "Casaria com 7 lançamentos dos últimos 90 dias" com a lista

Cenário: Apagar
  Quando apago uma regra
  Então lançamentos já categorizados não mudam
```

---

### E08 — Orçamento, painel e reserva

#### US-30 — Início: quanto já gastei e como está minha conta
**Como** usuário, **quero** abrir o app e ver na hora quanto já gastei no mês e quanto tenho nas contas **para** acompanhar o mês sem fazer conta (D-081).

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | G | N2 · S2 | US-12, US-17, US-23, US-24, US-25, US-27 | RN-44, RN-46 a RN-51 |

```gherkin
Cenário: Caso de referência (RN-47, D-081)
  Dado os dados do caso de teste de referência da RN-47 e hoje 15/11/2026
  Quando abro o app
  Então vejo "R$ 3.350,00" com o rótulo "Gasto em novembro"
  E "Ainda vai sair este mês: R$ 280,00"
  E "Saldo nas contas" com R$ 2.450,00, que abre a lista de contas
  E não vejo "Disponível para gastar" nem o selo "No ritmo do mês"

Cenário: Compra no cartão que vence no mês seguinte
  Quando lanço R$ 150,00 no cartão A em 15/11/2026 (fatura dez/2026)
  Então o "Gasto em novembro" continua R$ 3.350,00 (o mês de impacto é dezembro, RN-46)
  E o "Saldo nas contas" não muda

Cenário: Compra no débito
  Quando lanço R$ 50,00 no débito BB em 15/11/2026
  Então o gasto passa a R$ 3.400,00 e o saldo a R$ 2.400,00 imediatamente, mesmo offline

Cenário: Estorno
  Dado um estorno de R$ 30,00 efetivado em novembro
  Então o "Gasto em novembro" diminui R$ 30,00

Cenário: Previstas fora do herói
  Dado a conta de luz de R$ 280,00 prevista para 20/11
  Então ela aparece em "Ainda vai sair este mês" e não soma no "Gasto em novembro"

Cenário: Mês sem renda
  Dado nenhum salário cadastrado e nenhuma receita em novembro
  Então vejo o gasto do mês no herói
  E a "Saúde do mês" mostra "Cadastre sua renda para acompanhar as faixas do mês." com "Cadastrar renda"

Cenário: Faixa em atenção
  Dado renda de R$ 1.000,00 e R$ 450,00 em Necessidades (meta R$ 500,00)
  Então Necessidades mostra "Atenção" com ícone e "R$ 450,00 de R$ 500,00"

Cenário: Faixa acima do planejado
  Dado renda de R$ 1.000,00 e R$ 920,00 em Necessidades
  Então Necessidades mostra "Passou do planejado" com ícone, e o card tem "Ajustar percentuais"

Cenário: Virada do mês
  Quando o relógio passa para 01/12/2026 00:00
  Então o Início mostra "Gasto em dezembro" sem carregar o gasto de novembro

Cenário: Desempenho
  Dado 5.000 lançamentos locais
  Então o recálculo após uma alteração leva menos de 200 ms
```

#### US-31 — Acompanhar o 50/30/20
**Como** usuário, **quero** ver quanto já usei de Necessidades, Desejos e Poupança **para** equilibrar o mês.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-30 | RN-41, RN-43 a RN-45 |

```gherkin
Cenário: Barras por faixa
  Dado Base R$ 5.800,00
  Então vejo Necessidades com meta R$ 2.900,00, Desejos R$ 1.740,00 e Poupança R$ 1.160,00
  E cada barra mostra "já foi" e "vai sair" separadamente, com valores e percentuais em texto

Cenário: Sem faixa
  Dado 3 lançamentos em "A classificar"
  Então vejo o grupo "Sem faixa" com "3 lançamentos para classificar" e o atalho para classificá-los

Cenário: Poupança como mínimo
  Dado aportes de R$ 200,00 e meta de R$ 1.160,00
  Então a barra de Poupança diz "Poupado R$ 200,00 de R$ 1.160,00" (sem linguagem de estouro)

Cenário: Arredondamento da meta
  Dado Base R$ 333,33 e 50%
  Então a meta de Necessidades é R$ 166,67
```

#### US-32 — Limite por categoria
**Como** usuário, **quero** definir um limite mensal para categorias específicas **para** controlar onde costumo exagerar.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | N2 · S2 | US-31 | RN-45, RN-92 |

```gherkin
Cenário: Limite e progresso
  Quando defino limite de R$ 400,00 para "Restaurantes e delivery"
  Então a categoria mostra "R$ 120,00 de R$ 400,00" no mês e no 50/30/20

Cenário: Aviso ao cruzar 80%
  Dado R$ 300,00 usados de R$ 400,00
  Quando lanço R$ 25,00 nessa categoria
  Então vejo o toast "Restaurantes e delivery atingiu 81% do limite" uma única vez no mês
```

#### US-33 — Reserva de emergência
**Como** usuário, **quero** uma meta de reserva sugerida e um indicador de progresso (`GoalProgress`) alimentado pelos aportes **para** construir minha segurança.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-27, US-30 | RN-52 a RN-56, RN-36 |

```gherkin
Cenário: Sugestão com histórico
  Dado Necessidades efetivadas de ago, set e out/2026 = R$ 2.900,00, R$ 3.100,00 e R$ 3.000,00, cada mês com 5 ou mais despesas
  Então a meta sugerida é R$ 18.000,00

Cenário: Sem histórico
  Dado nenhum mês completo com 5 despesas e Base de novembro R$ 5.800,00
  Então a sugestão é R$ 17.400,00 com o rótulo "estimativa provisória"

Cenário: Meta manual não é sobrescrita
  Dado que defini a meta manual R$ 10.000,00
  Quando no dia 1 a sugestão muda para R$ 19.000,00
  Então a meta continua R$ 10.000,00 e vejo "Sugestão atualizada: R$ 19.000,00 — usar?"

Cenário: Progresso
  Dado saldo inicial R$ 2.000,00, aportes de R$ 200,00 e R$ 300,00, e um resgate de R$ 100,00
  Então o progresso é R$ 2.400,00 e, com meta R$ 18.000,00, o indicador mostra 13%

Cenário: Resgate
  Quando registro resgate de R$ 500,00 para a conta BB
  Então o painel do mês sobe R$ 500,00, a Base não muda e o progresso da reserva cai R$ 500,00
```

#### US-34 — Ajustar como o cálculo funciona
**Como** usuário, **quero** ajustar o modo de cálculo, os percentuais e o VR/VA **para** o painel refletir meu jeito de pensar.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | N2 · S2 | US-30 | RN-35, RN-43, RN-46 |

```gherkin
Cenário: Modo competência
  Dado o caso de referência (Disponível R$ 1.210,00), em que todos os itens da fatura nov/2026 (R$ 1.200,00) são compras de outubro
  E uma compra à vista de R$ 150,00 no cartão A em 15/11/2026, única compra no cartão em novembro
  Quando troco "Compras no cartão contam no mês" de "do vencimento da fatura" para "da compra"
  Então a fatura nov/2026 deixa de pesar em novembro (+ R$ 1.200,00) e a compra de 15/11 passa a pesar (− R$ 150,00)
  E o valor principal de novembro passa a R$ 2.260,00
  E a linha "No cartão para os próximos meses" some

Cenário: Descontar a poupança do mês
  Quando desligo "Descontar a poupança do mês (20%)"
  Então AporteRestante passa a 0 e o valor principal do caso de referência sobe R$ 960,00 (para R$ 2.170,00)

Cenário: Percentuais inválidos
  Quando informo 60/30/20
  Então vejo "Os percentuais somam 110%. Ajuste para totalizar 100%." e não salvo

Cenário: Desligar VR/VA
  Dado R$ 600,00 de VR na Base e R$ 400,00 gastos com a conta VR em novembro
  Quando desligo "Considerar VR/VA nos cálculos"
  Então a Base cai R$ 600,00 e os gastos considerados caem R$ 400,00
```

#### US-35 — Analisar o mês no computador
**Como** usuário, **quero** uma visão do mês em tela grande **para** entender para onde foi o dinheiro.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | M | N2 · S2 (ou S4) | US-31 | RN-45, RN-46 |

```gherkin
Cenário: Visão em tela larga
  Dado uma janela com 1024 px ou mais
  Então vejo lado a lado: gastos por categoria (barras horizontais ordenadas), faixas vs meta, gasto acumulado por dia vs ritmo ideal, comparação por categoria com o mês anterior e os 10 maiores gastos
  E cada gráfico tem tabela equivalente acessível

Cenário: Trocar de mês
  Quando escolho outubro/2026
  Então todos os blocos mostram outubro, usando o mesmo modo de cálculo
```

#### US-36 — Fechar o mês
**Como** usuário, **quero** um checklist para fechar o mês **para** ter certeza de que nada ficou faltando ou duplicado.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | M | OF · S3 | US-49, US-31 | RN-77 |

```gherkin
Cenário: Checklist com pendências
  Dado outubro com 2 importados não revisados e 1 lançamento em "A classificar"
  Quando abro "Fechar outubro"
  Então vejo cada pendência com atalho para resolvê-la e o botão "Fechar mês" desabilitado

Cenário: Fechar
  Dado nenhuma pendência da RN-77
  Quando toco em "Fechar mês"
  Então o mês é gravado como fechado com snapshot dos totais e o evento mes_fechado é registrado

Cenário: Editar mês fechado
  Quando edito um lançamento de outubro
  Então vejo "Outubro já foi fechado. Salvar mesmo assim?" e o mês volta a "aberto para revisão"
```

---

### E09 — Lembretes e avisos

#### US-37 — Central de avisos
**Como** usuário, **quero** um lugar no app com todos os avisos **para** não depender só de notificações.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N2 · S2 | US-04 | RN-86 |

```gherkin
Cenário: Avisos (tela H02 do UX)
  Então o ícone de sino no topo do Início mostra a quantidade de avisos não lidos
  E a central funciona offline com os avisos já sincronizados e com os gerados no próprio aparelho
  E cada aviso tem título, texto, data e ação que leva à tela certa
  E avisos lidos há mais de 60 dias são removidos
```

#### US-38 — Ativar notificações push
**Como** usuário, **quero** ativar notificações no meu aparelho **para** receber os lembretes.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-06, US-07, US-37 | RN-86, RN-103 |

```gherkin
Cenário: Permissão concedida
  Dado o app instalado
  Quando toco em "Ativar lembretes" e permito
  Então a assinatura push deste aparelho é salva
  E recebo a notificação de teste "Lembretes ativos" / "É assim que os avisos de vencimento vão aparecer."

Cenário: Permissão negada
  Quando nego a permissão
  Então vejo como reativar nas configurações do sistema (texto específico para Android e iPhone)
  E os avisos continuam na central

Cenário: iPhone sem instalar
  Dado o app aberto no Safari, fora da tela de início
  Então o botão "Ativar lembretes" não aparece e vejo "Instale o app para receber lembretes" com link para o guia

Cenário: Vários aparelhos
  Dado celular e computador com push ativo
  Então cada lembrete chega nos dois

Cenário: Assinatura expirada
  Quando o serviço de push responde 404 ou 410
  Então a assinatura é desativada e o app pede para reativar na próxima abertura
```

#### US-39 — Lembrete diário para lançar
**Como** usuário, **quero** um lembrete à noite se eu não lancei nada **para** manter o hábito.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N2 · S2 | US-38 | RN-86, RN-87 |

```gherkin
Cenário: Sem lançamento no dia
  Dado que não criei nenhum lançamento manual hoje e o horário configurado é 20:00
  Então às 20:00 (tolerância de 15 min) recebo "Registrar gastos de hoje" / "Nenhum lançamento hoje. Registre agora para manter o mês atualizado."

Cenário: Já lancei
  Dado que lancei algo às 12:00
  Então não recebo o lembrete diário

Cenário: Horário no silêncio
  Dado lembrete configurado para 23:00 e silêncio 22:00–07:59
  Então ele é entregue às 08:00 do dia seguinte só se eu continuar sem lançamento referente ao dia anterior; caso contrário, é descartado
```

#### US-40 — Lembretes de fatura
**Como** usuário, **quero** ser lembrado quando a fatura fecha e antes de vencer **para** não atrasar.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N2 · S2 | US-38, US-18 | RN-88, RN-89 |

```gherkin
Cenário: Vencimento
  Dado a fatura dez/2026 de R$ 980,00 com vencimento 10/12/2026 e não paga
  Então recebo lembretes em 07/12 às 09:00 e 10/12 às 09:00 com "R$ 980,00"

Cenário: Paga antes
  Dado que registrei o pagamento em 06/12
  Então não recebo os lembretes de 07/12 e 10/12

Cenário: Fechamento
  Então em 03/12/2026 às 09:00 recebo "Fatura Nubank de dez/2026 fechou" / "Total de R$ 980,00, com vencimento em 10/12."

Cenário: Valores ocultos
  Dado "Ocultar valores" ligado
  Então o texto do push não mostra o valor
```

#### US-41 — Lembretes de contas fixas e receitas
**Como** usuário, **quero** ser lembrado de pagar contas fixas e de confirmar receitas **para** manter as projeções corretas.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | IMP · S4 | US-38, US-25, US-24 | RN-90, RN-91 |

```gherkin
Cenário: Véspera
  Dado "Luz" prevista para 20/11 em Pix, sem confirmação automática
  Então em 19/11 às 09:00 recebo "Luz vence amanhã" / "≈ R$ 180,00 em 20/11."

Cenário: Atrasada
  Dado que em 21/11 a "Luz" continua prevista
  Então às 09:00 recebo "Confirmar Luz" com ação para confirmar

Cenário: Receita
  Dado o salário de 05/12 não confirmado
  Então em 06/12 às 09:00 recebo "Confirmar Salário"

Cenário: Assinatura no cartão
  Dado uma recorrência no cartão com confirmação automática
  Então nenhum lembrete de conta fixa é enviado para ela
```

#### US-42 — Alerta de faixa ou categoria perto do limite
**Como** usuário, **quero** ser avisado quando estiver perto do limite **para** frear a tempo.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | IMP · S4 | US-38, US-31, US-32 | RN-92 |

```gherkin
Cenário: Faixa a 80% e 100%
  Dado a meta de Desejos R$ 1.740,00 e consumo R$ 1.380,00
  Quando lanço R$ 20,00 em Lazer
  Então recebo "Desejos atingiu 80% do planejado"
  E ao passar de R$ 1.740,00 recebo "Desejos acima do planejado"
  E não recebo esses dois avisos de novo em novembro

Cenário: Vindo de importação
  Dado que a sincronização do Open Finance faz Necessidades cruzar 80%
  Então o push é enviado na próxima execução do job

Cenário: Sem renda
  Dado Base = 0
  Então nenhum alerta de faixa é enviado
```

#### US-43 — Resumo semanal
**Como** usuário, **quero** um resumo da semana **para** acompanhar sem abrir o app todo dia.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | IMP · S4 | US-38, US-30 | RN-93 |

```gherkin
Cenário: Domingo à noite
  Dado gastos de segunda 09/11 a domingo 15/11/2026
  Então em 15/11 às 19:00 recebo: total gasto na semana, as 3 categorias com maior gasto, o "quanto ainda posso gastar" atual e "dias com lançamento: 6/7"

Cenário: Semana sem lançamentos
  Então recebo "Nenhum lançamento nesta semana. Registre seus gastos para manter o mês em dia."
```

#### US-44 — Preferências de notificação
**Como** usuário, **quero** escolher horários e quais lembretes recebo **para** não ser incomodado.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | IMP · S4 | US-39 | RN-86, RN-87, RN-93 |

```gherkin
Cenário: Ajustes
  Então posso ligar/desligar cada tipo (diário, fatura, contas fixas, receitas, limites, resumo semanal, conexão bancária)
  E mudar o horário do diário, o dia/hora do resumo e a janela de silêncio
  E as mudanças valem a partir da próxima execução do job
```

---

### E10 — Open Finance

#### US-45 — Conectar Banco do Brasil e Nubank
**Como** usuário, **quero** ligar meus bancos ao app **para** que as transações entrem sozinhas.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | G | OF · S3 | US-02, US-09, US-10 | RN-79 |

**Tarefa técnica de abertura (time-box de 0,5 dia):** validar na API da Pluggy, com a conta de desenvolvedor, os produtos disponíveis para BB e Nubank PF (conta, cartão, transações, faturas, metadados de parcela) e se itens criados no Meu Pluggy da Persona B ficam acessíveis pelas credenciais usadas (pergunta Q2). Resultado registrado no repositório antes de seguir.

```gherkin
Cenário: Conectar pelo widget (caminho principal)
  Dado que conectei meu banco no Meu Pluggy
  Quando toco em "Conectar banco", escolho MeuPluggy no widget Pluggy Connect e autorizo
  Então a Edge Function valida o item e lista as contas do banco (conta corrente, cartão)
  E eu mapeio cada uma para uma conta do app, crio uma nova ou ignoro

Cenário: Conectar com Item ID (plano B, se o widget falhar no iPhone)
  Quando escolho "Tenho um Item ID" e colo o código copiado do dashboard da Pluggy
  Então o fluxo segue igual ao do widget a partir da validação do item

Cenário: Item ID inválido
  Quando informo um Item ID inexistente
  Então vejo "Não encontramos essa conexão no Meu Pluggy. Confira o código." e nada é salvo

Cenário: Segredos protegidos
  Então o pacote do app no aparelho não contém o client secret da Pluggy
  E o aparelho nunca chama a API da Pluggy diretamente (só a Edge Function)

Cenário: Sem rede
  Dado o aparelho offline
  Então "Conectar banco" fica indisponível com "Precisa de internet"
```

#### US-46 — Sincronizar transações do banco
**Como** usuário, **quero** que as transações cheguem todo dia e quando eu pedir **para** não lançar tudo à mão.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | OF · S3 | US-45, US-48 | RN-65, RN-80 |

```gherkin
Cenário: Primeira sincronização
  Quando a conexão é concluída
  Então são buscadas as transações dos últimos 90 dias
  E as anteriores ao início do uso entram como revisadas

Cenário: Automática
  Então às 07:40 e às 19:40 o job busca desde a maior data importada − 10 dias e nenhuma transação já existente é duplicada

Cenário: Atualizar agora
  Quando toco em "Atualizar agora" duas vezes em 10 minutos
  Então a segunda vez mostra "Atualizado há 10 min. Tente de novo em 50 min."

Cenário: Resumo
  Então após cada sincronização vejo "N novas · N conciliadas · N para revisar"
```

#### US-47 — Estado da conexão e reconexão
**Como** usuário, **quero** saber quando a conexão com o banco parou **para** reconectar ou usar o plano B.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | OF · S3 | US-45 | RN-81, RN-94 |

```gherkin
Cenário: Conexão expirada
  Dado que a Pluggy retorna o item como expirado ou com erro de login
  Então a conexão aparece como "Precisa reconectar" com o passo a passo do Meu Pluggy
  E recebo um aviso uma única vez por mudança de estado
  E vejo o atalho "Importar extrato (OFX/CSV)"

Cenário: Erro temporário
  Dado erro 5xx da Pluggy
  Então o app tenta de novo em 1 h, até 3 vezes, sem avisar o usuário

Cenário: Última atualização
  Então cada conexão mostra "Atualizado em dd/mm às hh:mm"
```

---

### E11 — Conciliação

#### US-48 — Conciliação automática com meus lançamentos
**Como** usuário que lança na hora, **quero** que a transação do banco se junte ao meu lançamento **para** não contar o mesmo gasto duas vezes.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | G | OF · S3 | US-12, US-17, US-27 | RN-65 a RN-68, RN-72 |

O motor de conciliação é independente da fonte (Open Finance, OFX, CSV, NFC-e) e deve ser coberto por testes unitários com os cenários abaixo.

```gherkin
Esquema do Cenário: Decisão de conciliação
  Dado o lançamento manual de <valorL> em <dataL> no meio <meio>
  Quando chega a transação do banco de <valorT> em <dataT> na mesma conta
  Então o resultado é <resultado>

  Exemplos:
    | meio            | valorL    | dataL      | valorT    | dataT      | resultado                                  |
    | Crédito Nubank  | R$ 45,90  | 05/11/2026 | R$ 45,90  | 07/11/2026 | conciliado automaticamente                 |
    | Crédito Nubank  | R$ 45,90  | 05/11/2026 | R$ 45,90  | 09/11/2026 | lançamento novo (fora de 3 dias)           |
    | Pix BB          | R$ 120,00 | 05/11/2026 | R$ 120,00 | 06/11/2026 | conciliado automaticamente                 |
    | Pix BB          | R$ 120,00 | 05/11/2026 | R$ 120,00 | 07/11/2026 | lançamento novo (fora de 1 dia)            |
    | Débito BB       | R$ 50,00  | 05/11/2026 | R$ 51,50  | 05/11/2026 | pendente de decisão ("É o mesmo?")         |
    | Débito BB       | R$ 300,00 | 05/11/2026 | R$ 306,00 | 06/11/2026 | pendente de decisão (2% de 300 = 6,00)     |
    | Débito BB       | R$ 300,00 | 05/11/2026 | R$ 306,01 | 06/11/2026 | lançamento novo                            |

Cenário: Dois candidatos iguais
  Dado dois cafés manuais de R$ 5,00 em 05/11 e 06/11 no crédito Nubank
  Quando chega uma transação de R$ 5,00 em 06/11
  Então ela concilia com o café de 06/11 (menor diferença de data)
  E se chegar outra de R$ 5,00 em 06/11, concilia com o de 05/11

Cenário: Empate verdadeiro
  Dado dois lançamentos de R$ 5,00 em 05/11
  Quando chega uma transação de R$ 5,00 em 06/11
  Então ela fica pendente de decisão com os dois candidatos

Cenário: Resultado preserva o que eu escrevi
  Dado o manual "Mercado do Zé" em Mercado
  Quando concilia com "SUPERMERC ZE LTDA 4432"
  Então o lançamento mantém descrição "Mercado do Zé" e categoria Mercado, com o selo "conciliado"

Cenário: Mesma transação por duas fontes
  Dado uma transação do Open Finance de R$ 89,00 em 05/11 na conta BB
  Quando importo um OFX com a mesma transação (outro id) em 05/11
  Então a do OFX é marcada duplicada e nada novo é criado

Cenário: Pendente não conta
  Dado uma transação pendente de decisão de R$ 51,50
  Então o painel não a soma enquanto eu não decidir
```

#### US-49 — Revisar importados
**Como** usuário, **quero** uma fila curta do que veio do banco e precisa da minha atenção **para** conferir tudo em poucos minutos.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | OF · S3 | US-48, US-28 | RN-67, RN-74 |

```gherkin
Cenário: Fila
  Então a tela I05 "Conferir" mostra três grupos: "Para decidir" (pendentes, um ReconcileCard por vez), "Novos do banco" (não revisados, com "OK" por item) e "Vinculados automaticamente" (últimos 7 dias, com "Desfazer")
  E o ícone mostra a quantidade de itens dos dois primeiros grupos

Cenário: Decidir "É o mesmo?"
  Quando escolho "Sim, é o mesmo" para R$ 51,50 × R$ 50,00
  Então o lançamento passa a R$ 51,50, conciliado, e a versão de R$ 50,00 vai para o histórico
  Quando escolho "Não, são diferentes"
  Então a transação vira um lançamento novo a revisar

Cenário: Revisar em lote
  Dado 12 novos, nenhum em "A classificar"
  Quando toco em "Marcar todos como revisados"
  Então os 12 ficam revisados
  Mas se algum estiver em "A classificar", o botão pede para classificá-los antes

Cenário: Fila vazia
  Então vejo "Nenhum lançamento pendente" / "Os lançamentos importados já foram conferidos."
```

#### US-50 — Parcelas, contas fixas e pagamentos de fatura vindos do banco
**Como** usuário, **quero** que parcelas, contas fixas e pagamentos de fatura vindos do banco se encaixem no que já existe **para** não ter lixo nem duplicidade.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | OF · S3 | US-48, US-20, US-25, US-19 | RN-19, RN-69 a RN-71 |

```gherkin
Cenário: Parcela de série existente
  Dado a série de 10x R$ 100,00 lançada à mão
  Quando chega "LOJA X 02/10" de R$ 100,00 na fatura de jan/2027
  Então concilia com a parcela 2/10

Cenário: Compra parcelada nova vinda do banco
  Quando chega "LOJA Y 01/06" de R$ 50,00 sem série correspondente
  Então é criada a série de 6 parcelas de R$ 50,00 nas faturas seguintes

Cenário: Parcela de compra anterior ao app
  Quando chega "LOJA Z 04/10" de R$ 80,00 sem série
  Então são criadas as parcelas 4/10 a 10/10, com o selo "importada parcialmente"

Cenário: Fatura informada pelo banco
  Dado uma compra que pela RN-12 cairia em dez/2026, mas o banco informa a fatura de jan/2027
  Então o item fica em jan/2027 com fatura_fixada

Cenário: Conta de luz com valor variável
  Dado a ocorrência "Luz ≈ R$ 180,00" de 20/11 com termo de conciliação "COPEL"
  Quando chega "COPEL DIST 112233" de R$ 203,45 em 22/11 na conta BB
  Então a ocorrência fica efetivada com R$ 203,45 e conciliada

Cenário: Pagamento de fatura
  Dado a fatura dez/2026 do Nubank fechada com R$ 980,00
  Quando chega na conta BB uma saída de R$ 980,00 "PAGTO FATURA NUBANK" em 09/12
  Então é registrado pagamento_fatura da fatura dez/2026, que fica paga
  E a entrada "Pagamento recebido" na conta do cartão é ignorada
  E nenhum dos dois conta como despesa ou receita
```

#### US-51 — Desfazer uma conciliação errada
**Como** usuário, **quero** separar dois registros que foram juntados por engano **para** corrigir sem perder nada.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | OF · S3 | US-48 | RN-73 |

```gherkin
Cenário: Separar
  Dado um lançamento conciliado
  Quando toco em "Não é o mesmo"
  Então o lançamento manual volta à versão anterior à conciliação
  E a transação do banco vira um lançamento novo a revisar, com categoria pela regra

Cenário: Desfazer duplicidade
  Dado uma transação marcada duplicada
  Quando toco em "Não é duplicada"
  Então ela vira um lançamento próprio
```

---

### E12 — Importação OFX/CSV

#### US-52 — Importar extrato OFX do Banco do Brasil
**Como** usuário, **quero** importar o OFX do BB **para** ter os dados mesmo sem Open Finance.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | IMP · S4 | US-48 | RN-65, RN-75, RN-78 |

```gherkin
Cenário: Importar com prévia
  Dado um OFX "Money 2000+" do BB com 40 transações
  Quando escolho o arquivo e a conta "BB"
  Então vejo a prévia "32 novas · 6 serão conciliadas · 2 para decidir · 0 já existiam"
  E ao confirmar tudo é gravado de uma vez

Cenário: Reimportar
  Quando importo o mesmo arquivo de novo
  Então a prévia mostra "0 novas · 40 já existiam"

Cenário: Arquivo inválido ou grande demais
  Quando escolho um arquivo que não é OFX ou com mais de 5 MB
  Então vejo "Não consegui ler este arquivo. Exporte do BB no formato OFX (Money 2000+)." e nada é gravado

Cenário: Codificação
  Dado um OFX em Windows-1252 com "PAGAMENTO CONTA ÁGUA"
  Então a descrição aparece com acentos corretos

Cenário: Desfazer importação
  Quando toco em "Desfazer importação" em até 24 h
  Então tudo o que a importação criou é removido e os lançamentos manuais conciliados só perdem o vínculo

Cenário: Funciona offline
  Dado o aparelho sem rede
  Então consigo importar; a gravação sincroniza depois
```

#### US-53 — Importar CSV (presets Nubank)
**Como** usuário Nubank, **quero** importar o CSV da conta e da fatura **para** ter um plano B ao Open Finance.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | M | IMP · S4 | US-52 | RN-65, RN-76, RN-78 |

```gherkin
Cenário: Preset da fatura
  Dado um CSV com cabeçalho "date,title,amount"
  Então o preset "Nubank — fatura" é sugerido e valores positivos entram como compras no cartão escolhido

Cenário: Preset da conta
  Dado um CSV com cabeçalho "Data,Valor,Identificador,Descrição"
  Então o preset "Nubank — conta" é sugerido, negativos são saídas e "Identificador" é usado como external_id

Cenário: Mapeamento manual
  Dado um CSV desconhecido
  Então escolho separador, coluna de data e formato, coluna de valor e convenção de sinal, coluna de descrição
  E vejo as 5 primeiras linhas interpretadas antes de confirmar
  E o mapeamento fica salvo para a conta
```

---

### E13 — NFC-e

#### US-54 — Ler o QR code da nota (NFC-e)
**Como** usuário no mercado, **quero** apontar a câmera para o QR da nota **para** registrar valor, loja e itens sem digitar.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | G | IMP · S4 | US-12, US-48 | RN-82, RN-83, RN-85 |

Leitura de QR com biblioteca JavaScript (o iPhone Safari não tem `BarcodeDetector`), câmera traseira via `getUserMedia`.

```gherkin
Cenário: Nota nova sem lançamento
  Dado uma NFC-e do PR de R$ 187,35 emitida hoje por "SUPERMERCADO EXEMPLO"
  Quando leio o QR
  Então abro o lançamento pré-preenchido com R$ 187,35, data de hoje, descrição "SUPERMERCADO EXEMPLO" e categoria Mercado (regra)
  E escolho o meio e salvo

Cenário: Nota de um gasto que já lancei
  Dado o lançamento manual de R$ 187,35 hoje
  Quando leio o QR
  Então os itens e a loja são anexados a esse lançamento e nada novo é criado

Cenário: Mesma nota de novo
  Quando leio de novo o mesmo QR
  Então vejo "Essa nota já foi lida em dd/mm" com link para o lançamento

Cenário: Chave inválida
  Dado um QR que não é de NFC-e ou com dígito verificador errado
  Então vejo "Este QR code não é de uma nota fiscal (NFC-e). Digite a chave de acesso ou tente outra nota."

Cenário: Câmera negada
  Então posso colar o link do QR ou digitar a chave de 44 dígitos
```

#### US-55 — Quando a nota não pode ser lida
**Como** usuário, **quero** registrar o gasto mesmo quando o site da SEFAZ falha **para** não perder o lançamento.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | IMP · S4 | US-54 | RN-84 |

```gherkin
Cenário: SEFAZ fora ou formato mudou
  Dado que a página da SEFAZ-PR não responde no tempo limite
  Então vejo "Não foi possível carregar os detalhes da nota. Complete o valor para continuar."
  E o lançamento vem com o CNPJ do emitente formatado como descrição e eu digito o valor
  E a nota fica "parcial" com a ação "Tentar ler a nota de novo" por 7 dias

Cenário: Nota de outro estado
  Dado uma chave com UF diferente de 41
  Então o mesmo fallback é usado, sem tentar acessar a página

Cenário: Sem rede
  Dado o aparelho offline
  Então o QR é guardado e a leitura completa é tentada quando a rede voltar
```

#### US-56 — Ver os itens da nota
**Como** usuário, **quero** ver os itens da nota no lançamento **para** lembrar o que comprei.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Could | P | IMP · S4 | US-54 | RN-82 |

```gherkin
Cenário: Itens
  Dado um lançamento enriquecido por NFC-e
  Então vejo a lista de itens com descrição, quantidade, unidade, valor unitário e total, a forma de pagamento e o CNPJ/nome da loja
```

---

### E14 — Configurações, privacidade e dados

#### US-57 — Ocultar valores
**Como** usuário, **quero** esconder os valores na tela **para** usar o app em público sem expor meu dinheiro.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N1 · S1 | US-12 | RN-103 |

```gherkin
Cenário: Alternar
  Quando toco no ícone de olho do painel
  Então todos os valores do app aparecem como "R$ •••••" e o leitor de tela diz "valor oculto"
  E a preferência é lembrada neste aparelho e na conta

Cenário: Digitação continua visível
  Dado valores ocultos
  Quando faço um lançamento rápido
  Então o valor que estou digitando aparece normalmente
```

#### US-58 — Tema claro/escuro e reduzir movimento
**Como** usuário, **quero** o "Aero noturno" e menos animações quando preciso **para** usar com conforto.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | N2 · S2 (ou S4) | US-62 | — |

```gherkin
Cenário: Tema
  Então o padrão segue o sistema (prefers-color-scheme) e posso fixar Claro ou Escuro

Cenário: Reduzir movimento
  Dado prefers-reduced-motion ativo ou a opção "Reduzir animações" ligada
  Então transições de tela e de componentes são substituídas por mudanças sem animação
```

#### US-59 — Exportar meus lançamentos em CSV
**Como** usuário, **quero** exportar meus dados para planilha **para** analisar ou guardar fora do app.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N2 · S2 | US-15 | RN-01, RN-02 |

```gherkin
Cenário: Exportar período
  Quando exporto de 01/10/2026 a 30/11/2026
  Então baixo "lancamentos_2026-10_a_2026-11.csv" em UTF-8 com BOM, separador ";" e decimal ","
  E as colunas são: data; tipo; descricao; categoria; faixa; conta; forma; valor; status; parcela; fatura; origem; observacao
  E despesas têm valor negativo e receitas positivo; transferências aparecem com tipo "transferencia"

Cenário: Abre no Excel/Sheets em pt-BR
  Então acentos e valores aparecem corretos sem configuração

Cenário: Sem lançamentos no período
  Então vejo "Não há lançamentos nesse período" e nenhum arquivo é gerado
```

#### US-60 — Backup completo e restauração
**Como** usuário, **quero** baixar um backup completo e restaurá-lo **para** não depender só da nuvem gratuita.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | M | N2 · S2 (ou S4) | US-04 | RN-102 |

```gherkin
Cenário: Gerar backup
  Quando toco em "Baixar backup"
  Então baixo "backup_AAAA-MM-DD.json" com versão do esquema e todas as minhas tabelas (sem segredos de integração nem assinaturas push)

Cenário: Restaurar
  Quando escolho um backup e confirmo "Substituir todos os meus dados" digitando "RESTAURAR"
  Então meus dados atuais são substituídos pelos do arquivo, com user_id reescrito para o meu
  E vejo o resumo do que foi restaurado

Cenário: Backup inválido ou de versão incompatível
  Então vejo "Este arquivo não é um backup válido deste app" e nada muda
```

#### US-61 — Excluir minha conta e todos os dados
**Como** usuário, **quero** apagar tudo **para** ter controle sobre meus dados.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Should | P | IMP · S4 | US-60 | RN-102 |

```gherkin
Cenário: Excluir
  Quando escolho "Excluir minha conta", baixo (ou dispenso) o backup oferecido e digito "EXCLUIR"
  Então todos os meus registros, assinaturas push e conexões são apagados, meu usuário de autenticação é removido e sou deslogado
  E vejo a orientação para revogar a conexão também no Meu Pluggy
  E os dados do outro usuário não são afetados
```

---

### E15 — Visual, estados vazios e erros

#### US-62 — Visual Aero legível e acessível
**Como** usuário, **quero** um visual Aero bonito que continue fácil de ler **para** gostar de abrir o app sem forçar a vista.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N1 · S1 (base) e S2 (acabamento) | US-03 | RN-50, RN-103 |

```gherkin
Cenário: Tokens
  Então cores, vidro (opacidade, desfoque), raios, sombras, tipografia e espaçamentos vêm de tokens únicos para tema claro e escuro

Cenário: Contraste
  Então todo texto sobre vidro tem contraste mínimo de 4,5:1 (3:1 para texto grande e componentes), verificado por teste automatizado nos dois temas

Cenário: Alternativa sólida
  Dado navegador sem backdrop-filter, preferência de reduzir transparência, o ajuste "Transparência: Sempre sólida", ou aparelho modesto com taxa de quadros < 40 (UX 4.5)
  Então os painéis de vidro usam fundo sólido equivalente (data-glass="solid")

Cenário: Receita e despesa sem depender de cor
  Então todo valor tem sinal (+/−) e ícone ou rótulo além da cor

Cenário: Toque e digitação
  Então alvos de toque têm no mínimo 48×48 px (token --touch-min) e campos de digitação usam fonte de 16 px ou mais (evita zoom no iPhone)
```

#### US-63 — Estados vazios que ensinam
**Como** usuário novo, **quero** que cada tela vazia diga o que fazer **para** nunca ficar perdido.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | P | N2 · S2 | US-62 | RN-48 |

```gherkin
Esquema do Cenário: Estado vazio
  Dado a tela <tela> sem dados
  Então vejo a mensagem <mensagem> e a ação <acao>

  Exemplos:
    | tela                      | mensagem                                                 | acao                    |
    | Painel sem renda          | Cadastre sua renda para ver quanto pode gastar           | Cadastrar renda         |
    | Lista do mês              | Nenhum lançamento em <mês>                               | Novo lançamento         |
    | Cartões                   | Nenhum cartão cadastrado                                 | Adicionar cartão        |
    | Fatura sem itens          | Nenhuma compra nesta fatura                              | —                       |
    | 50/30/20 sem renda        | Orçamento sem renda cadastrada                           | Cadastrar renda         |
    | Reserva sem meta          | Defina uma meta para acompanhar o progresso              | Definir meta            |
    | Regras                    | Nenhuma regra criada                                     | —                       |
    | Central de avisos         | Nenhum aviso                                             | —                       |
    | Conferir importados       | Nenhum lançamento pendente                               | —                       |
    | Conexões bancárias        | Nenhum banco conectado                                   | Conectar banco          |
    | Busca sem resultado       | Nenhum resultado para "<termo>"                          | —                       |
```

Os textos completos (título, descrição, ícone) estão na tabela 6.5 do UX, que é a fonte normativa.

#### US-64 — Erros com saída
**Como** usuário, **quero** mensagens claras quando algo falha e nunca perder o que digitei **para** confiar no app.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Must | M | N2 · S2 | US-04 | RN-96, RN-100 |

```gherkin
Esquema do Cenário: Erros conhecidos
  Dado a situação <situacao>
  Então vejo <mensagem> e o app <comportamento>

  Exemplos:
    | situacao                              | mensagem                                                                 | comportamento                                              |
    | sem rede (G01)                        | Sem conexão. Você pode continuar lançando; tudo fica salvo no aparelho. | segue funcionando; integrações ficam indisponíveis         |
    | sincronização falhou (G04)            | {n} lançamentos não foram sincronizados. Eles continuam salvos no aparelho. | aplica a espera exponencial da RN-96                   |
    | sessão expirada (G05)                 | Sua sessão expirou. Entre novamente para sincronizar. Nenhum lançamento foi perdido. | mantém a fila local e reenvia após o login    |
    | armazenamento cheio (G11)             | O armazenamento do aparelho está cheio. Libere espaço para continuar lançando. | não descarta o lançamento em digitação              |
    | IndexedDB indisponível (G12)          | Este navegador bloqueou o armazenamento local. Abra pelo app instalado. | modo somente online com aviso permanente                   |
    | erro inesperado na tela (G09)         | Não foi possível carregar esta tela. Seus dados estão seguros.          | mostra "Tentar novamente" e um código curto do erro        |
    | Edge Function sem resposta em 15 s (G13) | O serviço demorou para responder. Tente novamente.                   | permite repetir a ação                                     |

Cenário: Rascunho preservado
  Dado que estou digitando um lançamento
  Quando o app é fechado ou recarregado
  Então ao abrir de novo o rascunho é oferecido por até 24 h
```

#### US-65 — Feedback de ações e marcos
**Como** usuário, **quero** confirmações claras e discretas das minhas ações **para** ter segurança de que tudo foi registrado, sem distrações.

| Prioridade | Estimativa | Camada | Depende de | Regras |
|---|---|---|---|---|
| Could | P | N2 · S2 (ou S4) | US-33, US-62 | RN-50, RN-56 |

```gherkin
Cenário: Confirmação de salvamento
  Quando salvo um lançamento ou um aporte
  Então vejo uma confirmação discreta (ícone de check e toast com o valor) em no máximo 250 ms, sem travar a interface

Cenário: Status do mês
  Então o painel mostra o selo da RN-50 com texto e ícone, sem mudar o fundo do tema

Cenário: Marco da reserva
  Quando o progresso da reserva alcança a meta pela primeira vez
  Então vejo uma única vez o aviso informativo "Reserva de emergência completa", sem confetes, animações comemorativas ou gamificação

Cenário: Reduzir movimento
  Dado prefers-reduced-motion ativo
  Então as transições são desligadas e o texto equivalente continua visível
```

---

## 6. Definition of Ready (DoR)

Uma história só entra numa sessão de desenvolvimento quando:

1. Tem ID, título, narrativa "Como/quero/para", prioridade, estimativa e camada/semana preenchidas.
2. Todas as histórias de **Depende de** estão *Done*.
3. Os critérios de aceite em Gherkin cobrem caminho feliz, erro e pelo menos um caso de borda, e citam as RN aplicáveis.
4. Nenhuma pergunta **bloqueante** da seção 8 está aberta para ela.
5. Dados de exemplo e valores esperados estão escritos (sem "rápido", "fácil", "intuitivo" sem número).
6. Os textos de interface essenciais (títulos, botões, mensagens de erro e vazio) estão definidos na história ou na US-63/US-64.
7. Impacto no modelo de dados está identificado (tabela/campo novo → migração prevista com RLS).
8. Se depende de serviço externo (Pluggy, SEFAZ-PR, Web Push), a forma de testar sem o serviço real (mock/fixture) está definida.
9. Cabe em no máximo **G**; se não couber, foi quebrada.

## 7. Definition of Done (DoD)

Uma história só é dada como pronta quando:

**Funcional**
1. Todos os cenários Gherkin passam como testes automatizados (unitários para regras puras, de integração para sync/RLS/Edge Functions, E2E com Playwright para os fluxos de tela principais).
2. Testes de regras citam o ID (`RN-xx`) no nome; os casos de teste numéricos das RN tocadas estão implementados.
3. Funciona **offline** quando a história é do núcleo (N1/N2), e degrada com a mensagem da US-64 quando exige rede.

**Plataformas**
4. Verificada em **Android Chrome** (instalado), **iPhone Safari instalado na tela de início** (iOS ≥ 16.4) e **Chrome de computador** (≥ 1024 px), com evidência (captura ou gravação) anexada ao registro da entrega.
5. Layout sem rolagem horizontal de 360 px a 1440 px de largura.

**Qualidade**
6. TypeScript em modo `strict`, lint e formatação sem erros; nenhum `any` novo sem justificativa.
7. Valores monetários só em centavos inteiros (nenhum `float` em cálculo de dinheiro — verificação de lint/teste).
8. Toda tabela nova com `user_id` tem RLS e passa no teste de isolamento da US-02.
9. **Repositório público (`silveiralh/oakfinance`)**: nenhum segredo (Pluggy, VAPID privada, chave secreta/service role do Supabase, token do Cloudflare, senha de backup) no código do cliente, no repositório, em logs do CI ou em artefatos; segredos só em GitHub Secrets, secrets das Edge Functions ou Vault do Supabase. Nenhum dado real dos usuários no repositório: nada de OFX, CSV, página/QR de NFC-e, resposta da Pluggy, e-mail, nome, CPF, número de conta ou de cartão reais. Fixtures só **anonimizadas** (valores, nomes, documentos, chaves de acesso e ids trocados, mantendo a estrutura), em pastas `fixtures/` com `README.md` dizendo como foram anonimizadas. E-mails em testes e `seed.sql` só no domínio reservado `example.com`/`example.test`. A varredura de segredos e de dados pessoais do CI (02 §8.6) passa sem achados.
10. Acessibilidade: contraste AA nos dois temas, rótulos acessíveis em controles, ordem de foco correta, "reduzir movimento" respeitado, valores não dependem só de cor (verificação com axe sem violações sérias).
11. Desempenho: painel visível em < 1,5 s com dados locais; Lighthouse PWA "instalável" ok; nenhuma tarefa > 200 ms no fluxo de lançamento rápido.
12. Textos em pt-BR, tom direto, claro e respeitoso, para jovens adultos (sem emojis, sem infantilizar, sem culpar); datas `dd/mm/aaaa` e valores `R$ 1.234,56`.

**Operação**
13. Migrações de banco versionadas e reversíveis; Edge Functions com timeout e log de erro sem dados sensíveis.
14. Eventos de telemetria da RN-104 relevantes à história emitidos.
15. Publicada no ambiente de produção (Cloudflare Pages + Supabase Free) sem custo novo; nenhum serviço pago adicionado.
16. Registro curto da entrega (o que mudou, RN cobertas, evidências, pendências) no repositório.

---

## 8. Perguntas em aberto e decisões a validar

### 8.1 Perguntas bloqueantes (precisam de resposta do cliente)

| # | Pergunta | Bloqueia | Prazo | Quem responde |
|---|---|---|---|---|
| **Q1** | Envie **1 arquivo real de cada**: OFX do BB (conta corrente, "Money 2000+"), CSV da **fatura** do Nubank e CSV/extrato da **conta** do Nubank (pode apagar linhas sensíveis; precisamos só do formato). Como o repositório é **público**, os arquivos reais **não** são versionados: a sessão gera a fixture anonimizada a partir deles fora do repositório e só a versão anonimizada entra (DoD 9). | US-52 (fixture de teste), US-53 (presets) | Antes da S4 | Cliente |
| **Q2** | Pluggy: quem cria a **conta de desenvolvedor** e **quando**? O teste gratuito dura 15 dias e, depois dele, não é possível mudar conectores; sugerimos criar **no 1º dia da S3**, não antes. A Persona B também precisa da própria conta de desenvolvedor ou os itens do Meu Pluggy dela aparecem nas credenciais da Persona A? (validamos no time-box da US-45, mas a criação da conta é do cliente) | US-45 a US-47 (S3 inteira) | Início da S3 | Cliente (+ validação técnica) |
| **Q3** | **Endereço definitivo do app**: subdomínio gratuito (`<nome>.pages.dev`, R$ 0) ou domínio próprio (pago, ~R$ 40/ano)? Trocar de endereço depois exige reinstalar o app e reativar as notificações nos dois celulares. (Ex.: `oakfinance.pages.dev`, se disponível.) | US-06, US-07, US-38 (instalação real dos usuários) | Fim da S1 | Cliente |
| **Q4** | Quais são os **2 e-mails Google** que podem entrar no app (allowlist)? O cliente os insere direto em `app.allowed_emails` no SQL Editor de cada projeto Supabase (02 §9.2); eles **nunca** são escritos no repositório, em issues, PRs ou no `HANDOFF.md`. | US-01 em produção | Início da S1 | Cliente |

### 8.2 Decisões do PO a validar (não bloqueiam; o padrão abaixo será implementado)

| # | Decisão adotada | Onde | Se o cliente discordar |
|---|---|---|---|
| D1 | **Confirmada pelo cliente (05/11):** modo de cálculo padrão = caixa (a compra no cartão conta no mês do **vencimento** da fatura), com a linha informativa "No cartão para os próximos meses" e opção de modo competência nas configurações | RN-46, RN-47, RN-49, US-34 | — (decisão fechada) |
| D2 | Compra no dia do fechamento vai para a **próxima** fatura (configurável por cartão) | RN-09, RN-12 | Trocar o padrão de `regra_dia_fechamento` |
| D3 | Diferença de centavos do parcelamento vai na **primeira** parcela | RN-21 | Trocar para a última (mudança local na função de divisão) |
| D4 | Receita fixa conta no mês **antes** de cair; receita variável só quando recebida ou marcada "prevista" | RN-32, RN-33 | Tornar a receita fixa "a receber" até confirmar |
| D5 | VR/VA entram nos cálculos (receita e despesa juntas), com opção de desligar | RN-35 | Trocar o padrão de `considerar_beneficios` |
| D6 | Janela de conciliação: 3 dias (cartão/débito), 1 dia (Pix/TED/boleto), 5 dias (contas fixas); tolerância de sugestão max(R$ 2,00; 2%) | RN-66, RN-67 | Ajustar constantes |
| D7 | Horários: lembrete diário 20:00, avisos de fatura/contas 09:00, resumo semanal domingo 19:00, silêncio 22:00–07:59 | RN-86 a RN-93 | Configurável pelo usuário (US-44) |
| D8 | Nota técnica sobre a NFC-e: no QR do formato normal (online) **não há valor nem data** — só a chave de acesso (CNPJ e mês/ano). Por isso o fallback da RN-84 registra CNPJ e pede o valor; o brief previa "valor, data e loja vindos do QR", o que só vale para notas emitidas em contingência | RN-82, RN-84 | — (limitação do formato oficial) |

