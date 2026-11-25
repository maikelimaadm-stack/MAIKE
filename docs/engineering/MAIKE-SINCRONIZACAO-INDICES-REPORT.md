# Relatório — Índices da sincronização incremental (D-PROD-315)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-315](./DECISIONS.md) ·
**Runbook:** [`MAIKE-SINCRONIZACAO-INDICES-RUNBOOK-RELEASE.md`](./MAIKE-SINCRONIZACAO-INDICES-RUNBOOK-RELEASE.md)

## Por quê

A Etapa 2 da sincronização (D-PROD-309) fez o aparelho pedir só o que mudou (`GET /…/mudancas?desde=`). A revisão daquela
etapa apontou que as consultas não tinham índice próprio. A migration ficou para esta missão, porque o projeto pina a
ordem e a contagem das migrations e as libera em produção uma a uma. Sem índice, com milhões de registros, cada
sincronização leria toda a tabela do cliente.

## O que muda

Migration EXPAND `20261126300000_sincronizacao_incremental_indices`, só com `CREATE INDEX` não-único, tenant primeiro:

| Tabela | Índice | Consulta |
|---|---|---|
| `Lote` | `(cliente_id, updatedAt, id)` | `/lotes/mudancas` |
| `PontoSuplementacao` | `(cliente_id, updatedAt, id)` | `/pontos-suplementacao/mudancas` |
| `LEITURACOCHO` | `(cliente_id, updatedAt, id)` | `/leituras-cocho/mudancas` |
| `SuplementacaoEvento` | `(cliente_id, updatedAt, id)` | `/suplementacao-eventos/mudancas` |
| `AuditLog` | `(cliente_id, entidade, acao, createdAt, id)` | as exclusões do período, nas 4 rotas |

O `schema.prisma` ganhou os 5 `@@index`, cada um marcado com `// MAIKE-SINCRONIZACAO-INDICES`. O `prisma migrate diff`
das migrations contra o schema dá vazio. Nenhum código de aplicação muda.

## Governança da migration

- Manifesto (`premergeMigrateLib.mjs`): checksum `a1cdcd2f…fc3c`.
- `premerge-migrate.test.mjs`:
  - a contagem das pastas passou de 81 para 82 e as posições no manifesto subiram uma;
  - o B46c filtra o "dia" da unidade convertida;
  - novos B47a (classificada sozinha: EXPAND puro, os 5 índices na ordem das travas, sem UNIQUE/DML, checksum, a última do manifesto), B47b (UNIQUE ou DML recusados; byte diferente diverge) e B47c (ordem de produção: 81 concluídas, a única pendente é esta; depois, 82).
- Ensaios de migration (`ensaio-categoria-manejo-cadcategoria`, `ensaio-patrimonio-simplifica`, `estoqueEntradasMotivosMigration`): a nova entra na lista das posteriores à partida; as contagens sobem uma.
- `diaDaD223.mjs`: `schemaSemIndicesDaSincronizacao` tira os 5 `@@index` dos espelhos antigos.
- Preflight de schema do deploy: sem mudança. O código funciona sem os índices.

## Travas em produção

O Prisma aplica o arquivo numa transação só. Cada `CREATE INDEX` toma `SHARE LOCK` até o `COMMIT`: as leituras seguem, e
as escritas nas 5 tabelas esperam. A ordem é domínio primeiro e `AuditLog` por último, a mesma dos comandos. O preflight
só de leitura em produção (2026-11-25) mostrou `AuditLog` com 1.303 linhas e as outras com menos de 100, então a
construção leva milissegundos. Mesmo assim, a aplicação deve ser feita fora do horário de lançamento.

## Testes

- `backend/tests/sincronizacaoIncremental.test.mjs` MU-09: com `enable_seqscan = off`, o `EXPLAIN` das 5 consultas usa os índices novos.
- `scripts/tests/deploy/premerge-migrate.test.mjs`: 227 de 227.
- Suítes de migration do backend (`*Migration*.test.mjs` e as que usam os espelhos e os ensaios): 230 de 230. O retrato estrutural do Patrimônio (`ensaio-patrimonio-simplifica`) passou a desconsiderar os 5 índices, que sobem no GREEN, como já fazia com as colunas posteriores.
- Gates: os 30 e `typecheck:backend`.

## Produção

Aplicada em 2026-11-25 pelo caminho B, com o GO do proprietário ("Pode aplicar por favor"), antes do merge. A pós-checagem deu 82 concluídas e 0 ruins, a nova com o checksum pinado e os 5 índices válidos e não únicos (runbook §7).
