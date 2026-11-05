# 04 — Revisão independente de QA e arquitetura · OakFinance

*Versão 1.0 · 05/11/2026 · Revisor independente (QA lead + arquiteto), sem autoria dos documentos revisados*
*Escopo: `discovery-brief.md` (v2), `01-prd-backlog.md` (v1.1 → **v1.2**), `02-tech-spec.md` (v1.0 → **v1.1**), `03-ux-design-system.md` (v1.2 → **v1.3**)*

**Decisões do cliente aplicadas nesta revisão**
1. **Repositório `silveiralh/oakfinance` público.** Os minutos de CI deixaram de ser restrição: a bateria completa (guard, segredos, typecheck, lint, unitários, RLS com Supabase local, Edge Functions, E2E Playwright em Android/iPhone/desktop, build) roda em todo PR. Novas regras proíbem segredos, dados reais (OFX, CSV, NFC-e, respostas Pluggy) e e-mails dos usuários no repositório, e o CI ganhou varredura de segredos e de dados pessoais (ADR-18, tech §0 item 9, §8.6 job `secrets`, §9.1; PRD DoD 9).
2. **A compra no cartão conta no mês do vencimento da fatura** (padrão confirmado): PRD RN-46 e D1, tech ADR-09 e §11, UX S06.
3. **Sessões automáticas a cada 4 h com auto-merge em `main` quando o CI passa:** o fluxo completo está descrito na tech §0 e §8.6 (8 checks obrigatórios, PR só de branch do próprio repositório, nada de fork nem `--admin`).

**Pontos desatualizados do brief tratados:** a marca é só tipográfica (sem árvore) e o Aero é sóbrio, sem elementos lúdicos. Removi os resquícios que ainda existiam: "bolhas" no diagrama de sync da técnica, o `mood: 'sunny' | 'cloudy' | 'stormy'` ("céu") do domínio, o "pote" da US-33, os toasts "Aprendi:" e "Tudo certo!" e os textos de push em forma de pergunta. A precedência sobre o brief ficou registrada no cabeçalho do PRD.

---

## 1. Matriz de rastreabilidade (resumo)

Legenda: ✅ coberto nos três documentos · 🔧 lacuna ou inconsistência **corrigida** nesta revisão · ⏳ depende de pendência do cliente (seção 3).

