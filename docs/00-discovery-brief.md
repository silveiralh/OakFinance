# Discovery — PWA de Gerenciamento Financeiro Pessoal

*Entrevista com o cliente em 05/11/2026 · equipe de discovery: Produto/Negócio, UX e Arquitetura · v3*

> **Atualização v3 (05/11):** nome **OakFinance**; marca **só tipográfica** (sem símbolo); visual **Aero sóbrio e premium, sem elementos lúdicos**, para jovens adultos; repositório `silveiralh/oakfinance` público; compra no cartão conta no mês do vencimento. As especificações em `docs/01`–`04` prevalecem sobre este brief.

## 1. Visão

App pessoal para **registrar gastos em segundos, na hora da compra**, ver para onde vai o dinheiro, controlar cartões e faturas e planejar o mês. Hoje o cliente **não controla** as finanças, ou usa apenas o app do banco. O app precisa ser simples e **lúdico** o bastante para virar hábito.

**Pergunta que a tela inicial responde:** *"Quanto ainda posso gastar este mês?"*

## 2. Perfil e contexto de uso

| Tema | Decisão |
|---|---|
| Público | Uso pessoal: **2 pessoas, cada uma com a sua conta independente**. Não há compartilhamento de dados nem gastos em conjunto |
| Plataformas | **Android e iPhone com o mesmo peso** (um usuário em cada); computador para analisar o mês |
| Momento do lançamento | Na hora da compra (fila, caixa), muitas vezes sem sinal |
| Bancos | **Banco do Brasil e Nubank** |
| Meios de pagamento | 1 conta corrente, cartões de crédito, Pix, débito, dinheiro, VR/VA |
| Renda | Fixa + variável |
| Prazo | MVP em 2 a 4 semanas |
| Custo de operação | R$ 0. Só propor algo pago se for de fato necessário |

## 3. Escopo funcional do MVP

**Núcleo**
- **Lançamento rápido:** valor, categoria e meio de pagamento são obrigatórios. O restante é opcional.
- **Contas e meios:** conta corrente, carteira (dinheiro), VR/VA e cartões de crédito com dia de fechamento e dia de vencimento.
- **Faturas de cartão:** cada compra cai na fatura certa conforme a data de fechamento.
- **Parcelamento projetado:** uma compra parcelada gera todas as parcelas futuras nas faturas seguintes. Contas fixas (aluguel, assinaturas) entram como recorrência.
- **Receitas:** salário fixo recorrente e receitas variáveis lançadas avulsas.
- **Categorias:** lista padrão editável, cada categoria mapeada para Necessidades, Desejos ou Poupança. **Regras que aprendem com as correções** (ex.: "POSTO" → Combustível), processadas localmente e sem custo.
- **Orçamento 50/30/20:** 50% necessidades, 30% desejos, 20% poupança, calculado sobre a renda do mês.
- **Reserva de emergência (MVP):** meta em valor, sugerida como 6× a média mensal de Necessidades e editável. A barra de progresso é alimentada pelos aportes da faixa Poupança.
- **Painel inicial "Quanto ainda posso gastar".** Padrão definido (conservador), ajustável nas configurações:
  `receita fixa do mês + receitas variáveis já recebidas − gastos realizados − faturas, parcelas e contas fixas que ainda vencem no mês − aporte de poupança do mês (20%)`
  A receita variável **só conta quando cai na conta**. Opcionalmente, o usuário pode marcar uma receita variável como "prevista" para incluí-la antes.
- **Lembretes:** vencimento de faturas e contas, categoria (ou faixa 50/30/20) perto do limite, lembrete diário para lançar e resumo semanal.

**Entradas automáticas** (todas pedidas pelo cliente para o MVP, entregues em camadas)
1. **Open Finance:** conexão automática com Banco do Brasil e Nubank (prioridade do cliente). Os dois bancos constam como conectores Open Finance para pessoa física na Pluggy. Cada usuário conecta os próprios bancos no seu Meu Pluggy.
2. **Importação de extrato:** OFX do Banco do Brasil (conta corrente, opção "Money 2000+"). O formato exportável do Nubank (conta e fatura) ainda precisa ser confirmado.
3. **Foto ou QR code da NFC-e:** valor, loja e itens da nota do mercado.

Tudo que chega automaticamente passa por **conciliação** com os lançamentos manuais, para evitar duplicidade.

## 4. Requisitos não funcionais

- **PWA instalável** em Android, iPhone e computador. As duas plataformas móveis são testadas em todas as entregas.
- **Multiusuário isolado:** cada conta Google tem seus próprios dados (Row Level Security). Não há telas nem regras de compartilhamento.
- **Offline-first:** lançar sem internet e sincronizar quando a rede voltar. Cada pessoa usa principalmente um aparelho, o que reduz conflitos. Regra adotada: a última edição vence, com histórico do lançamento.
- **Login com conta Google.**
- **Notificações push.** No iPhone, só funcionam com o app instalado na tela inicial, por isso o onboarding precisa guiar a instalação passo a passo.
- **Privacidade:** dados isolados por usuário, segredos de integração apenas no servidor e opção de ocultar valores na tela.
- **Custo:** R$ 0 por mês na operação.

