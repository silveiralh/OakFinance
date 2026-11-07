# OakFinance

PWA de finanças pessoais para duas pessoas com contas separadas. Responde a uma pergunta: **quanto ainda posso gastar este mês**. Funciona offline, instala no Android, no iPhone (Tela de Início) e no computador, e custa R$ 0 (Supabase Free, Cloudflare Pages e GitHub Actions).

## O que o app faz

- **Lançamento rápido** em até 3 toques, inclusive sem internet; sincroniza sozinho quando a rede volta (a nuvem é a fonte da verdade e o histórico guarda a versão perdida em conflito).
- **Painel "Disponível para gastar"** com o valor por dia, o selo do ritmo do mês e o detalhamento do cálculo.
- **Cartões e faturas:** a compra cai na fatura pela data de fechamento e conta no mês do vencimento; parcelas projetadas, estornos e pagamento da fatura.
- **Receitas e contas fixas** com lembretes, confirmação e "pular este mês".
- **Orçamento 50/30/20**, limite por categoria, reserva de emergência, fechamento do mês e análise no computador.
- **Categorias que aprendem** com as correções (regras determinísticas e locais, sem IA).
- **Entradas automáticas:** importação de OFX (BB) e CSV (Nubank) com conciliação e desfazer, leitura da NFC-e da SEFAZ-PR pelo QR code. Open Finance (Pluggy) em andamento.
- **Avisos** no sino e por Web Push (lembrete diário, faturas, contas fixas, limites e resumo semanal), com horário silencioso.
- **Privacidade:** ocultar valores, exportar CSV, backup e restauração, excluir conta e todos os dados.

Estado de cada história e da Definition of Done: [`docs/RELEASE.md`](docs/RELEASE.md).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`docs/RELEASE.md`](docs/RELEASE.md) | Checklist de lançamento: histórias, DoD e pendências |
| [`CLAUDE.md`](CLAUDE.md) | Guia operacional das sessões automáticas de desenvolvimento |
| [`docs/TASKS.md`](docs/TASKS.md) | Cadeia de tarefas T-001…T-100 (ordem, dependências, status) |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Passagem de bastão entre sessões, riscos e checklist de aparelho real |
| [`docs/SETUP.md`](docs/SETUP.md) | Configuração que só o dono faz (contas, chaves, ruleset) |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Log de decisões (aponta para os ADRs) |
| [`docs/specs/01-prd-backlog.md`](docs/specs/01-prd-backlog.md) | PRD, regras de negócio e backlog |
| [`docs/specs/02-tech-spec.md`](docs/specs/02-tech-spec.md) | Especificação técnica |
| [`docs/specs/03-ux-design-system.md`](docs/specs/03-ux-design-system.md) | UX e design system |
| [`docs/specs/04-review.md`](docs/specs/04-review.md) | Revisão cruzada (palavra final em caso de dúvida) |
| [`docs/00-discovery-brief.md`](docs/00-discovery-brief.md) | Discovery original (desatualizado em marca e tom) |

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `apps/web` | PWA (Vite, React, Dexie, Workbox); testes em `test/` (Vitest) e `e2e/` (Playwright) |
| `packages/domain` | Regras de negócio puras (faturas, disponível, 50/30/20, conciliação), dinheiro em centavos inteiros |
| `packages/nfce-parser` | Leitura defensiva da página da NFC-e |
| `supabase` | Migrações, RLS, testes pgTAP (`tests/`) e Edge Functions (`functions/`) |
| `scripts` | Portões do CI (`ci-guard`, `ci-secrets`), deploy, keepalive e restauração do backup |

## Desenvolvimento

Requisitos: Node.js 24 (`.nvmrc`), pnpm via Corepack, Docker para o Supabase local e Deno para as Edge Functions.

```sh
corepack enable
pnpm install --frozen-lockfile   # também instala os hooks do lefthook
supabase start                   # banco, auth e funções locais
pnpm --filter @oakfinance/web dev
pnpm ci:local                    # os mesmos 8 checks do CI, na mesma ordem
```

| Comando | Para quê |
|---|---|
| `pnpm verify` | lint + typecheck + vendor --check + testes + build |
| `pnpm test:db` | `supabase db reset`, pgTAP e testes de integração |
| `pnpm test:fn` | testes das Edge Functions (Deno) |
| `pnpm e2e` | Playwright nos projetos android, iphone e desktop |
| `scripts/restore-backup.sh` | ensaio de restauração do dump cifrado, só em banco local |

- Commits em Conventional Commits, pt-BR, no imperativo, com escopo da tech §2.5 (o hook `commit-msg` valida).
- Variáveis de ambiente: só os nomes em [`.env.example`](.env.example). O repositório é público: nunca versione segredos nem dados reais.
- Todo merge em `main` passa pelos 8 checks (`guard`, `secrets`, `lint-types`, `unit`, `db`, `fn`, `e2e`, `build`); o `deploy.yml` faz o backup cifrado e publica staging e produção.

## Licença

Sem licença: todos os direitos reservados (decisão do dono, D-072). O código está público para leitura e auditoria; reutilizá-lo exige autorização.