| Requisito do brief | Histórias (PRD) | Suporte técnico (tabela · domínio · endpoint) | UX (tela · componente) | Status |
|---|---|---|---|---|
| Login Google, 2 usuários (allowlist) | US-01, US-02 | Auth Google PKCE · `app.allowed_emails` + hook `hook_before_user_created` · RLS forçada (§3.6) · pgTAP §8.3 | ON03 · G14 (não autorizado) | 🔧 G14 criado; e-mails nunca no repositório ⏳ Q4 |
| PWA instalável, Android e iPhone com o mesmo peso | US-03, US-06, US-07 | `vite-plugin-pwa`, manifest, SW §4.8 · E2E E15/E16 nos 3 projetos | ON01, ON02a/b/c, S09 · `InstallGuide` | 🔧 US-06: guia antes do login no iPhone (alinhado ao UX §2.3) |
| Offline-first, última edição vence + histórico | US-04, US-05, US-64 | Dexie + outbox · `sync_push`/`sync_pull` · LWW por `client_updated_at` · `app.row_history` (12 meses) | `SyncBadge`, G01–G05, G11–G18 · T02 Histórico + Restaurar | 🔧 backoff, critério LWW, retenção e erros de armazenamento alinhados |
| Lançamento rápido (valor, categoria, meio) | US-12, US-13, US-14, US-15, US-16 | `transactions` · `parseBRL`, `categorize` · telemetria `lancamento_salvo` | Q01 · `AmountInput`, `NumericKeypad`, `CategoryChip`, `PaymentMethodPicker` | 🔧 botão "Lançar", 5 chips, transferência e estorno no Q01, valor máximo da RN-01 |
| Contas e meios (corrente, carteira, VR/VA, cartão com F e V) | US-08, US-09, US-10, US-11 | `accounts`, `cards` (+ `closing_day_rule`) | ON06, ON07, S03 · `InvoiceCard` | 🔧 regra do dia do fechamento ganhou coluna e UI; arquivar e desarquivar em S03 |
| Faturas pela data de fechamento | US-17, US-18, US-19, US-22 | `invoices` · `invoiceForPurchase`, `invoiceStatus`, `carryOverCredit` | C01, C02 · `InvoiceCard`, `Badge` | 🔧 status `partial`, saldo credor (RN-15), mover item (`invoice_pinned`) |
| Parcelamento projetado | US-20, US-21, US-50 | `installment_plans` + parcelas materializadas · `buildInstallments`, `rescheduleInstallments`, `cancelRemainingInstallments` | Q01 `InstallmentStepper` · T02 | 🔧 limite de 48, bloqueio da RN-24(b), exclusão da RN-25 (sem "só esta parcela") |
| Recorrências e contas fixas | US-23, US-25, US-26, US-41 | `recurrences` (projeção virtual, ADR-08) · `projectRecurrences`, `materializeOccurrence` | S05, T02, P03 | 🔧 RN-27 reescrita para projeção; `status 'cancelled'` para "pular" |
| Receitas: salário fixo + variável (recebida, a receber, prevista) | US-23, US-24 | `transactions.income_expected` + `count_before_received` · `monthlyIncome` | ON05 · Q01 "Já caiu na conta?" + "Contar antes de receber" | 🔧 3 estados da RN-33 passaram a existir no DDL e no Q01 |
| Categorias padrão editáveis + faixa 50/30/20 | US-27 | `categories` (+ `is_system`, `feeds_reserve`) · seeds `defaults.ts` (§3.8) | S04 · `CategoryPicker` | 🔧 seeds da técnica eram diferentes da RN-40; unificados (com "A classificar" e "Saldo credor") |
| Regras que aprendem (local, sem custo) | US-28, US-29 | `category_rules` (+ `account_id`, `token_prefix`) · `normalizeDescription`, `categorize`, `learnFromCorrection` | I06 (novo) · toast "Regra criada" | 🔧 normalização, casamento, precedência e mínimo de 4 caracteres alinhados à RN-57–RN-63; RN-64 = seeds da técnica |
| Orçamento 50/30/20 sobre a renda | US-31, US-32, US-34 | `budgets` · `bucketBudget`, `categoryBudgets`, `applyBp` | P01 · `BudgetRing`, `ProgressBar` | 🔧 grupo "Sem faixa", "já foi"/"vai sair", transferências fora da Poupança |
| Reserva de emergência (6× Necessidades) | US-33, US-65 | `goals` · `suggestedReserveTarget`, `reserveProgress` | ON07b (novo), P02 · `GoalProgress` | 🔧 passo de saldo inicial no onboarding; sugestão da RN-52; resgate entra no disponível |
| Painel "Quanto ainda posso gastar" (fórmula conservadora) | US-30, US-34, US-35 | `spendableThisMonth` (§5.6 = RN-47) · `MonthStatus` | H01, H01-S · `PaceIndicator`, `MoneyText` | 🔧 **selo de status do mês**: três regras diferentes nos três documentos, unificadas na RN-50; VR/VA incluídos por padrão; resgates na fórmula |
| Compra no cartão no mês do vencimento | US-30, US-34 | `cardAttribution = 'invoice_due_month'` (ADR-09) | S06 "Compras no cartão contam no mês" | 🔧 decisão confirmada; opção que faltava em S06 incluída; caso de competência da US-34 recalculado (R$ 2.260,00) |
| Lembretes (fatura, contas, limite, diário, semanal) | US-37 a US-44 | `reminders` (9 tipos), `notification_outbox`, `notices` (novo), `reminders-tick` · `dueNotifications` | H02 (novo), ON04, S07 · UX 6.7 | 🔧 central de avisos sem tabela nem tela; horários, silêncio e textos alinhados |
| Push no iPhone só instalado | US-06, US-38 | Web Push VAPID, Declarative Web Push (§6.4) | ON02b, ON04 | ✅ |
| Open Finance BB e Nubank (Meu Pluggy) | US-45, US-46, US-47 | `bank_connections`, `external_accounts` · `pluggy-*` · `BankConnector` | I01, I02 · `BankConnectionCard` | 🔧 widget como caminho principal e Item ID como plano B no PRD; mapeamento de contas e plano B no UX; agenda 2×/dia ⏳ Q2 |
| Conciliação sem duplicidade | US-48 a US-51 | `review_state`, `duplicate_of` · `reconcile` (determinístico), `planMerge`, `detectInvoicePayments` | I05 · `ReconcileCard` | 🔧 a técnica usava pontuação e janela de 3/5 dias, diferente das RN-66/RN-67; foi reescrita para as regras do PRD |
| Importação OFX do BB / CSV Nubank | US-52, US-53 | `imports` · `parseOfx`, `mapCsvRows`, `CSV_PRESETS` | I03 · `ImportDropzone`, `ColumnMapper` | 🔧 desfazer 24 h, limites e "já importado" no UX ⏳ Q1 (arquivos reais, fora do repositório) |
| NFC-e por QR (SEFAZ-PR) | US-54, US-55, US-56 | `nfce_receipts`, `receipt_items` · `parseNfceQr` · `nfce-fetch` | I04, T02 (itens) · `QRScanner` | 🔧 QR inválido, nota repetida e "tentar de novo" no UX; fixtures anonimizadas |
| Privacidade: ocultar valores, segredos só no servidor | US-57, US-61 | `hideValues`, CSP, gitleaks, Environments | botão olho, S08, S10 | 🔧 máscara única "R$ ••••"; regras de repositório público |
| Custo R$ 0 | DoD 15 | Supabase Free, Pages, Actions público, keepalive | — | 🔧 o risco de minutos (R14) foi trocado pelo risco de vazamento em repositório público |
| Visual Aero sóbrio, AA, reduzir movimento, tema escuro | US-58, US-62, US-63, US-65 | tokens, axe no E2E E12 | §4 tokens, §5 componentes, §8 checklist | 🔧 alvo de toque de 48 px (PRD dizia 44); estados vazios do PRD = tabela 6.5 do UX |
| Exportar, backup e excluir conta | US-59, US-60, US-61 | `account-delete`, exportação no aparelho | S10 | 🔧 exportação por período, backup e restauração faltavam no S10 |
| Fechar o mês (conferido) | US-36 | `month_closings` (novo) | P04 (novo) | 🔧 não havia tabela nem tela |
| Diagnóstico e alterações rejeitadas | US-64 | `outbox.state = 'rejected'`, §7.3 | S11 (novo), G15 | 🔧 tela citada pela técnica não existia no UX |

