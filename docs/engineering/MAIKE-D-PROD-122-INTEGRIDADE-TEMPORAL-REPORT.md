# D-PROD-122 — S1/H1: integridade temporal do rebanho

**Decisão:** [D-PROD-122](./DECISIONS.md)
**Base:** `origin/main` `f49004a1` (merge da #189)
**Escopo:** só o S1/H1. Ficam fora o H2 (ordem do histórico), o H4 (mensagens de bloqueio) e o H3 (categorias).
**Produção, Preview e Supabase:** nenhuma escrita e nenhuma conexão. Todos os testes rodaram em PostgreSQL 16 local com dados sintéticos.

## Problema (KM - 06, leitura do arquiteto em 04/11/2026)

Uma morte com data de 27/11, registrada em 04/11, entrou na projeção. Resultado: `PosicaoRebanho` mostrava 49 cabeças, contra 50 no saldo as-of de 04/11.

As causas, confirmadas no código:

1. `reprojetar()` soma todas as partidas ativas, sem corte de data.
2. Nenhum comando recusava data posterior a hoje. Havia só checagem de formato e o corte inferior (`REBANHO_ANTES_DO_CORTE`).
3. Não havia fuso da fazenda. O único "hoje" do backend era o dia UTC, usado na ativação sem entradas.

## O que mudou

| Peça | Arquivo | Efeito |
|---|---|---|
| Fuso da fazenda | `backend/prisma/schema.prisma`, migration `20261104200000_empresa_fuso_horario` | Coluna `Empresa.fuso_horario VARCHAR(64) NULL`, sem DEFAULT. EXPAND puro, também no manifesto do pré-merge. |
| Tempo da fazenda | `backend/src/modules/rebanhoLedger/rebanhoLedgerTempo.js` | `normalizarFusoIana` (Intl, canônico, offset recusado); `diaNoFuso`; `hojeDaEmpresa`, que falha fechado sem fuso; `exigirDiaNaoFuturo`; relógio de teste, só em `NODE_ENV=test`. |
| Guarda única | `rebanhoLedgerNucleo.js` → `exigirDiaNoLedger(tx, clienteId, ativacao, dia)` | Aplica corte e "hoje" em todo fato novo. Roda dentro da transação, depois da idempotência e antes de qualquer escrita. |
| Ativação | `rebanhoLedgerService.js` → `ativarEmpresaNaTransacao` | Valida `data_corte` (saldo de abertura) e o conjunto de entradas (modo entradas, com `details.lotes`). O corte informativo deixa de ser o dia UTC. |
| Erros estáveis | `errorCodes.js` | `REBANHO_DATA_FUTURA` 409 `{data, hoje, fuso}`, `EMPRESA_FUSO_NAO_CONFIGURADO` 409 `{empresa_id}`, `EMPRESA_FUSO_INVALIDO` 400. |
| Configuração | `empresaRoutes.js` / `empresaService.js` | `PUT /empresas/:id/fuso-horario`: só administrador, empresa travada, AuditLog com anterior e novo. Trocar um fuso existente exige motivo; o mesmo valor não muda nada. `POST /empresas` aceita `fuso_horario` opcional. O PATCH genérico continua recusando o campo. |
| UI mínima | `FormularioEmpresa.jsx`, `Empresa.jsx`, `apis/empresa`, `empresaService`, `empresaWritePayload` | Campo "Fuso horário da fazenda" com a lista do Brasil, sem padrão e sem inferir pela UF. Na criação, vai no POST. Na edição, o botão "Salvar fuso" chama a rota administrativa, online. Não houve mudança no mapa nem nos formulários de manejo. |
| Inventário | `scripts/ops/inventario-futuros-rebanho.mjs` + `inventarioFuturosRebanhoLib.mjs` | Somente leitura, em transação `READ ONLY`, e só em banco local. Detalhes em [Inventário](#inventário-de-fatos-futuros). |
| Testes | `backend/tests/dProd122IntegridadeTemporal.test.mjs` (37), `tests/smoke/empresaFusoHorario.test.jsx` (6) | — |
| Runner e fixtures | `scripts/tests/run-backend-tests.mjs`; 27 arquivos de teste | O runner define `NODE_ENV=test` e `MAIKE_TESTE_AGORA` só no processo dos testes. As fixtures que criam Empresa recebem `fuso_horario` explícito. Nenhuma data foi reescrita. |

## Política

- **Fato realizado × planejado.** O ledger só registra o que já aconteceu. Agendamento seria outro domínio, sem partidas, e não foi criado.
- **Hoje.** É o relógio do servidor convertido para o fuso IANA da Empresa. Nunca o navegador, nunca UTC, nunca inferido de UF ou cidade.
- **Data operacional.** Vale o dia literal informado (AAAA-MM-DD).
  - Hora ou offset na string não deslocam o dia. Por exemplo, `2026-11-04T23:00:00-03:00` conta como 04/11.
  - É a mesma semântica de `diaDe` desde a R2A.
  - Nenhum dado gravado muda de dia.
- **Retroativo e mesmo dia.** Continuam aceitos, com as guardas de sempre: saldo ≥ 0 em toda a linha do tempo, ordem causal e corte.
- **Sem fuso.** Todo fato novo recebe `EMPRESA_FUSO_NAO_CONFIGURADO`. Leitura, as-of, verificação, histórico, elegibilidade e exclusão continuam funcionando.
  - Exceção: a empresa nova sem entradas nasce ativada sem fuso. Ali nenhum fato é criado.
- **Replay.** Um recibo committed idêntico devolve a mesma resposta, mesmo que o fato seja futuro e mesmo sem fuso. Uma operação nova recusada não deixa linha, recibo nem auditoria.
- **Troca de fuso.** Só o administrador troca, com motivo, e a troca fica no AuditLog. Nenhuma data antiga é reescrita.
  - A troca afeta só o "hoje" de fatos novos.
  - Na fronteira do dia, um mesmo instante pode ser hoje ou amanhã conforme o fuso (provado no teste F-fuso).

## Caminhos de escrita cobertos

Inventário refeito na main atual. O único escritor de `EventoRebanho`, `PartidaRebanho` e `PesoRebanho` é o módulo `rebanhoLedger`. O `estoquePecuarioLedger` não tem rota e grava em schema próprio.

| Caminho | Entrada | Guarda |
|---|---|---|
| Entrada (cadastro de Lote em empresa ativada) | `POST /lotes` → `registrarEntradaSeAtivo` | `exigirDiaNoLedger` |
| Transferência (comando) | `POST /rebanho/comandos/transferencia` | idem |
| Transferência (legado) | `POST /movimentacoes-mapa/comandos/manejo-lote` → `executarTransferencia` | idem |
| Morte (legado) | manejo-lote → `baixaNoLedger` | idem |
| Morte e abate (baixa) | `POST /movimentacoes-mapa/comandos/baixa-rebanho` | idem |
| Nascimento, pesagem e mudança | `POST /movimentacoes-mapa/comandos/manejo-rebanho` | idem |
| Junção | `POST /movimentacoes-mapa/comandos/juncao-lotes` | idem |
| Ativação: saldo de abertura | `POST /rebanho/ativacao`, cutover | `data_corte <= hoje` |
| Ativação: entradas | idem, mais `POST /empresas` (empresa nova) | nenhuma entrada futura no conjunto |
| Cadastro em empresa NÃO ativada (legado) | `POST /lotes` | sem guarda: não é fato do ledger. A ativação recusa depois se houver entrada futura (teste A2). |

## RED → GREEN

Evidência: `evidencias/d-prod-122/red-green.txt`.

**Na main `f49004a1`, sem implementação:** 32 de 36 falham. A transferência para amanhã é aceita com 201 onde se exige 409.

**Na branch:** 38 de 38 passam (inclui F-troca, da R2).

| Grupo | Testes |
|---|---|
| Puros | P1 (23:59/00:00 em SP, Cuiabá e Rio Branco; virada UTC; bissexto), P2 (IANA válido e inválido), P3 (relógio concorrente isolado), P4 (fora de teste o relógio é recusado e `MAIKE_TESTE_AGORA` é ignorado) |
| Caminhos | F ×10: amanhã → 409 sem escrita (fotografia de lotes, posições, eventos, partidas, pesos, movimentos, recibos e auditoria); hoje → 201 |
| Bordas | F-R (retroativo), F-ISO (dia literal), F-borda (23:59/00:00 nos três fusos), F-fuso (mesmo instante em SP e Rio Branco), F-conc (3 futuros simultâneos) |
| Ativação | A1 (corte futuro), A2 (entrada futura no conjunto), A3, A4 (corte = hoje da fazenda, não UTC), A5 (sem fuso, rollback) |
| Sem fuso | S1: os 10 caminhos dão 409; leitura, as-of, verificação, histórico, elegibilidade e exclusão seguem |
| Futuro legado | R1 (replay idêntico, inclusive sem fuso), R2 (operação nova → 409, sem recibo), R3 (exclusão segura restaura exatamente, sem bloqueio por data nem fuso) |
| Configuração | C1 (admin, inválido, comum 403, PATCH recusa, leitura), C2 (motivo e auditoria), C3 (tenant B), C4 (404), C5 (`POST /empresas` com e sem fuso) |
| Inventário | K1 (KM-06 sintético: projeção 49 × as-of 50), K2 (escrita na transação recusada pelo PostgreSQL), K3 (sem fuso), K4 (ids com hash) |

**Regressão (`verify:all` local no `110e5ec9`, EXIT=0, "TODAS AS ETAPAS PASSARAM"):**

- backend 811 testes: 806 passando, 5 `todo` pré-existentes, 0 falhas;
- gates 686/686;
- smoke (vitest) 1345/1345;
- `gate:types` sem regressão (dívida de 926 para 925);
- `typecheck:backend`, lint e `gate:rebanho-ssot` PASSARAM.

## Migration local

Evidência: `evidencias/d-prod-122/migration-local.txt`.

1. Banco vazio → `deploy:migrate` aplica as 30 migrations.
2. Reaplicar → "No pending migrations".
3. A coluna criada é `varchar(64)`, anulável, sem DEFAULT.
4. O checksum em `_prisma_migrations` bate com o manifesto.
5. A base local já povoada recebe só a migration nova. Nenhuma empresa recebe fuso automaticamente.

## Inventário de fatos futuros

Evidências: `evidencias/d-prod-122/inventario-cli.txt` e `inventario-km06-sintetico.json`.

- **Alvo.** Usa o mesmo do runtime (`POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL`).
  - Recusa host não local, nome de banco com `prod` ou `supabase` e servidor com papéis Supabase.
  - Não há flag para contornar. A URL nunca é impressa.
- **Saída por empresa ativada com fuso:**
  - eventos futuros (tipo, data, registro, posições, áreas, fatos posteriores nas mesmas posições);
  - posições divergentes (projeção × até hoje × futuro), com a causa: `fato_futuro` ou `projecao_inconsistente`;
  - pesos futuros;
  - totais.
- Empresas sem fuso saem listadas à parte.
- **KM-06 sintético** (relógio real 04/11/2026, fuso SP): 1 MORTE futura em 2026-11-27. Na posição Bezerro, a projeção é 0 e o saldo até hoje é 1 (futuro −1, causa `fato_futuro`). Totais: 49 × 50.

## Release segura (PR190-R2): portões, runbook e rollback

### Por que o runbook anterior era inválido

O runbook anterior (backup → migration → configurar o fuso pela tela ou pelo `PUT` → publicar) não era executável. A tela e a rota `PUT /empresas/:id/fuso-horario` nascem nesta PR, então **não existem no runtime publicado antes do merge**. Configurar por elas antes do deploy é impossível.

Também faltavam três coisas:
- prova do alvo;
- prova de que o merge publica sozinho;
- defesa contra publicar antes da migration.

### Fatos verificados (somente leitura, 04/11/2026)

| Fato | Evidência |
|---|---|
| O merge na `main` publica produção **automaticamente** | Vercel `list_deployments` (production): #185, #186, #187, #188 e #189 geraram, cada um, um deployment `READY` com `githubCommitRef=main` no SHA do merge. Não foi encontrada pausa, nem ignored build step, nem promoção manual. O `get_project` não expõe configuração de git que bloqueie. |
| O build **não migra** | `vercel.json`: `buildCommand = npm run prisma:generate && npm run build`. O `quality.yml` só roda `verify:all` com Postgres efêmero. O `release-migrate.yml` é `workflow_dispatch` manual. |
| Alvo do runtime | `env.js` usa `POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL`. Na Vercel, `POSTGRES_PRISMA_URL` vem da integração Supabase e está em **production e preview**: o Preview desta PR usa o MESMO banco da produção. Valores não foram decifrados nem lidos. |
| Estado do Supabase `uuemcasqcdjucflulkne` | Leitura do ARQUITETO: migration NÃO aplicada, coluna ausente, 1 empresa ativada. Não repetido aqui e sem nenhuma mutação. |
| Vínculo Vercel ↔ esse projeto Supabase | **Não comprovado**: os valores de conexão são segredos. O nome do projeto não prova nada → `TARGET_UNVERIFIED` até a prova por `system_identifier` (passo R2). |
| Código novo sobre schema antigo | Teste A1: `prisma.empresa.findMany()` → **P2022** (o client novo seleciona `fuso_horario`). Publicar antes da migration derruba Empresa e o ledger. |

### Portões

| Portão | Definição | Como se prova |
|---|---|---|
| CODE_READY | Código e testes aprovados | CI `verify:all` verde no HEAD e auditoria do arquiteto |
| TARGET_PROVEN | O banco da migration e da configuração é o MESMO do runtime de produção, e esse banco é o AUTORIZADO | Na mesma execução do `preflight-fuso-release.mjs` (R3): a URL do runtime de production (a que vence a precedência) e a `MIGRATION_DATABASE_URL` são lidas. As duas precisam do mesmo `system_identifier` = esperado, do mesmo OID de banco e do mesmo histórico. O SID esperado só vale com `RELEASE_ALVO_ATESTADO`: quem o obteve no banco autorizado, como e quando. Faltou qualquer item → TARGET_UNVERIFIED |
| SCHEMA_READY | Migration `20261104200000_empresa_fuso_horario` aplicada, concluída, não revertida, checksum do manifesto; coluna `varchar(64)` anulável | `preflight-fuso-release.mjs` (somente leitura) |
| DATA_READY | Toda empresa ATIVADA no ledger com fuso IANA explícito válido. Sem padrão global, sem inferência, sem valor fabricado | `preflight-fuso-release.mjs` |
| DEPLOY_GUARDED | Nenhum código novo exposto antes de TARGET, SCHEMA e DATA | **Procedimental**: o merge é o único gatilho do deploy de produção e só acontece depois do preflight READY anexado à PR. Não existe trava técnica na Vercel comprovada (ver Riscos). |
| OPERATIONAL_RELEASE_READY | TARGET ∧ SCHEMA ∧ DATA ∧ DEPLOY_GUARDED, com evidências e autorização | — |

### Runbook novo (nada executado nesta rodada; cada passo exige autorização do proprietário)

Executa o **proprietário ou um operador autorizado**, numa máquina protegida, com checkout EXATO do SHA aprovado da PR. Os segredos ficam só no terminal dele; nada é versionado e nenhuma URL é impressa.

**R0 — Congelamento.** A PR #190 continua DRAFT. Ninguém faz merge até o R5 dar READY.

**R1 — Backup restaurável.**
- Backup ou PITR do projeto Supabase de produção, conferido como restaurável.
- Anotar a referência (id e horário). Ela vai para o AuditLog do R4.
- Sem isso, o R4 recusa em alvo remoto (`BACKUP_NAO_COMPROVADO`).

**R2 — TARGET_PROVEN.** Quem atesta o alvo é o **proprietário**.
1. Logado no painel do projeto Supabase AUTORIZADO, ele roda no SQL Editor `SELECT system_identifier FROM pg_control_system();` e anota o valor fora do repositório. É ele quem atesta.
   - Num PostgreSQL 16 padrão, a função é executável por qualquer papel; isso foi provado localmente com um papel sem privilégio.
   - Se no Supabase alguma conexão negar a leitura, o resultado é TARGET_UNVERIFIED: **PARAR**. Não existe prova alternativa por hostname.
2. No terminal do operador, exportar:
   - `POSTGRES_PRISMA_URL` = o valor de **production** na Vercel (o que o runtime usa);
   - `MIGRATION_DATABASE_URL` = conexão direta ou de sessão, não o pooler 6543;
   - `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER` = o valor do passo 1;
   - `RELEASE_ALVO_ATESTADO` = "<quem>, SQL Editor do projeto autorizado, <data/hora>".
3. Rodar:

       node scripts/deploy/conferir-alvo-banco.mjs   → "ALVO CONFERE"

4. Se der divergente, sem acesso ou faltar o atestado: **PARAR** (TARGET_UNVERIFIED).

**R3 — SCHEMA, pré-merge e compatível com o runtime atual.**

      node scripts/deploy/premerge-migrate.mjs --sha <HEAD da PR> --verificar-alvo
      node scripts/deploy/premerge-migrate.mjs --sha <HEAD da PR> --aplicar

- É o executor auditado da D-PROD-107: manifesto pinado, allowlist EXPAND, `system_identifier` e recusa do pooler.
- A migration só ADICIONA uma coluna anulável. O runtime antigo, ainda no ar, não a seleciona e segue funcionando.

**R4 — DATA, configurado DIRETO no banco, sem o runtime novo.**
1. O proprietário escreve o plano, **fora do repositório**. Ele lista as empresas ativadas com o fuso escolhido por ele (IANA), e um administrador ativo de cada cliente assina:

       { "administradores": { "<cliente_id>": "<usuario_id admin>" },
         "empresas": [ { "cliente_id": "…", "empresa_id": "…", "fuso_horario": "America/Cuiaba" } ] }

2. Simulação (padrão, nada é gravado):

       FUSO_DATABASE_URL=<migration> FUSO_EXPECTED_SYSTEM_IDENTIFIER=… RELEASE_ALVO_ATESTADO="…" \
         node scripts/ops/configurar-fuso-empresas.mjs --plano /fora/do/repo/plano.json

3. Aplicação: uma transação, Empresa `FOR UPDATE`, AuditLog por mudança com a referência do backup, tudo ou nada:

       … --aplicar --confirmar APLICAR_FUSOS_DAS_FAZENDAS --referencia-backup "<R1>"

- **Recusa** com:
  - alvo sem `system_identifier` ou divergente;
  - sem frase de confirmação; sem backup;
  - plano dentro do repositório, inclusive por symlink (o caminho real é conferido), ou inexistente;
  - sem `RELEASE_ALVO_ATESTADO` ao aplicar em alvo remoto;
  - `system_identifier` ilegível (TARGET_UNVERIFIED);
  - argumento repetido ou sem valor;
  - schema não pronto;
  - empresa de outro cliente ou inexistente;
  - IANA inválido;
  - administrador inválido;
  - duplicata;
  - troca de fuso existente sem motivo.
- **Reexecutar é seguro:** fuso igual não muda nada e não gera auditoria nova.
- **Saída (R3):** só hashes estáveis (`h:` + 12 hex) de cliente e empresa, nunca o id cru, nem do administrador, nem em erros. Os ids reais ficam só na transação (UPDATE e AuditLog). Não existe modo detalhado.

**R5 — Preflight final (somente leitura), imediatamente antes do merge.**

      POSTGRES_PRISMA_URL=<production> MIGRATION_DATABASE_URL=<migration> \
      MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=… RELEASE_ALVO_ATESTADO="…" \
        node scripts/deploy/preflight-fuso-release.mjs

- Exige `estado: READY_ALVO_CONFERIDO`, `TARGET: ALVOS_CONFEREM_SID_ATESTADO`, `atestado_alvo: informado`, `SCHEMA_READY: true` e `DATA_READY: true`.
- As **duas** URLs e o atestado são obrigatórios (R3). Uma URL só, SID ausente ou divergente, sem permissão, inalcançável ou bancos diferentes → BLOCKED / TARGET_UNVERIFIED.
- `READY_LOCAL_TESTE` vale só para banco local descartável e **não** é prova de produção.
- A saída nunca traz URL, host, usuário, SID nem ids crus. `--mostrar-ids` é recusado fora do banco local.
- A saída JSON (ids em hash) vai como comentário na PR, para a auditoria.
- BLOCKED → não fazer merge.

**R6 — Merge manual pelo proprietário.** A Vercel publica produção automaticamente. Conferir:
- deployment `READY` no SHA do merge;
- `GET /api/native/health` com `release` = SHA do merge e `status: ok`;
- leitura do Cadastro de Empresa com o fuso visível.

**R7 — Pós-deploy (somente leitura).**
- Inventário de futuros, só em cópia local ou com autorização separada.
- O KM - 06 continua intocado até decisão caso a caso.

**Janela entre R5 e R6.** Uma empresa NOVA criada pelo runtime antigo nesse intervalo nasce ativada sem fuso. Depois do deploy ela recusa manejos com `EMPRESA_FUSO_NAO_CONFIGURADO`, sem gravar nada, até o administrador configurar o fuso na tela nova. É fail-closed, sem perda de dado.

### Rollback e recuperação

- **Problema depois do R6:** Instant Rollback, na Vercel, para o deployment de produção anterior. Ele é `isRollbackCandidate`, e há registros no histórico.
  - O runtime antigo ignora a coluna e os fusos.
  - **Nunca dar DROP na coluna:** ela é inofensiva e preserva a configuração para o re-deploy.
- **Usuários já operaram no runtime novo:** os fatos gravados são válidos nos dois runtimes (data ≤ hoje, mesmo ledger). Não há nada a desfazer. Os fatos recusados (409) não gravaram nada.
- **Merge publicado SEM o R3** (erro de sequência): Empresa e o ledger falham com P2022.
  - O caminho mais rápido é o rollback do deployment.
  - O forward-fix é rodar o R3 e depois o R4.
  - Não aplicar SQL à mão.
- **R4 falhou no meio:** impossível por desenho (uma transação). Basta reler o preflight e reaplicar.

## Saneamento manual dos futuros legados (não executado)

Para cada item do inventário:

1. Identificar a cadeia: fatos posteriores nas mesmas posições.
2. Decidir com o proprietário, caso a caso, entre:
   - **manter até a data**: a projeção se corrige sozinha quando o dia chega;
   - **excluir** pelo `POST /movimentacoes-mapa/:id/exclusao` (elegibilidade, motivo, auditoria) e relançar com a data certa.
3. Nunca usar UPDATE direto em `EventoRebanho`, `PartidaRebanho` ou movimentos. Nunca reprojetar em massa.

O KM - 06 de produção NÃO foi tocado.

## Achado durante a verificação

- **Teste instável pré-existente (CERT-7, D-PROD-113).** O `posDe` usava `findFirst` sem ordem para achar a posição da entrada. Depois de uma mudança de categoria existem duas posições com a mesma entrada e a mesma área, e o PostgreSQL devolvia qualquer uma, conforme a ordem física, que muda após UPDATE.
  - Falhou uma vez no `verify:all` (15 !== 0) e passou 3/3 isolado.
  - Correção só no teste: ordem explícita (`createdAt`, `id`), a posição da entrada é a primeira criada. O mesmo helper de `exclusaoMovimentacaoLedger` recebeu a mesma ordem.
  - Nenhum teste foi desabilitado e o código de produção não mudou por isso.
- **Tipos.** `nativeRequest` passou a aceitar `PUT` no JSDoc; o runtime já repassava o método.

## PR190-R2 — achados e correções

- **Corrida entre troca de fuso e manejo na virada do dia (bug real, corrigido).**
  - Antes, a guarda lia `Empresa.fuso_horario` sem trava. Com um `PUT` de fuso em andamento (Empresa `FOR UPDATE`), o manejo lia o fuso ANTIGO.
  - RED (`F-troca`, relógio 04:30Z, de SP para Rio Branco): uma morte em 05/11 foi aceita com 201 e confirmada depois da troca, ou seja, futura no fuso em vigor.
  - Correção: `fusoDaEmpresa` lê `SELECT … FOR SHARE`. O manejo espera a troca e decide pela versão confirmada (GREEN: 409 `REBANHO_DATA_FUTURA`, fuso Rio Branco, nenhum fato).
  - A ordem de travas Empresa → Área → Posição é a mesma da ativação e do cadastro de lote. Nenhuma trava nova inverte a ordem.
- **Mensagem do 409 sem fuso** passa a dizer onde configurar: Empresa → "Fuso horário da fazenda". Diz também que nada foi gravado.
- **Erro de carga do Cadastro de Empresa (G3).**
  - O adaptador offline não engole o erro do `GET` online.
  - A tela mostra o aviso com "Tentar novamente" e não uma lista vazia. Isso vale também para o 500 que um P2022 produziria.
  - Coberto por um smoke novo em `empresaPage`.
- **Ferramentas de release novas** (somente local nos testes):
  - `scripts/ops/fusoReleaseLib.mjs`;
  - `scripts/ops/configurar-fuso-empresas.mjs`;
  - `scripts/deploy/preflight-fuso-release.mjs`.
  - Suíte `backend/tests/dProd122ReleaseFuso.test.mjs`, 13 testes, matriz A–F.

## PR190-R3 — fechamento do portão de release

**G1 — alvo.**
- RED: o preflight da R2 dava `READY` só com a URL do runtime e o SID; a migration era opcional (`G1-RED1`, `"estado": "READY"` com exit 0).
- Agora (`avaliarAlvoRelease` em `fusoReleaseLib.mjs`), fora do banco local, são obrigatórios:
  - as duas URLs;
  - o SID esperado;
  - o `RELEASE_ALVO_ATESTADO`.
- As duas conexões são lidas e comparadas: SID, OID do banco e histórico de migrations.
- Os estados ficam separados: `READY_LOCAL_TESTE` × `READY_ALVO_CONFERIDO`.
- Bancos diferentes no mesmo cluster → BLOCKED: o mesmo SID não basta.
- Alvo inalcançável → TARGET_UNVERIFIED, não falha técnica genérica.
- O ramo remoto foi exercitado contra o banco LOCAL pelo alias `vm` → 127.0.0.1, que não está na lista de hosts locais. Nada saiu da máquina.

**G2 — confidencialidade.**
- RED: simulação e aplicação imprimiam `cliente_id` e `empresa_id` crus.
- Agora o relatório e os detalhes de erro da biblioteca usam `hashId`. Teste com ids sintéticos cobrindo sucesso, reaplicação, recusa com rollback e o erro serializado da lib.
- `planoForaDoRepositorio` usa `realpathSync`: symlink de fora apontando para dentro do repo é recusado, e plano inexistente também.

**G3 — fail-closed.**
- Argumentos repetidos, desconhecidos ou sem valor → exit 2, sem efeito.
- `system_identifier` ilegível no CLI de configuração → TARGET_UNVERIFIED (exit 3).
- `pg_control_system()`: executável por PUBLIC num PostgreSQL 16 padrão, provado com papel sem privilégio. No Supabase não foi verificado (sem credenciais); se negado → TARGET_UNVERIFIED.
- SCHEMA_READY confere histórico, checksum, concluída/não revertida e coluna. DATA_READY só considera empresas ATIVADAS.
- A migration continua EXPAND: NULL, sem DEFAULT nem UPDATE, checksum inalterado. O rollback recomendado continua só de runtime.

**G4 — integridade.**
- As suítes H1 (38) e release (13) continuam verdes. A R3 tem 12 testes.
- H1 + release + R3 + exclusão + certificação rodaram 3×: 106/106 em cada rodada.
- Nenhuma guarda foi afrouxada: replay antes da guarda, 409 sem escrita, `FOR SHARE` na guarda, `FOR UPDATE` na troca, AuditLog único, sem fallback de fuso, exclusão de futuro legado permitida.

## Riscos e limites

- **DEPLOY_GUARDED é procedimental, não técnico.** O merge publica produção sozinho (comprovado). Nenhuma trava da Vercel foi comprovada e nada foi inventado. A proteção é a ordem: R3, R4 e R5 antes do merge. Desligar o deploy automático da `main` na Vercel é decisão do proprietário e não foi feito.
- **O Preview compartilha o banco de produção** (`POSTGRES_PRISMA_URL` com alvo production e preview). O Preview da #190 roda o código novo contra o schema antigo. As leituras de Empresa dão erro (P2022) e não há escrita parcial (transação), mas o Preview não deve ser usado. Isso é risco pré-existente: `PREVIEW_WRITE_TEST_BLOCKED`.
- **TARGET_UNVERIFIED.** O vínculo entre o runtime da Vercel e o projeto Supabase `uuemcasqcdjucflulkne` só se prova no R2, por `system_identifier`, no terminal do operador.

- **Futuros já gravados continuam.** A projeção atual pode divergir do as-of até a data de cada um ou até o saneamento. O deploy sozinho não corrige o histórico.
- **Fila offline do Lote.** Um lote criado offline com data futura, ou em empresa sem fuso, recebe 409 na sincronização e fica parado no primeiro item da fila (comportamento atual para qualquer 4xx). Não gera duplicata. Os comandos de manejo são só online.
- **UI dos formulários de manejo.** Os inputs de data continuam sem `max`, e há padrões `toISOString()` (UTC) no `DetalhesLote` e em outros pontos. O servidor recusa com mensagem em pt-BR. O ajuste da UI fica para um slice próprio. Nunca é segurança.
- **Relógio de teste.** Existe só com `NODE_ENV=test`. O runner o define apenas no processo dos testes, nunca no job do CI.
- **Ativação de empresa nova sem fuso.** O `data_corte` do modo entradas é informativo (o dia do servidor) e não decide nenhuma regra.
- **Inventário.** Varre todas as empresas do banco alvo, que é local. O uso em cópia ou produção exige autorização separada.
