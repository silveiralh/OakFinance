# HANDOFF — passagem de bastão entre sessões

> Repositório público: nada de segredos, e-mails, nomes, documentos ou dados reais neste arquivo.

## 1. Estado atual

- Repositório com `README.md`, `docs/00-discovery-brief.md`, as specs em `docs/specs/01..04`, `CLAUDE.md`, `docs/TASKS.md`, `docs/HANDOFF.md` e `docs/SETUP.md`.
- Ainda não há código, CI, banco nem deploy.
- Marco atual: nenhum. O próximo é o M0 (portão ativo, depois da T-007).

## 2. Estado do CI e do deploy

- CI: inexistente (nasce na T-004). Até lá, o merge acontece só depois dos checks locais.
- Deploy, nightly e keepalive: inexistentes (nascem na T-005; o deploy só funciona de verdade na T-036).
- Ruleset de `main`: ainda não ativo (SETUP-04, depois da T-006).

## 3. Próximos passos

- **Próxima tarefa: T-001 — Tooling da raiz e documentos base.**
- A T-001 também cria `docs/DECISIONS.md` (D-001..D-006), o Apêndice A em `docs/specs/02-tech-spec.md` e a issue `Setup do cliente` com a lista SETUP-01..SETUP-17.
- T-001 a T-006 formam o bootstrap. Todos os arquivos protegidos pelo guard (workflows, `biome.json`, `vitest.config.*`, `playwright.config.ts`, `coverage-baseline.json`, `.gitleaks.toml`, `000-setup.test.sql`, `lefthook.yml`, scripts do guard e de segredos) precisam nascer nessas tarefas. Depois da T-006, mexer neles exige `needs-owner`.
- Depois da T-006, peça ao cliente o SETUP-04 (ruleset). A T-007 confere; até lá a cadeia para.

## 4. Bloqueios e pendências do cliente

| Item | Quando é necessário | Desbloqueia |
|---|---|---|
| SETUP-01 a SETUP-03 (repositório público, opções, credencial sem admin) | antes da 1ª sessão | operação segura das sessões |
| SETUP-04 ruleset | depois da T-006 | T-007 e toda a cadeia |
| SETUP-05 a SETUP-09, SETUP-12 (Supabase, Google, Cloudflare, Environments, backup) | até a T-036 (~dia 6) | T-036 |
| SETUP-10 allowlist, Vault, hook, secrets das funções | depois da T-036 | M1 (login real) |
| SETUP-11 VAPID | depois da T-064 | M2 (push real) |
| SETUP-13 Pluggy e Meu Pluggy (trial de 15 dias) | quando a T-077 estiver `done` | T-083, M3 |
| SETUP-14 arquivos reais anonimizáveis (canal privado) | antes da S4 | T-085, T-087, T-090 |
| SETUP-15 licença; SETUP-16 decisões pendentes | antes da T-099 | T-099 |

Nenhuma tarefa está bloqueada por enquanto.

## 5. Riscos conhecidos

- **R14 vazamento em repositório público:** qualquer segredo ou dado real commitado fica no histórico para sempre. Se acontecer, registre aqui e peça ao cliente para girar a credencial na hora.
- **Autobloqueio do guard:** o PR do próprio guard (T-006) precisa do modo bootstrap; arquivo protegido esquecido no bootstrap vira `needs-owner`.
- **R1 trial da Pluggy (15 dias):** só iniciar com a T-077 pronta; os dois usuários conectam BB e Nubank dentro da janela.
- **R5 OAuth no iPhone instalado:** validar no M1; plano B na tech §10.
- **R17 ferramentas recentes** (Vite 8, React Router 8, Vitest 5, TS 6.0 fixado): conferir a documentação da versão instalada.
- **NFC-e sem páginas reais:** a T-090 fica bloqueada e o app entrega só o fallback (T-088, T-089).
- **D-005:** o timeout da NFC-e é 10 s (RN-84), e não os 20 s da tech §6.2.3.
- **Ritmo:** cerca de 99 tarefas a 6 sessões por dia ≈ 17 dias corridos sem bloqueios. O núcleo (M2) fica pronto por volta do dia 12.

## 6. Checklist de aparelho real

Vazio. A T-036 e a T-045 preenchem o checklist do M1 (tech §8.5).

## 7. Histórico

| Data | Tarefa | PR | Resultado | Observação |
|---|---|---|---|---|
| 05/11/2026 | — | — | plano criado | specs, CLAUDE.md, TASKS, HANDOFF e SETUP no repositório |