**Semanas/camadas:** coerentes entre os documentos (N1/N2 = S1–2, OF = S3, IMP = S4). As telas novas seguem a camada da história: H02 e ON07b em S1–2, P04 em S3, I06 em S1–2.

---

## 2. Achados

Severidade: **Alta** = quebraria o produto ou geraria número errado no painel; **Média** = fluxo sem tela, regra ambígua ou divergência que uma sessão automática resolveria de forma diferente; **Baixa** = texto, nome ou detalhe.

### 2.1 Alta

| # | Onde | Achado | Correção feita |
|---|---|---|---|
| A1 | Tech §5.6, PRD RN-47/RN-35 | O domínio deixava VR/VA **fora** do disponível por padrão (`includeRestrictedAccounts: false`), mas o PRD (D5) os inclui. Os resgates da reserva (RN-36) não entravam na fórmula | `SpendableConfig` com padrão `true`, `withdrawalsCents` na fórmula, que agora é a RN-47; os casos de teste do PRD viraram obrigatórios na técnica |
| A2 | PRD RN-50 × UX H01 × Tech `mood` | Três regras diferentes para o status do mês: PRD com 20% da Base, UX com ritmo `r = D ÷ (B × f)` e histerese, técnica com "céu" a 30% (resquício lúdico). D = 0 era "Acima do planejado" na RN-50 e "no limite" na RN-48 | Regra única (RN-50 = `PaceIndicator` = `MonthStatus`), com os mesmos textos e D = 0 → `attention` "No limite do planejado". O `mood` foi removido |
| A3 | Tech §5.9 × PRD RN-66/RN-67 | A conciliação técnica usava pontuação com Jaccard e janela de 3 dias (5 no cartão), em vez das janelas por meio e da tolerância max(R$ 2; 2%) do PRD. Com isso, os casos de teste da US-48 falhariam | `reconcile` reescrito em forma determinística com `ReconOptions` = D6, com as ações `auto_merge`/`suggest`/`new`/`duplicate`; `detectInvoicePayments` = RN-71; `planMerge` = RN-68 |
| A4 | Tech DDL × PRD | Faltava suporte a regras normativas: `status` sem `cancelled` (pular mês, não recebi, parcelas canceladas), nenhum campo para "Contar antes de receber" (RN-33), nenhuma regra de dia do fechamento por cartão (RN-09), nenhum `fatura_fixada` (RN-18), nenhum `alimenta_reserva`/categoria de sistema, regra sem conta (RN-59) | Colunas adicionadas: `status 'cancelled'`, `count_before_received`, `cards.closing_day_rule`, `invoice_pinned`, `feeds_reserve`, `is_system`, `category_rules.account_id/card_id`, `source 'system'`, `food_voucher`. A tabela de correspondência §3.0 mapeia cada nome do PRD |
| A5 | Tech §3.8 × PRD RN-40/RN-64 | Os seeds de categorias e regras eram outros (sem Farmácia, Pets, Benefícios, "A classificar"; FARMACIA → saúde; "combustível filha de transporte", com subcategorias fora do escopo) | Lista única nos dois documentos. Seeds criados antes do ON04, idempotentes e sem ressuscitar o que o usuário apagou |
| A6 | PRD US-34 | O cenário "Modo competência" dizia que o valor "cai R$ 150,00", mas a fatura de novembro (R$ 1.200,00 de compras de outubro) também sai de novembro, então o valor sobe | Cenário recalculado com premissas explícitas: R$ 2.260,00 |
| A7 | Repositório público (novo) | Sem regras, um commit de fixture real, um `seed.sql` com e-mails ou um log do CI vazaria dados no histórico público, que é permanente | Tech §0 item 9, ADR-18, job `secrets` obrigatório (gitleaks + e-mail/CPF/Luhn/chave NFC-e/arquivos fora de `fixtures/`), Environments restritos a `main`, sem `pull_request_target`, PR de fork bloqueado no `guard`; PRD DoD 9, Q1, Q4, RN-101 |

