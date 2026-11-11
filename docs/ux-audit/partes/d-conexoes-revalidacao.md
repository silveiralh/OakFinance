# Auditoria de UX — 11/11/2026 · parte D: revalidação das conexões

Escopo: I01, I02, I03, S01 e, no H01, só o aviso de conexão (`ConnectionBanner`) · tamanhos `small` 360×640, `phone` 390×844 (claro e escuro) e `desktop` 1280×800 · capturas novas: `/tmp/claude-0/-home-claude/c11706d4-8982-5bbe-949b-0b13adbf4a3a/scratchpad/shots-conexoes` (comparadas com `/tmp/claude-0/-home-claude/c11706d4-8982-5bbe-949b-0b13adbf4a3a/scratchpad/shots`) · commit: 3aea8c3 (com os PRs #124 e #125)

Artefatos do roteiro, que não são achados: o Open Finance é simulado e o seed não cria conexão, então a I01 mostra o vazio e o aviso do Início não aparece em nenhuma captura (avaliado só pelo código, marcado "a confirmar visualmente"); o build E2E troca o widget da Pluggy pelo `FakePluggyConnect`, por isso a I02 capturada tem **Continuar**, que não existe no build de produção (`apps/web/src/features/connections/PluggyWidget.tsx:254-259`).

## Situação dos achados anteriores

| ID | Situação | Nota |
|---|---|---|
| UXC-002 — sem caminho para Conexões e Importar no celular | continua | `S01__phone__light.png` é igual à rodada anterior: sem "Conexões e importação". `apps/web/src/features/settings/screens.tsx:22-52` (`SettingsLinks`) não tem `/ajustes/conexoes`; o único link novo para a I01 é o aviso do Início (`ConnectionBanner.tsx:29`), que só aparece para quem **já tem** uma conexão vencendo. O `FabMenu` segue sem "Importar extrato" (`QuickEntryHost.tsx:59-78`). Lembrar que no celular nem a S01 tem entrada (UXA-001). |
| UXC-003 — "Conectar banco" em tela vazia; faltam Importar e Nota na I01 | mudou (quase resolvido) | A I02 deixou de ser tela vazia: explicação do Meu Pluggy, **Continuar** e **Tenho um Item ID** (`I02__phone__light.png`; `connections/screens.tsx:255-307`). A I01 ganhou as seções 2 e 3 (`I01__phone__light.png`; `screens.tsx:84-107`). O que resta é o estado "indisponível" da UX §3 I01, que continua sem aparecer: `conn.paused` existe em `pt-BR.ts:731` e não é usado em nenhum `.tsx` (ver UXD-002). |
| UXC-004 — S01 como nuvem de pílulas sem grupos | continua | `S01__phone__light.png` e `S01__desktop__light.png` idênticas às anteriores; `settings/screens.tsx:9-52` ainda é a tela provisória com `Button variant="secondary"` soltos e "Sair" com o mesmo peso. |
| UXC-020 — I03 sem indicação de arrastar no desktop | continua | `I03__desktop__light.png` igual à anterior. `apps/web/src/features/imports/screens.tsx:226-233` tem `onDragOver`/`onDrop`, mas nenhum texto "ou arraste o arquivo" nem estilo de `dragover` (`.import-drop-zone` sem regra de estado). |

## Resumo

| Severidade | Achados |
|---|---|
| S1 | 0 |
| S2 | 6 |
| S3 | 6 |

Os 5 que mais melhoram estas telas se corrigidos primeiro:
1. UXD-002 — A I01 promete "receber lançamentos automaticamente" e não diz que a sincronização está indisponível; o caminho termina em "O banco está indisponível agora".
2. UXD-003 — Plano B "Item ID": termo técnico e duas instruções que mandam para lugares diferentes.
3. UXD-001 — "Importar extrato" aparece três vezes na I01, e a ação secundária fica acima do primário com cara de título.
4. UXD-004 — Resultado da conexão com falha oferece **Conferir agora** como ação principal.
5. UXD-005 — Card do banco sem **Desconectar** e I01 sem **Desfazer importação**.

## Achados

### UXD-001 — "Importar extrato" aparece três vezes na I01, e a ação secundária do vazio fica acima do primário

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Hierarquia / Componentes | I01 | todos |

**O que se vê:** em `I01__phone__light.png`, dentro do card "Bancos conectados (Open Finance)", vem o vazio ("Nenhum banco conectado" + texto), depois **Importar extrato** como texto em negrito centralizado (botão fantasma) e só então **Conectar banco** (pílula preta). Logo abaixo começa o card "Importar extrato", com o mesmo texto como título. São três "Importar extrato" seguidos (fantasma, título, botão **Escolher arquivo OFX ou CSV**). O fantasma, em 700, pesa mais que o título do vazio (500, UXC-005) e se lê como cabeçalho de uma seção, não como botão. A ordem fica invertida: a ação secundária vem antes da primária. Igual no escuro (`I01__phone__dark.png`), no `small` e no `desktop`.
**O que a spec pede:** UX §5.25 (`EmptyState` com primária e secundária, nessa ordem); UX §3 I01 (as três seções já dão o atalho para importar); instrução §3 item 2 (um elemento dominante).
**Causa provável:** `apps/web/src/features/connections/screens.tsx:60-66` passa só `secondaryAction` ("Importar extrato") ao `EmptyState`, e o **Conectar banco** é um `Button` à parte, depois do vazio (`:74-82`). O `EmptyState` desenha a secundária como `variant="ghost"` (`apps/web/src/ui/EmptyState.tsx:42-46`).
**Correção sugerida:** no vazio, tirar a `secondaryAction` (a seção 2, logo abaixo, já é o caminho para importar) e passar **Conectar banco** como `primaryAction` do `EmptyState`, desenhando o botão de fora só quando já houver conexões.

### UXD-002 — A I01 promete sincronização automática e não diz que ela está indisponível; o caminho termina em "O banco está indisponível agora"

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados (US-64) / Microcopy | I01, I02 | todos |

**O que se vê:** `I01__phone__light.png` convida "Conecte o BB ou o Nubank para receber lançamentos automaticamente." e dá **Conectar banco** como o botão mais forte da tela. No build de produção não há widget (`widgetAvailable = false`), então a I02 abre direto no campo "Item ID" (`screens.tsx:141`), sem **Continuar**. Enquanto a Pluggy não está configurada (SETUP-13 pendente, `docs/HANDOFF.md:187`), as funções respondem `UPSTREAM_UNAVAILABLE` e a pessoa, depois de colar um código, lê "O banco está indisponível agora. Tente novamente mais tarde." (com o nome genérico "banco", porque ainda não há conexão). A mensagem culpa o banco, sugere esperar e não oferece a alternativa que funciona hoje (importar o extrato). A I01 é a tela certa para dizer isso antes, e não diz.
**O que a spec pede:** UX §3 I01, estado "indisponível no plano gratuito": "Sincronização automática pausada. Enquanto isso, importe o extrato em OFX ou CSV." + atalho para importar; UX §6.2 regra 2 (o erro diz o que aconteceu e o que fazer); US-64.
**Causa provável:** `conn.paused` (`apps/web/src/i18n/pt-BR.ts:731`) não é usado em nenhum componente; o vazio usa sempre `emptyStates.connections` (`screens.tsx:55-66`); `errorText` mapeia `UPSTREAM_UNAVAILABLE` para `conn.unavailable` com `bankName(null)` = "banco" (`apps/web/src/features/connections/model.ts:72`, `:211-212`; chamado em `screens.tsx:172` e `:186`).
**Correção sugerida:** quando a integração não estiver disponível (widget ausente, ou a última chamada a `pluggy-connect-token`/`pluggy-link-item` devolveu `UPSTREAM_UNAVAILABLE`), mostrar no card "Bancos conectados" o `conn.paused` com **Importar extrato** e deixar **Conectar banco** desativado com o motivo. Na I02, para `UPSTREAM_UNAVAILABLE` sem conexão, usar o mesmo `conn.paused` com o atalho para `/importar` em vez de "O banco está indisponível".

### UXD-003 — Plano B "Item ID": termo técnico e duas instruções que mandam para lugares diferentes

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Microcopy | I02, I01 (card do banco) | todos |

**O que se vê:** `I02__phone__light.png` mostra **Tenho um Item ID**; ao tocar (e, no build de produção, já na abertura) aparecem o campo "Item ID" e a dica "Copie o código no dashboard da Pluggy." No card do banco em "Precisa reconectar", o texto diz "abra o Meu Pluggy, autorize o {banco} de novo e copie o novo Item ID". E o erro `conn.notAllowed` diz "Essa conexão não veio do Meu Pluggy. Conecte pelo Meu Pluggy." A pessoa recebe três indicações (dashboard da Pluggy, Meu Pluggy, "conecte pelo Meu Pluggy") para o mesmo código, sem o caminho dentro de nenhum deles. "Item ID" e "dashboard" são termos do desenvolvedor da integração; em produção, hoje, este é o **único** caminho para conectar um banco.
**O que a spec pede:** instrução §3 item 7 (texto técnico aparecendo para a pessoa é defeito); UX §6.2 (rótulo diz o que acontece; erro diz o que fazer). O texto "Tenho um Item ID" é da UX §3 I02, e a origem do código vem da tech §6.1.3 passo 7 ("Demo do dashboard Pluggy, Applications → Demo → Connect Account → Copiar Item ID"); ver Contradições.
**Causa provável:** `apps/web/src/i18n/pt-BR.ts:750-756` (`conn.itemId*`, `conn.notAllowed`) e `:773-774` (`conn.reconnectSteps`); uso em `apps/web/src/features/connections/screens.tsx:276-304` e `BankConnectionCard.tsx:103-105`.
**Correção sugerida:** decidir com o dono de onde o código sai (Meu Pluggy ou dashboard) e usar uma só origem nos três textos, com o passo a passo curto na dica do campo (por exemplo "No Meu Pluggy, abra a conexão do banco e copie o código da conexão."). Rótulo "Código da conexão" no lugar de "Item ID", e link **Tenho o código da conexão**. Texto da UX, então com registro em DECISIONS.

### UXD-004 — Resultado da conexão com falha oferece "Conferir agora" como ação principal

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / Microcopy | I02 (passo de resultado) | todos (pelo código) |

**O que se vê:** não capturado (o roteiro para na explicação). Pelo código, quando a busca dos 90 dias falha depois do mapeamento, o card de resultado mostra a mensagem de erro e, logo abaixo, **Conferir agora** (pílula preta) e **Depois**. Não há nada para conferir, e falta o que fazer (tentar de novo ou importar o extrato). Com sucesso e zero lançamentos, o texto vira "0 lançamentos importados. 0 precisam de conferência." e o primário continua **Conferir agora**, que abre a I05 vazia.
**O que a spec pede:** UX §3 I02 (**Conferir agora** depois de "48 lançamentos importados. 6 precisam de conferência."); UX §6.2 regras 1 e 2; UX §5.1 (um primário que diz o resultado).
**Causa provável:** `apps/web/src/features/connections/screens.tsx:346-357` desenha os mesmos botões para `step.failed` e para o sucesso, e não olha `summary.review`.
**Correção sugerida:** com `failed`, primário **Tentar de novo** (chama `backfill` outra vez) e fantasma **Importar extrato (OFX/CSV)** (`conn.importShortcut`); com sucesso e `review = 0`, primário **Ver lançamentos** ou **Concluir** (volta à I01) e sem **Conferir agora**.

### UXD-005 — Card do banco sem "Desconectar" e I01 sem "Desfazer importação"

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Estados / Componentes | I01 | todos (pelo código) |

**O que se vê:** não capturado (o seed não tem conexão nem importação). Pelo código, o `BankConnectionCard` tem estado, "Atualizado…", "Expira em…", o resumo, **Renovar** (só quando expirada ou para reconectar) e **Atualizar agora**, mas nenhum **Desconectar**: a pessoa não consegue remover um banco pelo app (só excluindo a conta, D-070). A I01 também não oferece o **Desfazer importação** das últimas 24 h, que a spec manda repetir ali; ele só existe dentro da I03.
**O que a spec pede:** UX §3 I01 seção 1 ("botões **Atualizar agora** / **Renovar** / **Desconectar**"); UX §3 I03 ("**Desfazer importação** disponível por 24 h também em I01", RN-78); escopo da T-084 (`docs/TASKS.md:1258`).
**Causa provável:** `apps/web/src/features/connections/BankConnectionCard.tsx:100-134` sem a ação; `disconnect` existe em `apps/web/src/features/connections/api.ts:97-101` e nenhum `.tsx` o usa. O desfazer usa `undoable(data.imports, …)` só em `apps/web/src/features/imports/screens.tsx:221`.
**Correção sugerida:** **Desconectar** como botão fantasma no fim do card, com `ConfirmDialog` ("Desconectar o {banco}?" / "Os lançamentos já importados continuam no app.") chamando `disconnect`; na seção "Importar extrato" da I01, a mesma linha de importações recentes com **Desfazer importação** que a I03 já desenha.

### UXD-006 — Texto encostado no botão nas telas novas (mesma causa do UXC-006)

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S2 | Layout e espaço | I01, I02 | todos |

**O que se vê:** em `I02__phone__light.png` a última linha da explicação ("lançamentos.") fica a cerca de 6 px do **Continuar**. Em `I01__phone__light.png` as dicas "Banco do Brasil: exporte o extrato em OFX (Money 2000+)." e "Disponível para notas emitidas no Paraná." encostam na borda de baixo dos botões; no `desktop` (`I01__desktop__light.png`) o mesmo. Na I03, o card tem respiro, então as duas telas vizinhas parecem de famílias diferentes.
**O que a spec pede:** UX §0.1 (8 px entre alvos adjacentes); UX §4.8 (espaçamento pela escala `--space-*`).
**Causa provável:** a do UXC-006: o corpo do `GlassCard` não tem grade (`apps/web/src/ui/GlassCard.tsx:61-87`; `.card` em `apps/web/src/ui/ui.css:182-190` só com padding). Os cards novos não trazem classe de layout: `apps/web/src/features/connections/screens.tsx:84-107` (seções 2 e 3) e `:263-306` (explicação da I02). Só `.connect-item-id` e `.bank-connection-attention` têm `gap` (`apps/web/src/app/shell.css:1163-1169`).
**Correção sugerida:** resolver junto com o UXC-006 (grade com `gap: var(--space-3)` no corpo do `GlassCard`), somando a I01 e a I02 à lista de telas daquele achado.

### UXD-007 — "Escolher arquivo OFX ou CSV" quebra em duas linhas a 360 px

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout / Tipografia | I01, I03 | small |

**O que se vê:** em `I03__small__light.png` e `I01__small__light.png` o rótulo vira "Escolher arquivo OFX ou / CSV", com o ícone `FileUp` isolado à esquerda e o texto centralizado em bloco. A 390 px cabe numa linha. Na I03 já era assim na rodada anterior (`shots/I03__small__light.png`); com a I01 nova, o defeito passa a aparecer em duas telas.
**O que a spec pede:** instrução §3 item 4 (botões que quebram em duas linhas); mesma família do UXC-014 (I04).
**Causa provável:** `.btn` (`apps/web/src/ui/ui.css:15-30`) não limita o rótulo a uma linha, e o texto `import.choose` (`apps/web/src/i18n/pt-BR.ts`, "Escolher arquivo OFX ou CSV") com ícone e `padding: 0 var(--space-5)` passa da largura útil de 360 px.
**Correção sugerida:** rótulo curto **Escolher arquivo**, com "OFX ou CSV" na dica abaixo (texto da UX §6.4, com registro em DECISIONS); ou, sem mudar o texto, `white-space: nowrap; text-overflow: ellipsis` no rótulo do `Button`, o que também resolve o UXC-014.

### UXD-008 — Na I01, "Escolher arquivo OFX ou CSV" não escolhe arquivo, e a dica do BB muda de lugar entre I01 e I03

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / Consistência | I01, I03 | todos |

**O que se vê:** na I01, **Escolher arquivo OFX ou CSV** não abre o seletor: leva à I03, onde a pessoa encontra outro **Escolher arquivo OFX ou CSV** e precisa tocar de novo. A mesma dica do BB aparece abaixo do botão, em legenda de 13 px cinza, na I01 (`I01__phone__light.png`) e acima do botão, em corpo de 17 px preto, na I03 (`I03__phone__light.png`).
**O que a spec pede:** UX §6.2 regra 1 (o rótulo diz o que acontece); instrução §3 item 5 (mesmo componente com aparência diferente em telas diferentes).
**Causa provável:** `apps/web/src/features/connections/screens.tsx:85-93` (botão navega para `/importar`; dica em `.account-meta` depois do botão); `apps/web/src/features/imports/screens.tsx:235` (dica em `<p>` sem classe antes do botão) e `:244-247`.
**Correção sugerida:** na I01, o botão abre o seletor de arquivo e navega para a I03 já com o arquivo carregado (ou o rótulo passa a dizer o destino, "Importar extrato"); a dica do BB com o mesmo estilo e a mesma posição (legenda abaixo do botão) nas duas telas.

### UXD-009 — Plural fixo nos textos da conexão: "Expira em 1 dias", "1 novas · 1 vinculadas"

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy | I01 (card do banco), I02 (resultado) | todos (pelo código) |

**O que se vê:** não capturado. Com um dia de consentimento, o card mostra "Expira em 1 dias"; com um lançamento, "1 novas · 1 vinculadas · 1 para conferir" e "1 lançamentos importados. 1 precisam de conferência."
**O que a spec pede:** UX §6.2 (texto correto em pt-BR); o Início já trata o caso de 1 ("Amanhã", `apps/web/src/features/dashboard/HomeCards.tsx:16`).
**Causa provável:** `t()` só troca as chaves, sem plural (`apps/web/src/i18n/pt-BR.ts:1212-1216`); usos em `apps/web/src/features/connections/BankConnectionCard.tsx:93` e `:97` e `apps/web/src/features/connections/screens.tsx:349`. A mesma causa produz "Vence em 1 dias" no `InvoiceCard` (`apps/web/src/ui/InvoiceCard.tsx:59`), fora deste escopo.
**Correção sugerida:** variantes `.one` nas chaves com contagem (`conn.expiresIn.one` = "Expira amanhã", `conn.result.one`…) ou um `tn(chave, n)` que escolha a forma com `Intl.PluralRules('pt-BR')`.

### UXD-010 — Aviso do Início: "Renovar" não renova, e o mesmo estado tem cor diferente no aviso e no card

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Microcopy / Consistência | H01 (aviso), I01 | todos (a confirmar visualmente) |

**O que se vê:** não capturado (o seed não tem conexão). Pelo código, o aviso "Sua conexão com o {banco} precisa ser renovada" tem a ação **Renovar**, que leva à lista da I01; lá, o card tem outro **Renovar**, que abre a I02 genérica "Conectar banco" (sem dizer qual banco se está renovando). São três telas e dois botões com o mesmo nome até começar a renovar. Além disso, a conexão expirada ou para reconectar é âmbar no aviso (`tone="warning"`) e vermelha no selo do card (`danger`).
**O que a spec pede:** tech §6.1.3 passo 8 (o **Renovar** do aviso abre o widget com `updateItem`); UX §6.2 regra 1 (o botão diz o que acontece); UX §3 I01 ("expira em breve" em tom alerta).
**Causa provável:** `apps/web/src/features/connections/ConnectionBanner.tsx:29` (`navigate('/ajustes/conexoes')`); `apps/web/src/features/connections/BankConnectionCard.tsx:26-33` (`expired` e `reconnect` em `danger`) e `:107` (Renovar → `/ajustes/conexoes/novo` sem o id da conexão). O widget com `updateItem` espera a mudança do `check-build` (`docs/HANDOFF.md:133`).
**Correção sugerida:** enquanto o widget não entra, ação do aviso **Ver conexão** (diz o destino) ou rolar a I01 até o card do banco; a I02 aberta por Renovar recebe o id e mostra "Renovar a conexão com o {banco}". Um só tom para "precisa de ação": `warning` no aviso e no selo.

### UXD-011 — Card do banco é um card dentro do card, e o nome do banco sai sem peso

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Fidelidade ao visual / Tipografia | I01 | todos (a confirmar visualmente) |

**O que se vê:** não capturado. Pelo código, cada `BankConnectionCard` é um `GlassCard` (`li`) dentro do `GlassCard` da seção "Bancos conectados": branco sobre branco (grafite sobre grafite no escuro), separado só pela sombra e pelo padding duplo. O nome do banco é um `h3` sem regra de peso, então herda 500 do preflight e fica mais leve que o título da seção (600) e que o botão **Atualizar agora** (700).
**O que a spec pede:** UX §4.0 (cards brancos sólidos sobre o fundo menta, sem empilhar superfícies); UX §4.4 (título de card em semibold); instrução §3 item 5.
**Causa provável:** `apps/web/src/features/connections/BankConnectionCard.tsx:81-89` (`GlassCard as="li"` com `h3`); `apps/web/src/features/connections/screens.tsx:58` e `:68-72` (lista dentro do card da seção); `apps/web/src/app/shell.css:1159-1161` (`.bank-connection-head h3` só com `margin: 0`); a causa do peso é a do UXC-005.
**Correção sugerida:** a linha do banco como item de lista (sem `GlassCard`) com divisória `--border-subtle` entre bancos, ou a seção sem card e um card por banco; `h3` com `font-weight: var(--font-weight-bold)` (resolvido de vez pela regra de base do UXC-005).

### UXD-012 — O PR #125 tirou `.reconcile-diffs` da regra da lista da I05

| Severidade | Área | Telas | Tamanhos/temas |
|---|---|---|---|
| S3 | Layout e espaço | I05 (fora do escopo, efeito colateral) | todos (a confirmar visualmente) |

**O que se vê:** não capturado nesta rodada. O bloco de CSS das conexões foi inserido entre `.reconcile-diffs,` e `.inbox-list {`, então a lista de diferenças do `ReconcileCard` ("Data diferente: 03/11 × 04/11") deixou de usar a regra da `.inbox-list` (`margin: 0`) e passou a usar a de `.bank-connections` (`margin: 0 0 var(--space-3)`): ganha 12 px embaixo, antes dos botões **É o mesmo** / **São diferentes**.
**O que a spec pede:** UX §4.8 (espaçamento pela escala, intencional).
**Causa provável:** `apps/web/src/app/shell.css:1141-1149` — `.reconcile-diffs,` seguido do comentário `/* I01/I02 — conexões */` e de `.bank-connections, .connect-mapping {`; antes do PR o seletor continuava em `.inbox-list` (`git diff f948895 3aea8c3 -- apps/web/src/app/shell.css`).
**Correção sugerida:** devolver `.reconcile-diffs` ao seletor da `.inbox-list` (linha 1171) e deixar o bloco das conexões com seletores próprios.

## Contradições e lacunas na spec

- **De onde vem o "Item ID".** A tech §6.1.3 passo 7 manda copiar o código na "Demo do dashboard Pluggy"; o `conn.reconnectSteps` da UX §6.4 (D-074) manda copiar no Meu Pluggy; o `conn.notAllowed` exige que a conexão tenha vindo do Meu Pluggy. O dono precisa dizer qual é o caminho real para os dois usuários (UXD-003).
- **Estado "indisponível no plano gratuito".** A UX §3 I01 define o estado e o texto (`conn.paused`), mas nenhuma regra diz quando o app sabe que está nele (widget ausente? `UPSTREAM_UNAVAILABLE`? flag de configuração?). Sem essa regra, o texto ficou sem uso (UXD-002).
- **Renovar sem widget.** A tech §6.1.3 passo 8 manda o **Renovar** abrir o widget com `updateItem`; enquanto o widget não entra (D-073, HANDOFF §4), a UX não diz o que o botão faz nem o que a I02 mostra numa renovação (UXD-010).
- **Avisos acima do hero no Início.** O `ConnectionBanner` entra depois do `RejectedBanner`, do `InstallCard` e do `PendingSetupCard` e antes do hero (`apps/web/src/features/dashboard/screens.tsx:11-15`). A UX §3 H01 não define quantos avisos podem empilhar antes de "Disponível para gastar" nem a ordem entre eles; com dois ou três ao mesmo tempo, o hero sai da primeira tela a 360×640 (P4). Vale uma regra (por exemplo, no máximo um aviso acima do hero, os outros na central H02).
- **"Expira em breve" no aviso.** A tech põe o consentimento a ≤ 7 dias no mesmo aviso "precisa ser renovada" da conexão já expirada; a UX não diferencia os dois textos, embora no primeiro caso a conexão ainda funcione.

## O que está bom

- A I01 agora tem as três seções da UX §3, com os textos da §6.4, e a importação de extrato e a leitura de nota ficam a um toque mesmo sem banco conectado.
- A I02 explica, antes de qualquer ação, que as credenciais não passam pelo OakFinance; tom calmo e sem jargão nessa frase.
- Ações que precisam de rede ficam desativadas com o motivo "Precisa de internet" (Conectar, Atualizar, Ler QR, Validar), e importar continua funcionando sem rede, como manda a UX §3 I01.
- O erro temporário do banco só aparece depois das três novas tentativas (D-074), o que evita alarme por instabilidade passageira.
- Nenhuma rolagem horizontal nas 28 capturas, e o tema escuro mantém a separação entre card e fundo nas telas novas.
