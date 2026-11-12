# SETUP — checklist do cliente

Coisas que só você pode fazer. As sessões automáticas nunca criam contas nem chaves.

**Como me avisar.** Na issue **"Setup do cliente"** do GitHub, que a primeira sessão cria, marque a caixa do item e, se quiser, comente só "SETUP-xx feito". **O repositório é público: nunca escreva lá e-mails, chaves, senhas, IDs secretos nem arquivos.** Valores secretos vão só para os lugares indicados em cada item. Você também pode avisar pelo chat do Projeto.

| Item | Quando | Desbloqueia |
|---|---|---|
| SETUP-01 Repositório público | agora | operação das sessões |
| SETUP-02 Opções do repositório | agora | operação das sessões |
| SETUP-03 Credencial das sessões sem admin | agora | portão confiável |
| SETUP-04 Ruleset de `main` | depois da T-006 (~1º dia) | T-007 e toda a cadeia |
| SETUP-05 Projetos Supabase | até ~dia 6 | T-036 |
| SETUP-06 Cliente OAuth no Google | até ~dia 6 | T-036 |
| SETUP-07 Login Google no Supabase | até ~dia 6 | T-036 |
| SETUP-08 Cloudflare Pages e endereço | até ~dia 6 | T-036 |
| SETUP-09 Environments, variables e secrets do GitHub | até ~dia 6 | T-036 |
| SETUP-10 Pós-deploy: e-mails, Vault, hook, secrets | depois da T-036 | M1 |
| SETUP-11 Chaves VAPID | depois da T-064 | M2 |
| SETUP-12 Senha dos backups | junto com o SETUP-09 | T-036 |
| SETUP-13 Pluggy e Meu Pluggy | **adiado para a v2 (D-080)** | T-083, M3 |
| SETUP-14 Arquivos reais por canal privado | antes da semana 4 | T-085, T-087, T-090 |
| SETUP-15 Licença | até o fim | T-099 |
| SETUP-16 Decisões pendentes | quando puder | T-099 |
| SETUP-17 Opcionais | quando quiser | — |

---

## SETUP-01 — Repositório público
- **Por quê:** em repositório público o GitHub Actions não tem cota de minutos, então o CI completo roda em todo PR (decisão de 05/11).
- **Passo a passo:**
  1. Confira que o repositório só tem README e documentos, sem nenhuma senha ou dado pessoal.
  2. github.com/silveiralh/oakfinance → *Settings* → *General* → *Danger Zone* → *Change visibility* → *Public*.
- **Avise:** "SETUP-01 feito".

## SETUP-02 — Opções do repositório
- **Por quê:** permitir o merge automático depois do CI e proteger o repositório público.
- **Passo a passo:**
  1. *Settings → General → Pull Requests*: deixe marcado só **Allow squash merging**; marque **Allow auto-merge** e **Automatically delete head branches**.
  2. *Settings → Actions → General*: em *Workflow permissions*, **Read repository contents**; marque **Allow GitHub Actions to create and approve pull requests**; em *Fork pull request workflows from outside collaborators*, **Require approval for all outside collaborators**.
  3. *Settings → Code security*: ative **Dependabot alerts**, **Dependabot security updates**, **Secret scanning**, **Push protection** e **Private vulnerability reporting**.
- **Avise:** "SETUP-02 feito".

## SETUP-03 — Credencial das sessões sem admin
- **Substituído pela D-012 (06/11/2026):** as sessões usam a conta do dono e herdam o admin; valem as salvaguardas descritas em `docs/DECISIONS.md`. Nada a fazer.
- **Por quê:** se as sessões tiverem papel de admin, elas conseguem pular o portão. O CI só é o portão de verdade se elas não puderem.
- **Passo a passo:**
  1. Dê às sessões automáticas uma credencial (GitHub App ou token *fine-grained*) com acesso **só** a `silveiralh/oakfinance`: *Contents* e *Pull requests* em *Read and write*, *Issues* em *Read and write*, *Actions* em *Read*, *Administration* em *Read*. Nada de papel de admin.
  2. Não coloque essa credencial na *bypass list* do SETUP-04.
- **Avise:** "SETUP-03 feito".