### 2.2 Média

| # | Onde | Achado | Correção feita |
|---|---|---|---|
| M1 | Tech §8.6, §10 R14, §11 | O CI era moldado pela cota de minutos (E2E desktop só no nightly, `paths-filter`, `needs:`, queda de cadência para 8 h) | Bateria completa em todo PR, jobs em paralelo, E2E nos três projetos com sharding; R14 virou o risco de vazamento; pendência resolvida |
| M2 | PRD RN-27 × ADR-08 | No PRD as ocorrências eram materializadas até M+12; na técnica eram projetadas | PRD alinhado à projeção, com a materialização idempotente |
| M3 | Central de avisos (US-37) | Não havia tabela, tela nem geração para quem não tem push | Tabela `notices` sincronizada, `reminders-tick` para todos os usuários, tela H02 e sino no H01 |
| M4 | Fechar o mês (US-36) | Não havia tabela nem tela | `month_closings` e tela P04 |
| M5 | Reserva no onboarding (US-08, RN-55) | O UX não tinha o passo de saldo inicial | ON07b criado; stepper "de 5" confere |
| M6 | UX T02 × RN-25/RN-30 | A exclusão oferecia "Só esta parcela", proibida pela RN-25; faltavam escopos de edição, "Pular este mês", mover fatura e restaurar versão | T02 reescrito conforme as RN-24, RN-25, RN-30, RN-18 e RN-97 |
| M7 | UX Q01 | Não havia transferência (US-16) nem estorno (US-22); a receita não tinha "Já caiu na conta?" nem os 3 estados; o limite era 24 parcelas (RN-20: 48) e o máximo R$ 9.999.999,99 (RN-01: R$ 999.999,99) | Q01, `InstallmentStepper` e `AmountInput` corrigidos |
| M8 | UX S06/S10 | Faltavam o mês do cartão, VR/VA, exportação por período, backup e restauração | Incluídos |
| M9 | Lembretes | Diário às 20:00 (PRD/UX) × 20:30 (tech); silêncio adiando (PRD) × descartando (tech); tipos RN-88/RN-91/RN-94 inexistentes no DDL; push extras no UX sem regra | Horário 20:00, adiamento para 08:00, 9 tipos em `reminders`, chaves de deduplicação, linhas 18–20 no UX e itens sem RN marcados "pós-MVP" |
| M10 | Sync | Backoff (RN-96 × tech), critério LWW (`updated_at` × `client_updated_at`), logout (RN-100 apaga × tech "manter"), histórico (12 × 6 meses), telemetria (180 × 30 dias), RLS com DELETE (RN-102 × revoke) | Todos alinhados ao comportamento técnico mais seguro, com o PRD ajustado onde a técnica estava certa (LWW, DELETE revogado) |
| M11 | Erros de armazenamento (US-64) | QuotaExceeded e IndexedDB bloqueado sem tratamento técnico nem tela | Tech §4.2 e G11/G12; G13–G18 cobrem timeout, não autorizado, rejeitado, sair com pendentes, rascunho e pendência antiga |
| M12 | Open Finance | PRD: 1×/dia às 06:00 e manual a cada 30 min; tech: 2×/dia e `PATCH` 1×/h; PRD só com Item ID manual | PRD alinhado à técnica (limite real da Pluggy), com o widget como caminho principal e o Item ID como plano B; UX com mapeamento e plano B |
| M13 | Keepalive em repositório público | Os workflows agendados de repositório público são desativados após 60 dias sem atividade (a técnica dizia que não se aplicava) | Verificação no `nightly`, instrução no HANDOFF e Worker opcional |
| M14 | Tech §5.3 | O exemplo "3× → 2× com a 1ª paga" contradizia a RN-24(b) | Bloqueio `INSTALLMENTS_LOCKED` e exemplos da RN-21 |
| M15 | Tech §5.7, §5.8 | A sugestão da reserva, a normalização, o termo mínimo (3 × 4) e a precedência das regras divergiam das RN | Comentários de contrato apontam para as RN-52, RN-56 e RN-57 a RN-63 |

