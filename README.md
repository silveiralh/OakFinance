# OakFinance

PWA de finanças pessoais: lançamento rápido offline, cartões e faturas com parcelas projetadas, orçamento 50/30/20, reserva de emergência e entradas automáticas (Open Finance BB/Nubank, OFX/CSV, NFC-e). Visual Aero sóbrio, marca tipográfica.

## Documentação
| Arquivo | Conteúdo |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Guia operacional das sessões automáticas de desenvolvimento |
| [`docs/TASKS.md`](docs/TASKS.md) | Cadeia de tarefas T-001…T-099 (ordem, dependências, status) |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Passagem de bastão entre sessões |
| [`docs/SETUP.md`](docs/SETUP.md) | Checklist de configuração do cliente |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Log de decisões (aponta para os ADRs) |
| [`docs/00-discovery-brief.md`](docs/00-discovery-brief.md) | Discovery com o cliente |
| [`docs/specs/01-prd-backlog.md`](docs/specs/01-prd-backlog.md) | PRD, regras de negócio e backlog |
| [`docs/specs/02-tech-spec.md`](docs/specs/02-tech-spec.md) | Especificação técnica |
| [`docs/specs/03-ux-design-system.md`](docs/specs/03-ux-design-system.md) | UX e design system |
| [`docs/specs/04-review.md`](docs/specs/04-review.md) | Revisão cruzada |

## Desenvolvimento

Requisitos: Node.js 24 (`.nvmrc`) e pnpm via Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile   # também instala os hooks do lefthook
pnpm lint                        # biome ci .
```

- Commits em Conventional Commits, pt-BR, no imperativo, com escopo da tech §2.5 (o hook `commit-msg` valida).
- Variáveis de ambiente: só os nomes em [`.env.example`](.env.example). O repositório é público: nunca versione segredos nem dados reais.
