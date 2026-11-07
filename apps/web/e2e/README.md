# E2E — matriz cenário × história (T-095)

Cenários obrigatórios da tech §8.4 (E01–E20). Todos rodam em **todo PR** nos três projetos do Playwright (`android`, `iphone` e `desktop`), salvo indicação, e o `nightly` repete com `--repeat-each=3`. Uma repetição que passa depois de falhar reprova o shard (testes instáveis não são aceitos).

Usuários de teste: só e-mails `@example.test` da allowlist do `supabase/seed.sql`. Cenários que gravam no perfil ou dependem de um estado do usuário (sem renda, onboarding, conferência, CSV, NFC-e) usam um usuário por projeto (`e2e-<cenário>-<projeto>@example.test`) para não se misturarem quando rodam em paralelo.

| # | Cenário (tech §8.4) | Histórias | Teste | Situação |
|---|---|---|---|---|
| E01 | Login → onboarding → seeds sem duplicar ao relogar | US-01, US-08, US-27 | `onboarding.spec.ts`, `seeds.spec.ts` | coberto |
| E02 | Lançamento rápido; o painel diminui o valor exato | US-12, US-30 | `dashboard.spec.ts` | coberto |
| E03 | Offline: lança, edita, exclui, recarrega e sincroniza | US-04 | `offline.spec.ts` | coberto (recarga pelo SW só em `android`/`desktop`) |
| E04 | Compra 3× no cartão nas 3 faturas; pagar deixa a fatura `paid` | US-17, US-18, US-19, US-20 | `invoices.spec.ts` | coberto |
| E05 | Recorrência a vencer some ao ser confirmada | US-25, US-26 | `recurrences.spec.ts` | coberto |
| E06 | Conflito offline: o mais recente vence; Histórico com as duas versões | US-04, US-13 | `history.spec.ts` | coberto |
| E07 | OFX: prévia, conciliação, sugestão e reimportação sem duplicar | US-52 | `import-ofx.spec.ts` | coberto (fixture sintética; a real anonimizada fica para a T-085, SETUP-14) |
| E08 | CSV pelo assistente de colunas | US-53 | `import-csv.spec.ts` | coberto |
| E09 | NFC-e: `full` com itens, `fallback` e `pending` | US-54, US-55, US-56 | `nfce.spec.ts` | fallback e offline cobertos; **`full` com itens: lacuna conhecida** (T-090, SETUP-14) |
| E10 | Open Finance com o mock | US-45 a US-51 | — | **lacuna conhecida**: T-076 (`needs-owner`) e T-077/T-083 (SETUP-13) |
| E11 | Isolamento entre usuários | US-02, RN-102 | `seeds.spec.ts` | coberto |
| E12 | Acessibilidade (axe nos 2 temas) e movimento reduzido | US-58, US-62 | `appearance.spec.ts` | movimento reduzido coberto; **axe nos 2 temas: escopo da T-096** |
| E13 | Ocultar valores | US-57 | `hide-values.spec.ts` | coberto |
| E14 | CSP sem violação em todos os cenários | US-03 (tech §7) | `fixtures/base.ts` (todos), `shell.spec.ts` | coberto |
| E15 | Atualização do SW sem perder o rascunho | US-03, US-05 | `sw.spec.ts` | coberto em `android`/`desktop` (o WebKit do Playwright não controla SW) |
| E16 | Instalação guiada no iPhone antes do login | US-06, US-07 | `install.spec.ts` | coberto |
| E17 | Painel: referência da RN-47, sem renda, negativo, zero e virada do mês | US-30 | `dashboard.spec.ts` (sem renda), `test/dashboard.test.tsx` (referência, negativo, zero e virada) | coberto; os casos com data fixa ficam no teste de componente porque fixar o relógio do navegador quebra a sessão do Supabase |
| E18 | Central de avisos | US-37 | `notices.spec.ts` | coberto |
| E19 | Fechar o mês | US-36 | `close-month.spec.ts` | coberto |
| E20 | Sair com alterações pendentes | US-05, RN-100 | `auth.spec.ts` | coberto |

## Lacunas conhecidas

- **E09 `full` com itens** — depende das páginas reais da SEFAZ-PR anonimizadas (T-090, SETUP-14). O teste de hoje injeta o QR pelo stub do detector e simula a resposta do `nfce-fetch` pelo gancho `window.__oakE2ENfce` (só no build E2E).
- **E10 Open Finance** — depende da decisão do dono na T-076 (o widget da Pluggy e o `check-build`) e do SETUP-13.
- **E12 axe** — entra com a T-096 (dependência nova `@axe-core/playwright`, todas as telas da UX §8 nos 2 temas e com `data-glass="solid"`).

## Como rodar

- `pnpm e2e` — build E2E e os 3 projetos (precisa do Supabase local: `supabase start`).
- `pnpm e2e -- nfce` — só um arquivo.
- `pnpm e2e -- --repeat-each=3` — como o nightly.