### 2.3 Baixa

| # | Onde | Correção feita |
|---|---|---|
| B1 | PRD × UX: textos de Gherkin ("Salvar", "Paguei", "aguardando envio", "Ainda não sei sua renda", estados vazios, erros, toasts de 6 s) | Alinhados à microcopy do UX (fonte normativa de texto); toasts com ação passam a 8 s |
| B2 | Pushes com "!" ou pergunta retórica ("Teve algum gasto hoje? Leva 5 segundos.", "Você pagou Luz?") | Textos do UX 6.7, com título neutro em gênero "Confirmar {descrição}" |
| B3 | Máscara "R$ •••••" / "R$ •••" / "R$ ••••" | Unificada em "R$ ••••" |
| B4 | Sinal negativo `-R$` × `−R$` | U+2212 normativo (RN-01) |
| B5 | Alvo de toque 44 px (PRD) × 48 px (UX) | 48 px |
| B6 | Mensagem de percentuais diferente | Texto do UX nos dois documentos |
| B7 | ON05 "último dia útil" sem regra; prévia do ON07 com data errada (04/11 em vez de 03/11) | Removido; prévia pela RN-12 + switch da regra do fechamento |
| B8 | Alerta de conexão ≤ 3 dias (UX) × ≤ 7 dias (RN-94); "Atualizado às 06:10" | ≤ 7 dias; 07:40 |
| B9 | `InvoiceCard` sem `partial`/`future` | Enum igual ao `InvoiceStatus` |
| B10 | Mensagem do hook "Este app é privado." × "Este app é de uso privado" | Unificada |
| B11 | Dedup OFX: `FITID` (PRD) × `FITID|data|valor` (tech) | PRD alinhado (o BB repete FITID) |