## 5. Identidade visual e tom

- **Direção: Aero moderno.** Releitura atual da estética Frutiger Aero, com vidro translúcido e brilho suave, céu, água e bolhas, azul-aqua e verde-grama, gradientes luminosos e cantos arredondados. É a base de vidro (glassmorphism) de hoje com o otimismo dos anos 2000.
- **Tom lúdico:** microinterações como bolhas que sobem ao poupar, gotas que enchem o "pote" da reserva e o céu que muda conforme o mês vai bem ou apertado. Texto leve e encorajador, nunca culpando o usuário.
- **Cuidados:** contraste mínimo WCAG AA sobre o vidro; não depender só de verde e vermelho para receita e despesa; respeitar "reduzir movimento"; tema claro e escuro (Aero noturno).
- **Nome:** a definir.

## 6. Arquitetura escolhida — PWA + nuvem gerenciada (plano gratuito)

| Camada | Escolha | Custo |
|---|---|---|
| Front-end | React + Vite + TypeScript, Service Worker (Workbox), instalável | R$ 0 |
| Dados locais | IndexedDB (ex.: Dexie) + fila de alterações para sincronizar | R$ 0 |
| Backend | Supabase Free: Postgres + RLS, Auth Google, Edge Functions, pg_cron | R$ 0 |
| Hospedagem | Cloudflare Pages (ou Vercel) | R$ 0 |
| Push | Web Push disparado por pg_cron + Edge Function | R$ 0 |
| Open Finance | Meu Pluggy (um por usuário) + conta de desenvolvedor Pluggy, chamados por Edge Function | R$ 0 (ver riscos) |
| NFC-e | Edge Function lê a página pública da SEFAZ-PR a partir do QR code | R$ 0 |
| OFX/CSV | Leitura no próprio aparelho | R$ 0 |

O Open Finance fica num **módulo de conector trocável**: se o caminho gratuito mudar, ele pode virar um plano pago da Pluggy ou outro agregador sem afetar o resto do app.

## 7. Plano de entrega em camadas (revisado pelo cliente)

| Semana | Entrega | Utilizável? |
|---|---|---|
| 1–2 | Núcleo: login, contas e cartões, lançamento rápido offline, faturas, parcelas, receitas, categorias com regras, 50/30/20, reserva de emergência, painel "quanto posso gastar", instalação PWA guiada (Android e iPhone), visual Aero | Sim, uso diário começa aqui |
| 3 | **Open Finance** (BB e Nubank) via Meu Pluggy + conciliação com lançamentos manuais | Sim |
| 4 | Importação OFX/CSV + QR code da NFC-e + lembretes push completos | Sim |

## 8. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Pluggy: a conta de desenvolvedor começa com teste de 15 dias, os dados atualizam 1x/dia e as conexões expiram | Módulo trocável; aviso no app quando a conexão expira; OFX/CSV como plano B |
| Produtos disponíveis por banco (conta, cartão, transações) variam por instituição | Validar a lista de produtos de BB e Nubank na API da Pluggy no início da semana 3 |
| Formato de exportação do Nubank não confirmado | Open Finance como caminho principal do Nubank; leitor CSV configurável |
| Supabase Free pausa projetos com uso muito baixo por 7 dias | Uso diário dos dois usuários já evita; ping agendado gratuito como garantia |
| Limites do PWA no iPhone (push só com app instalado; armazenamento local pode ser limpo) | Onboarding de instalação; armazenamento persistente; a nuvem é a fonte da verdade |
| Estética de vidro pode prejudicar legibilidade e desempenho em celulares modestos | Tokens de contraste testados; desfoque com alternativa sólida; animações leves |
| A página pública da SEFAZ-PR pode mudar de formato | Leitor isolado; se falhar, registra só valor, data e loja vindos do QR |
| Prazo de 4 semanas para núcleo + 3 integrações | Entrega em camadas; núcleo protegido; integrações podem escorregar sem bloquear o uso |

## 9. Decisões registradas

- Duas contas independentes; sem compartilhamento (05/11).
- Bancos: Banco do Brasil e Nubank (05/11).
- Reserva de emergência entra no MVP (05/11).
- Receita variável conta só quando recebida, com opção de marcar como "prevista" (padrão proposto pela equipe; o cliente pode alterar).
- Identidade lúdica, moderna, estética Aero (05/11).

## 10. Pendências

1. Nome do app.
2. Confirmar o formato de exportação do Nubank (conta e fatura).

## Fontes

- Meu Pluggy (GitHub): https://github.com/pluggyai/meu-pluggy
- Actual Budget — integração Pluggy.ai: https://actualbudget.org/docs/advanced/bank-sync/pluggyai
- Pluggy — conectores Open Finance: https://docs.pluggy.ai/docs/open-finance-regulated
- Supabase — pausa de projetos gratuitos: https://supabase.com/kb/faqs/platform/free-project-pausing
- Exportar extrato do Banco do Brasil em OFX: https://www.meucontadoronline.com.br/blog/como-exportar-o-extrato-do-banco-do-brasil-em-arquivo-ofx/
- Infosimples — API SEFAZ/PR NFC-e (alternativa paga): https://infosimples.com/consultas/sefaz-pr-nfce/