## SETUP-04 — Ruleset de proteção da `main` (depois da T-006)
- **Por quê:** sem revisão humana, os 8 checks do CI são o único portão. Até o ruleset existir, nenhuma funcionalidade é desenvolvida.
- **Quando:** quando o HANDOFF disser que a T-006 entrou em `main`. Os checks só aparecem para seleção depois de rodarem uma vez.
- **Passo a passo:**
  1. *Settings → Rules → Rulesets → New ruleset → New branch ruleset*. Nome: `main`. *Enforcement*: **Active**. *Target branches*: **Default branch**.
  2. Marque **Restrict deletions**, **Require linear history** e **Block force pushes**.
  3. **Require a pull request before merging**, com 0 aprovações.
  4. **Require status checks to pass**: adicione `guard`, `secrets`, `lint-types`, `unit`, `db`, `fn`, `e2e` e `build`, e marque **Require branches to be up to date before merging**.
  5. *Bypass list*: só você (*Repository admin*), no modo **For pull requests only**, para os PRs com rótulo `needs-owner`. Nenhuma credencial de sessão.
  6. *Create*.
- **Avise:** "SETUP-04 feito".

## SETUP-05 — Dois projetos Supabase em São Paulo
- **Por quê:** banco, login e funções, de graça. Produção e um ambiente de teste separados, para os testes nunca tocarem nos seus dados.
- **Passo a passo:**
  1. Crie a conta em supabase.com e crie os projetos **`oakfinance-prod`** e **`oakfinance-staging`**, região **South America (São Paulo)**, com senhas de banco fortes e diferentes, guardadas no seu gerenciador de senhas.
  2. Em cada projeto, anote o *Project ref*, a *Project URL*, a *Publishable key* (`sb_publishable_…`) e a *Secret key* (`sb_secret_…`), em *Project Settings → API Keys*.
  3. Gere um *Personal Access Token* em *Account → Access Tokens*.
  4. Guarde tudo para o SETUP-09. Não mande por chat nem por issue.
- **Avise:** "SETUP-05 feito".

## SETUP-06 — Cliente OAuth no Google Cloud
- **Por quê:** o login do app é só com a conta Google.
- **Passo a passo:**
  1. console.cloud.google.com → crie o projeto **OakFinance**.
  2. *Google Auth Platform → Branding*: nome "OakFinance" e e-mail de suporte. *Audience*: **External**. Escopos: `openid`, `userinfo.email` e `userinfo.profile`. Mantenha em *Testing* com os 2 e-mails como *test users*, ou publique.
  3. *Clients → Create client → Web application*.
     - *Authorized JavaScript origins*: o endereço do SETUP-08 e `http://localhost:5173`.
     - *Authorized redirect URIs*: `https://<ref-prod>.supabase.co/auth/v1/callback` e `https://<ref-staging>.supabase.co/auth/v1/callback`.
  4. Copie o *Client ID* e o *Client Secret* para o SETUP-07.
- **Avise:** "SETUP-06 feito".

## SETUP-07 — Login Google no Supabase (nos dois projetos)
- **Passo a passo:**
  1. *Authentication → Sign In / Providers → Google*: habilite com o Client ID e o Secret do SETUP-06. Deixe **Email** desabilitado.
  2. *Authentication → URL Configuration*.
     - prod: *Site URL* = seu endereço; *Redirect URLs* = `<endereço>/auth/callback` e `http://localhost:5173/auth/callback`.
     - staging: *Redirect URLs* = `https://*.<projeto>.pages.dev/auth/callback` e `http://localhost:5173/auth/callback`.
- **Avise:** "SETUP-07 feito".

## SETUP-08 — Cloudflare Pages e endereço do app (Q3)
- **Por quê:** hospeda o app de graça. Trocar o endereço depois obriga a reinstalar o app e reativar as notificações nos dois celulares.
- **Decida:** `oakfinance.pages.dev` (R$ 0, recomendado) ou um domínio próprio (pago).
- **Passo a passo:**
  1. dash.cloudflare.com → *Workers & Pages → Create → Pages → Direct Upload* → projeto **`oakfinance`** (se o nome estiver ocupado, use outro e me diga qual).
  2. *My Profile → API Tokens → Create Token* com a permissão *Account → Cloudflare Pages → Edit*.
  3. Anote o *Account ID* (barra lateral).
  4. Domínio próprio, se for usar: *Custom domains*, e atualize os SETUP-06 e SETUP-07.
- **Avise:** "SETUP-08 feito: endereço <url>". O endereço é público e pode ir na issue.

