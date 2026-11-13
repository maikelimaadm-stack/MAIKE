# MAIKE-TIPO-TAREFA-DROP-COLUNAS — Relatório (Fatia LIMPEZA)

**fatia LIMPEZA · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR em rascunho** · Decisão: [D-PROD-183](./DECISIONS.md) · Runbook: [`MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md)

> **A migration NÃO foi aplicada** em nenhum ambiente remoto, e produção não foi lida nem
> escrita. Ela fica pronta na PR. Preflight (só leitura) e aplicação dependem de GO explícito
> do proprietário, um para cada (runbook §2).
>
> A branch pedida foi `feat/tipo-tarefa-drop-colunas`. Esta sessão só publica em branch
> `claude/…`, por isso a branch é `claude/tipo-tarefa-drop-colunas-1aznvv`.

## 1. Entrega

| Camada | O que entrou |
|---|---|
| Banco | migration CONTRACT nova `20261113200000_tipo_tarefa_drop_colunas`: guarda DO + `ALTER TABLE "TipoTarefa" DROP COLUMN` de `exige_area`, `pode_ter_produto`, `pode_ter_maquina` e `pode_ter_implemento`, nesta ordem, sem `CASCADE` |
| Prisma | as 4 linhas `@ignore` saem do model `TipoTarefa` (D-PROD-181 item 4). O Prisma Client não muda: o `@ignore` já tirava as 4 do client |
| Portão de release | segunda entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS` (guarda pinada, `drop: []`, 4 `DROP COLUMN` pinados); a migration no manifesto; o classificador informa `colunas_removidas`; o rótulo do premerge cita "4 colunas removidas (…)" |
| Testes | migration de ponta a ponta em PostgreSQL real; classificador e runner com duas CONTRACT; teste da D-PROD-162 com as contagens novas |
| Ensaio | `scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs`, só contra banco local |
| Documentos | D-PROD-183, runbook de release, este relatório, `CURRENT-STATE` e `GATE-REGISTRY` |

Nada mudou no frontend, nas rotas, no menu ou no escopo. `LancamentoTarefa`,
`AbastecimentoBem` e `TipoAtividade` não foram tocados. As flags não foram reintroduzidas.

## 2. Varredura antes do DROP

Cinco frentes em paralelo, só leitura, mais um crítico de completude que tentou refutar a
conclusão:
- backend (`backend/src`, `api/`, Prisma e SQL cru);
- frontend (`src/`, `base44/`, `config/`, smoke);
- scripts, CI e `.sql` soltos;
- objetos de banco em todas as migrations;
- convenção CONTRACT.

**Resultado: nenhuma referência viva lê ou grava as 4 colunas.** O que ainda cita os nomes:

| Onde | Classe | Efeito do DROP |
|---|---|---|
| `backend/prisma/schema.prisma` (4 linhas `@ignore`) | schema | saem nesta PR |
| `backend/src/modules/tiposTarefa/tipoTarefaRoutes.js` (`CHAVES_LEGADAS_IGNORADAS`) | compatibilidade HTTP | aceita e ignora as chaves no corpo, sem tocar o banco. **Fica** (D-PROD-181 item 2); tirar é decisão de contrato HTTP |
| `20261027190000_p5_grupo_tipo_tarefa_native/migration.sql` | histórico imutável | nenhum |
| `20261113100000_tipo_atividade_cadastro/migration.sql` | só comentário | nenhum |
| `backend/tests/tarefaCadastroNativo.test.mjs`, `tipoAtividadeNativo.test.mjs`, `tests/smoke/tiposAtividade.test.jsx`, `motorbase1Batch01.test.jsx`, `scripts/gates/gate-tarefa-cadastro-native.mjs` | provam a ausência | continuam verdes; nenhum faz SQL com as colunas |
| `docs/` | documentação | nenhum |

Outros pontos verificados, sem dependência:
- toda leitura de `TipoTarefa` usa `select` explícito;
- o único `findUnique` sem `select` (`syncEntityReferencesService.js`) usa a lista do client, que não tem as 4 colunas;
- o SQL cru de propagação só lê `id` e grava `grupo_atividade_nome`;
- a fila offline e o IndexedDB podem guardar chaves velhas, mas a porta filtra o corpo por allowlist;
- `preflight-schema` não exige as colunas;
- nenhuma migration cria índice, visão, função, gatilho, política, estatística ou publicação sobre elas;
- a política `maike_backend_all` da P8 não cita coluna.

## 3. A guarda (trava própria)

Primeira instrução da migration, com hash pinado. Falha fechada; qualquer recusa desfaz tudo.

1. `lock_timeout` 5 s, `statement_timeout` 120 s, `pg_advisory_xact_lock(72707369)`.
2. `TipoTarefa` existe e fica em `ACCESS EXCLUSIVE`.
3. As 4 colunas existem, cada uma `BOOLEAN NOT NULL DEFAULT false`. Se faltar alguma, a migration já rodou ou o schema está fora do esperado.
4. Nenhum objeto depende delas (`pg_depend`) além do próprio `DEFAULT` e, no PG 18, do próprio `NOT NULL`.
5. Nenhuma função ou procedure fora dos schemas do sistema cita as colunas no corpo ou nos parâmetros de saída, sem distinguir maiúsculas (`NEW.Exige_Area` sem aspas é a coluna `exige_area`).
6. Com algum `true` (ou com o parâmetro informado): `maike.tipo_tarefa_flags_impressao` = `left(md5(…), 12)` das linhas `cliente_id|id|4 flags` com algum `true`. Sem nenhum `true`, o parâmetro é dispensado.

Ensaiada à mão num PG 16 local, contra 2 clientes com flags `true`:

| Cenário | Resultado |
|---|---|
| sem impressão / impressão errada | recusa: `tipo_tarefa_drop_colunas: os valores true … não são os aprovados no GO` |
| índice, visão, CHECK, política, coluna gerada, estatística, publicação com lista de colunas | recusa: "objeto depende das colunas apagadas (…)" |
| função plpgsql citando a coluna; gatilho com `NEW.Exige_Area`; função com a coluna só no `RETURNS TABLE` | recusa: "função ou procedure cita as colunas apagadas" |
| função SQL `BEGIN ATOMIC` citando a coluna | recusa: "objeto depende das colunas apagadas (function …)" |
| coluna sem `DEFAULT` / tabela ausente | recusa: "tem 3 das 4 colunas" / "não existe" |
| publicação sem lista de colunas; índice em outra coluna | passa |
| impressão certa | aplica: 9 colunas, linhas intactas, `migrate diff` "No difference detected" |
| caminho B (envelope do runbook) | alvo de produção no texto → `alvo divergente`; impressão errada → recusa sem mudança; certa → aplica e registra o checksum; repetir → `migration já registrada`; `migrate status` em dia |
| caminho B depois de um A que falhou e foi revertido (`migrate resolve --rolled-back`) | aplica; a linha revertida fica, a nova tem o checksum do manifesto; `migrate status` em dia |

## 4. Sem janela de 500, mas sem rollback para antes da D-PROD-181

- O Prisma Client da `main` atual (com `@ignore`) foi gerado e rodado contra um banco **sem** as
  colunas: `create`, `findMany`, `update`, `include` e `delete` de `TipoTarefa` funcionaram.
  Aplicar antes do merge não derruba o runtime em produção.
- O client da `main` de **antes** do merge da PR #254 (`6b85696^1`) falhou com
  `P2022 TipoTarefa.exige_area`. Depois da aplicação, fica proibido o *Instant Rollback* de
  produção para antes de `6b85696`, e Previews de branch sem a D-PROD-181 dão 500 em Tipos de
  Tarefa. Isso está registrado no runbook (§0, §2, §9, §10).

## 5. Como foi feito

1. **Varredura.** Cinco agentes de leitura em paralelo e um crítico de completude (§2).
2. **Migration e portão.** A migration, a entrada CONTRACT e o rótulo foram escritos e ensaiados à mão num PG 16 local (§3).
3. **Testes.** Quatro agentes em paralelo, cada um dono dos seus arquivos e com um revisor adversarial próprio:
   - classificador;
   - runner;
   - migration de ponta a ponta com o ensaio;
   - ajuste do teste da D-PROD-162.
4. **Documentos.** Decisão, runbook, relatório e estado.
5. **Revisão adversarial final**, com três lentes independentes sobre o diff inteiro:
   - guarda em produção;
   - portão e testes;
   - documentos e operação.

O que mudou por causa das revisões:

| Achado | Correção |
|---|---|
| `alvo-banco.test.mjs` (AB-05) passou a falhar: com a pasta nova, a D-PROD-183 pendente recusava por conta própria | o histórico simulado tem as duas CONTRACT concluídas |
| a busca de rotinas da guarda não via `NEW.Exige_Area` (caixa mista) nem coluna só no `RETURNS TABLE` | `~*` sobre `prosrc` + `proargnames`; 2 cenários RED novos |
| no PG 18 o `NOT NULL` da coluna faria a guarda recusar sem motivo | o filtro ignora o `NOT NULL` da própria coluna (`contype = 'n'`); a versão do servidor entra no bloco A |
| job do pg_cron citando as colunas quebraria em silêncio | consulta no bloco C do preflight |
| a trava concorrente era provada pelo `lock_timeout` da URL, não pelo da guarda | o cenário roda sem `lock_timeout` na URL |
| faltava o caminho do runbook com a impressão do vazio informada | TD-06 |
| runbook: caminho A sem a conexão do runtime; envelope B bloqueado depois de um A revertido; §8 escrevia em produção sem GO; SQL de backup incompleto; `migrate resolve` sem conexão explícita | corrigidos; o envelope B depois de A revertido foi ensaiado |
| a PR #260 também usa D-PROD-183 | o número da decisão saiu do `migration.sql` (§7) |

## 6. Validação local (PostgreSQL 16 descartável)

PostgreSQL 16.15 local, banco recriado do zero antes de cada rodada, com as variáveis da CI (`AUTH_SECRET` e `FRONTEND_ORIGINS` descartáveis). Produção não foi tocada.

| Comando | Resultado |
|---|---|
| `npm run verify:all` (conteúdo do commit `4934870`) | **exit 0, todas as etapas** em 1515 s |
| ↳ `test:gates` | 808/808 |
| ↳ `test:backend` (todas as migrations aplicadas do zero pelo `deploy:migrate`, inclusive esta) | 1659 aprovados, 0 falhas, 5 `todo` (de 1664) |
| ↳ `test:smoke` | 2622/2622 (215 arquivos) |
| ↳ lint, `gate:types` (625, sem regressão), `typecheck:backend` (0), `gate:governance-paths`, `gate:tenancy`, `gate:indices`, `gate:deploy-migrations`, `gate:supabase-public-grants`, `gate:tarefa-cadastro-native`, build e build:admin | todos PASS |
| `node --test scripts/tests/deploy/{premerge-migrate,migrations,alvo-banco,preflight-schema}.test.mjs` | 83/83 |
| `backend/tests/tipoTarefaDropColunasMigration.test.mjs` | 15/15. Cobre: TD-01; 9 RED, cada um recusado com a mensagem própria e sem mudar nada; TD-02 (runner sem a decisão → `DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`); TD-03 GREEN pelo runner, 42/0, 9 colunas, linhas idênticas e `migrate diff` 0; TD-04 (2ª execução "No pending"); TD-05; TD-06 |
| `backend/tests/patrimonioSimplificaMigration.test.mjs` | 14/14, com a partida em 41 |
| `node scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs` | `ensaio D-PROD-183: OK` |
| Prisma Client da `main` atual contra banco sem as colunas | CRUD de `TipoTarefa` sem erro |
| Prisma Client de `6b85696^1` contra banco sem as colunas | `P2022 TipoTarefa.exige_area` (por isso a proibição de rollback) |

## 7. Riscos e limites conhecidos

- **Número de decisão em disputa.** A PR #260 (rascunho, Estoque P1-02, sem migration) também
  registrou uma D-PROD-183. Pela convenção, quem mergear depois renumera. Para isso nunca tocar
  o arquivo aplicado, o `migration.sql` não cita o número: as mensagens da guarda começam com
  `tipo_tarefa_drop_colunas:`. Se esta fatia tiver de virar D-PROD-184, mudam só `decisao` e
  `--contract` em `premergeMigrateLib.mjs`, os testes, o ensaio e os documentos.

- **Dados perdidos.** Os valores `true` das 4 colunas somem em todos os clientes. O runbook
  pede o preflight por cliente e a impressão aprovada no GO, mais a escolha do proprietário
  entre guardar a lista ou aceitar a perda (§4.4).
- **Duas CONTRACT pendentes.** Num alvo remoto **novo**, com as duas pendentes, o runner recusa
  sempre, porque `MIGRATION_CONTRACT_AUTORIZADO` tem um só valor. Em produção não acontece: a
  D-PROD-162 está concluída. Um ambiente remoto novo teria de aplicar uma delas pelo caminho B.
- **PostgreSQL 18.** No PG 18 o `NOT NULL` vira constraint dependente da coluna. A guarda
  ignora o da própria coluna, mas isso foi escrito pela documentação do 18 e **não foi ensaiado**
  num PG 18 (só há 16 aqui; produção está no 17). Se o banco subir para 18 antes da aplicação, o
  pior caso é a guarda recusar (falha fechada). O bloco A anota a versão.
- **Banco local com sobras.** Um banco de desenvolvimento com Tipo de Tarefa antigo com flag
  `true` faz o `deploy:migrate` local recusar sem a impressão. A dica do `test:backend` cita
  `tipo_tarefa_drop_colunas`; recriar o banco local resolve.
- **Contagens fixas nos testes.** Os testes das duas CONTRACT fixam 41/42 migrations concluídas.
  Qualquer migration nova vai exigir atualizar esses números (o mesmo desenho que já existia no
  teste da D-PROD-162).

## 8. Próximo passo

Parar aqui. Com o GO-1 do proprietário, o preflight só leitura dá as contagens por cliente e a
impressão. Com o GO-2, a aplicação segue o runbook e só depois vem o merge. A Fatia C
(`ApontamentoAtividade`) só começa depois disso, quando o proprietário liberar.