### 2.4 Verificações sem achado (conferidas)

- Fuso `America/Sao_Paulo`: datas civis `YYYY-MM-DD`, `todayIn` só na borda, cron em UTC com conversão comentada, E2E com `timezoneId`, virada do mês com teste novo (E17).
- Centavos: inteiros em todo lugar; arredondamento meio para cima em `applyBp` = RN-44; resto na 1ª parcela = RN-21; propriedade `sum(splitEven) = total`.
- RLS: forçada, FKs compostas, schema `app` fechado, pgTAP cobre tabela nova sem RLS (inclusive `notices` e `month_closings`, que entram pelo `sync_tables`).
- Acessibilidade: contraste medido no pior pixel, alternativa sólida, reduzir movimento, gestos com alternativa; a lista do axe foi ampliada para as telas novas.
- Desempenho: orçamento de bundle, painel < 200 ms com 5.000 lançamentos, parse em Web Worker.
- Marca: nenhum resquício de árvore, folha ou carvalho; os SVGs são monograma geométrico e wordmark.

---

## 3. Pendências que exigem decisão do cliente

1. **E-mails da allowlist (Q4):** inserir os 2 e-mails direto no SQL Editor de cada projeto Supabase. Eles não devem ser enviados por PR, issue ou `HANDOFF.md`, porque o repositório é público.
2. **Arquivos reais (Q1) e páginas de NFC-e:** entregar os arquivos fora do repositório, por um canal privado. Só versões anonimizadas serão versionadas. Falta definir o canal.
3. **Configuração do repositório público (tech §9.1):** ativar o ruleset com os **8** checks (`secrets` é novo), os Environments `staging`/`production` restritos a `main`, a aprovação para PR de fork, *secret scanning* com *push protection* e uma credencial **sem admin** para as sessões. Também é preciso definir uma **licença**: repositório público sem licença fica "todos os direitos reservados".
4. **Pluggy (Q2):** quem cria a conta de desenvolvedor e quando (o trial de 15 dias). A recomendação continua sendo o 1º dia da S3.
5. **Endereço definitivo (Q3):** `*.pages.dev` ou domínio próprio, até o fim da S1.
6. **Opção não conservadora em S06:** manter o switch "Descontar faturas e contas que ainda vencem no mês" (o brief pede um padrão conservador, mas "ajustável"). Se o cliente preferir, removemos.
7. **Notificações:** confirmar o teto de 3 push por dia e que os avisos marcados "pós-MVP" (UX 6.7: salário recebido, aporte pendente, início e fechamento do mês, sync parada) ficam fora do MVP.
8. **Validar depois de 2 semanas de uso:** o limite de 20% do selo de status do mês e a aprovação do wordmark e do monograma (UX §8).