## SETUP-09 — Environments, variables e secrets do GitHub
- **Por quê:** o deploy precisa das chaves. Em Environments restritos à `main`, nenhum PR consegue lê-las.
- **Passo a passo:**
  1. *Settings → Environments*: crie `staging` e `production`, ambos com *Deployment branches* = só `main`.
  2. *Settings → Secrets and variables → Actions → Variables*: `SUPABASE_PROD_URL`, `SUPABASE_STAGING_URL`, `SUPABASE_PROD_PUBLISHABLE_KEY`, `SUPABASE_STAGING_PUBLISHABLE_KEY`, `SUPABASE_PROD_REF`, `SUPABASE_STAGING_REF`, `CLOUDFLARE_ACCOUNT_ID`, `CF_PAGES_PROJECT` (e, depois do SETUP-11, `VAPID_PUBLIC_KEY_PROD` e `VAPID_PUBLIC_KEY_STAGING`).
  3. *Secrets*, dentro do Environment correspondente: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_DB_PASSWORD`, `SUPABASE_STAGING_DB_PASSWORD`, `SUPABASE_PROD_SECRET_KEY`, `SUPABASE_STAGING_SECRET_KEY`, `CLOUDFLARE_API_TOKEN` e `BACKUP_PASSPHRASE` (SETUP-12).
- **Avise:** "SETUP-09 feito".

## SETUP-10 — Depois do primeiro deploy (T-036): e-mails, Vault, hook e secrets
- **Por quê:** só os 2 e-mails autorizados entram (Q4), e os lembretes agendados precisam de duas chaves no Vault. **Os e-mails nunca entram no repositório.**
- **Quando:** quando o HANDOFF disser que as migrações foram aplicadas.
- **Passo a passo, em cada projeto:**
  1. *SQL Editor*:
     ```sql
     insert into app.allowed_emails (email) values ('<seu-email>'), ('<email-da-outra-pessoa>');
     select vault.create_secret('https://<ref>.supabase.co', 'project_url');
     select vault.create_secret('<sb_secret_ do mesmo projeto>', 'cron_secret_key');
     ```
  2. *Authentication → Hooks → Before User Created* → tipo *Postgres function* → `public.hook_before_user_created`. Faça isso só depois do passo 1.
  3. *Edge Functions → Secrets*: `APP_ORIGIN` (seu endereço) e, no staging, `APP_PREVIEW_ORIGIN_SUFFIX` = `.<projeto>.pages.dev`.
  4. Teste: abra o app nos dois celulares, entre com Google e siga o checklist do M1 no HANDOFF.
- **Avise:** "SETUP-10 feito" (sem os e-mails).

## SETUP-11 — Chaves VAPID para notificações (depois da T-064)
- **Por quê:** o push precisa de um par de chaves próprio. A chave privada nunca passa pelas sessões nem pelo GitHub, por isso é gerada no seu computador.
- **Passo a passo:**
  1. No seu computador, duas vezes (uma para prod, outra para staging): `npx web-push@3.6.7 generate-vapid-keys`.
  2. Chave pública: variável do GitHub `VAPID_PUBLIC_KEY_PROD`/`_STAGING` **e** secret `VAPID_PUBLIC_KEY` da Edge Function do projeto correspondente.
  3. Chave privada: só no secret `VAPID_PRIVATE_KEY` da Edge Function. `VAPID_SUBJECT` = `mailto:<seu e-mail>` (secret da função, nunca no repositório).
  4. Trocar as chaves depois obriga a reativar as notificações nos aparelhos.
- **Avise:** "SETUP-11 feito".

## SETUP-12 — Senha dos backups
- **Por quê:** o plano Free não faz backup; o deploy faz um dump cifrado antes de cada publicação.
- **Passo a passo:** `openssl rand -base64 48` → secret `BACKUP_PASSPHRASE` (SETUP-09). Guarde também fora do GitHub: sem ela, os backups não abrem.
- **Avise:** "SETUP-12 feito".

## SETUP-13 — Pluggy e Meu Pluggy (semana 3, atenção ao trial de 15 dias)
> **Adiado para a v2 (D-080, 11/11/2026).** Não faça este item no MVP: o Open Finance está escondido no app.

- **Por quê:** é o que traz as transações do BB e do Nubank. Pela documentação conhecida, só dá para **conectar** o Meu Pluggy durante o trial de 15 dias da conta de desenvolvedor. Por isso, comece só quando o HANDOFF disser que a T-077 está pronta.
- **Decida (Q2):** quem cria a conta de desenvolvedor. A recomendação é uma conta só, sua; a T-083 confirma se os itens da outra pessoa ficam acessíveis.
- **Passo a passo:**
  1. dashboard.pluggy.ai → crie um *Team* e uma *Application*.
  2. *Customization → Connectors → Direct Connectors*: habilite **MeuPluggy** e, se aparecer, *Unlock real data → Meu Pluggy*.
  3. Client ID e Client Secret → secrets `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` das Edge Functions, em prod e staging.
  4. `openssl rand -hex 32` → secret `PLUGGY_WEBHOOK_TOKEN` nos dois projetos.
  5. Quando a T-083 informar o id do conector no HANDOFF, grave `PLUGGY_ALLOWED_CONNECTOR_IDS` (no staging, inclua também o id do sandbox).
  6. Cada pessoa cria a conta em meu.pluggy.ai e conecta Banco do Brasil e Nubank. Depois, no app: *Ajustes → Conexões → Conectar banco*. Se o widget falhar no iPhone, use o plano B (Item ID).
- **Avise:** "SETUP-13 feito: trial começou em dd/mm" (a data pode ir na issue).

## SETUP-14 — Arquivos reais por canal privado (antes da semana 4)
- **Por quê:** os formatos reais do OFX do BB, dos CSV do Nubank e das páginas da NFC-e do PR precisam ser conferidos. **Os originais nunca entram no repositório público**; a sessão gera só cópias anonimizadas.
- **Decida o canal.** Recomendo um repositório **privado** `silveiralh/oakfinance-fixtures-privadas`, com acesso de leitura para as sessões.
- **O que enviar:**
  1. 1 OFX da conta corrente do BB ("Money 2000+").
  2. 1 CSV da fatura e 1 CSV da conta do Nubank.
  3. 3 páginas de NFC-e do PR salvas como HTML (abra o QR no navegador e salve a página completa): mercado com item por kg, com desconto e com mais de uma forma de pagamento.
  - Pode apagar linhas sensíveis; o que importa é o formato.
- **Avise:** "SETUP-14 feito: canal <nome do repositório privado>".

## SETUP-15 — Licença
- **Por quê:** repositório público sem licença fica "todos os direitos reservados": ninguém pode reutilizar o código.
- **Opções:** sem licença (padrão: todos os direitos reservados), MIT (uso livre) ou AGPL-3.0 (quem modificar e publicar tem de abrir o código).
- **Avise:** "SETUP-15: <opção>".

## SETUP-16 — Decisões pendentes (04-review §3)
Enquanto você não responder, as sessões implementam o padrão indicado.

1. E-mails da allowlist: resolvido pelo SETUP-10.
2. Canal dos arquivos reais: resolvido pelo SETUP-14.
3. Configuração do repositório e licença: SETUP-02 a SETUP-04 e SETUP-15.
4. Pluggy (quem e quando): SETUP-13.
5. Endereço definitivo: SETUP-08.
6. **Opção não conservadora em Ajustes** ("Descontar faturas e contas que ainda vencem no mês", que pode ser desligada). Padrão: **manter**. Responda "remover" se preferir.
7. **Notificações:** teto de 3 push por dia, e os avisos pós-MVP (salário recebido, aporte pendente, início e fechamento do mês, sync parada) ficam fora. Padrão: **confirmado**.
8. **Depois de 2 semanas de uso:** aprovar o wordmark e o monograma OF (o selo "No ritmo do mês" saiu do Início pela D-081). Responda quando puder; isso não bloqueia nada.

- **Avise:** "SETUP-16: 6=<manter|remover>, 7=<ok|ajuste>, 8=<ok|ajuste>".

## SETUP-17 — Opcionais
- **Keepalive extra:** um Cron Trigger diário num Cloudflare Worker chamando o `ping` dos dois projetos. Protege contra a pausa do Supabase quando o desenvolvimento parar, já que workflows agendados de repositório público param após 60 dias sem commits.
- **Checklists de aparelho real:** a cada marco (M1 a M4), siga o roteiro do HANDOFF §6 no iPhone e no Android e comente na issue o que falhou. Vira tarefa `fix:`.
