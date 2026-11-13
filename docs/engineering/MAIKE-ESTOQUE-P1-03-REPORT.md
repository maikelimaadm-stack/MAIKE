# MAIKE-ESTOQUE-P1-03 — Índices M7 (EXPAND-ONLY) — Relatório

> Decisão: [D-PROD-185](./DECISIONS.md).
> Contrato: [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md) §2 M7, §6.3, §6.5 e §7.
> Runbook: [`MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md).

## 1. Identidade e escopo

| Item | Valor |
|---|---|
| Branch | `claude/maike-estoque-p1-03-indices`, a partir da `main` `af477975` |
| Base verificada | A `main` `1accb831` (merge da P1-02) teve CI `quality` SUCCESS (run 43477033828). A `af477975` (PR #262) é só documentação |
| PR | Uma só, em DRAFT. Não marcar ready, não mergear antes do GO-2 e do postcheck |
| Produção | **Intocada.** Nenhuma leitura nem escrita remota nesta missão |

**O que muda:**
- uma migration nova, EXPAND, só de índices;
- dois `@@index` no `schema.prisma`;
- o manifesto `MIGRATIONS_APROVADAS`;
- testes;
- o SQL de preflight, o runbook e este relatório.

**O que não muda:** rota, GET, serviço, frontend, permissão, consulta da reconciliação e contrato da P1-02.

## 2. Índices

| # | Índice | Definição | Consumidor real | Estado |
|---|---|---|---|---|
| LC-2 | `OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx` | `(cliente_id, tipo_operacao, createdAt)` | `recibosNosIntervalos` (`reconciliacaoEstoque.js:254`): `cliente_id = ? AND createdAt BETWEEN ini AND fim AND tipo_operacao = ANY(TIPOS_RECIBO)` (`:146`) | **Implementado** |
| Keyset | `MovimentacaoEstoque_keyset_empresa_idx` | `(cliente_id, empresa_id, data_movimentacao DESC, id DESC)` | A futura central de movimentos (P1-04, contrato §6.3): empresa obrigatória e cursor `(data_movimentacao, id)` DESC/DESC | **Implementado** (o consumidor nasce na P1-04) |
| R2-2 | Índice de expressão por produto no `AuditLog` | — | **Nenhum hoje** | **Não implementado**, ver §2.1 |

**Escolhas:**
- **Tenant primeiro (R10)** nos dois, e nenhum único.
- **Keyset DESC/DESC.** Bate com o texto do contrato e resolve o cursor no `Index Cond` com varredura para frente. Também foi medido um índice ASC lido de trás para frente: mesmo plano e mesmo custo.
- **`MovimentacaoEstoque_cliente_id_empresa_id_idx` vira prefixo redundante do keyset**, mas **fica**. Remover índice é DROP (CONTRACT), fora do EXPAND, e pede decisão própria.

### 2.1 R2-2: por que **não** foi criado

O contrato prevê um índice parcial de expressão por produto no `AuditLog` de `EstoqueLoteNota`. A regra da missão: localizar o predicado exato e **não** indexar uma chave que a consulta não usa.

**Fatos:**
- Nas leituras de evidência de exclusão (`lerBlocoExclusoes` `:684`, `lerEvidenciaExclusoes` `:718`), o produto **não** está no `WHERE` que vai ao índice.
- Elas leem blocos pelo índice `(cliente_id, entidade, entidade_id)`, com `LIMIT` **antes** do filtro.
- O produto é testado depois, sobre `COALESCE(d.ant ->> 'produto_id', d.nov ->> 'produto_id')` de colunas **derivadas** por `objeto()` (`:207`, um `CASE jsonb_typeof(...)`), não das colunas da tabela.
- Um índice de expressão sobre `dados_anteriores`/`dados_novos` nunca casa com essa expressão.
- **Medido localmente:**
  - com o candidato `(cliente_id, COALESCE(dados_anteriores->>'produto_id', dados_novos->>'produto_id')) WHERE entidade = 'EstoqueLoteNota'` criado;
  - e 300.000 linhas sintéticas;
  - o plano da consulta real continua `Index Only Scan` no índice existente, e o candidato **não é usado**.

**Conclusão:** criar o índice agora só aumentaria o custo de escrita do `AuditLog`, a tabela mais escrita do sistema, sem leitura que o use.
- O R2-2 só fecha **junto** com a reescrita da busca de evidência por produto: predicado no `WHERE`, sobre as colunas da tabela, antes do `LIMIT`.
- Essa reescrita é mudança de consulta da reconciliação, fora do "só índices" da P1-03.

**M7 fica INCOMPLETO** neste item, por bloqueio motivado. Isso **não** veio de limitação do classificador: ele aceitaria a forma.

## 3. Migration e manifesto

- `backend/prisma/migrations/20261113300000_estoque_p1_03_indices/migration.sql`:
  - SHA-256 `5d91e751e4e924f94154ddaad603203e0d21ebc0e84fd242c6a2108ea6d28565`;
  - gerado por `prisma migrate diff` (schema antes → depois), com cabeçalho de comentário.
- **Sem número de decisão dentro do `.sql`** (lição da D-PROD-183): renumerar a decisão nunca muda o checksum.
- **Classificador** (`classificarMigrations`): `ok`, modo `EXPAND`, sem tabela nova, sem violação.
- **`MIGRATIONS_APROVADAS`:** a entrada foi acrescentada com o SHA.
- **Ensaios históricos das CONTRACT** (D-PROD-162 e D-PROD-183, `scripts/dev/ensaio-*.mjs` e os testes `patrimonioSimplificaMigration` e `tipoTarefaDropColunasMigration`):
  - fixavam "41 migrations da main" e "42 concluídas";
  - agora a partida é TODAS menos a CONTRACT, e o GREEN é TODAS, contadas da pasta (`TOTAL_MIGRATIONS`, `MIGRATIONS_PARTIDA`);
  - a migration nova (43ª) não muda o que eles provam, e a próxima também não quebra;
  - 15/15 e 14/14.

## 4. Testes

`backend/tests/estoqueP1M7Indices.test.mjs`, em PostgreSQL 17 local com `connection_limit=3`:

| Teste | O que prova | RED (banco sem a migration) | GREEN |
|---|---|---|---|
| X1 | Definição **exata** de cada índice em `pg_indexes`; não-único; sem predicado nem expressão; `cliente_id` primeiro; nenhum índice duplicado (mesmas colunas, ASC/DESC, expressão e predicado) nas duas tabelas | falha | passa |
| X2 | Keyset: 12 movimentos em 3 instantes (empates), 2 empresas e 2 tenants. Páginas de 1, 3, 5, 12 e 50 encadeadas pelo cursor exclusivo = a lista ordenada inteira, sem repetida nem perdida. Nada de outra empresa ou tenant | passa (a semântica independe do índice) | passa |
| X3 | Com sort, seqscan e bitmap desligados, o plano é `Index Scan` **Forward** no índice keyset, com `ROW(data_movimentacao, id) <` no `Index Cond` e **sem nó de Sort** | falha | passa |
| X4 | LC-2 com 3.000 recibos de outros tipos e 20 dos tipos lidos, **sem forçar o plano**: o planejador escolhe o índice novo, com o tipo e o intervalo no `Index Cond` e **0** linhas descartadas. Sem ele (`DROP INDEX` em transação desfeita): o mesmo resultado, 3.000 descartadas, Seq Scan e 129 contra 5 buffers | falha | passa |
| X5 | O preflight roda numa transação READ ONLY, vê os 2 índices e a migration registrada, 0 inacabadas e 0 inválidos | falha | passa |

Regressão local, 129/129 no banco migrado:
- `estoqueP0*`;
- `estoqueP1M6Replay` (replay e B-03);
- `estoqueP1PrecheckEstornosSql`;
- `gestaoP3Rodada2`;
- `patrimonioP1AbastecimentosConcorrencia`.

**Migrations no banco local novo:** `migrate deploy` aplicou 42 e depois a 43ª. Uma 2ª execução não teve pendência. `migrate diff --exit-code` entre o banco e o schema deu 0, ou seja, sem drift.

## 5. Medidas locais (EXPLAIN ANALYZE, cache quente)

Ambiente das medidas:
- PostgreSQL 17 local, 1 worker, sem paralelismo;
- réplicas `LIKE … INCLUDING ALL` das tabelas reais, sem FK, num schema descartável;
- dados **sintéticos**.

Não é extrapolação para produção.

| Consulta | Volume | Sem o índice novo | Com o índice novo |
|---|---|---|---|
| Keyset, página de 50 com cursor no meio | 500.000 movimentos, 20 tenants × 5 empresas, 2.000 instantes | Index Scan Backward em `(cliente_id, data_movimentacao)` + Incremental Sort: lê 251 linhas, 254 buffers, 0,38 ms | Index Only Scan: 50 linhas, 54 buffers, 0,08 ms |
| LC-2, intervalo de 6 h, 2 tipos | 400.000 recibos, 30 tipos (2 lidos) | Bitmap em `(cliente_id, createdAt)`: 1.081 lidas, **972 descartadas**, 402 buffers, 0,67 ms | Bitmap no índice novo: 109 lidas, 0 descartadas, 83 buffers, 0,15 ms |

**Tamanho:**
- índice keyset: 48 MB para 500.000 linhas, com `id` de 32 caracteres;
- índice LC-2: 28 MB para 400.000.

**Build local**, 1.000.000 de linhas, 1 worker: keyset 3,6 s; LC-2 1,7 s.

## 6. D-PROD-183 (CONTRACT do TipoTarefa) e isolamento

- Já aplicada em produção (CURRENT-STATE e runbook da D-PROD-183 §11).
- Esta release é EXPAND e roda **sem** `--contract`.
- Se o preflight mostrar a CONTRACT pendente, PARAR. O runner recusaria misturar (`CONTRACT_INESPERADO` / `CONTRACT_NAO_ISOLADO`), e o runbook também manda parar.
- A migration da D-PROD-183 não foi tocada.

## 7. Riscos

1. **Trava do build:** `SHARE LOCK` sem `CONCURRENTLY`, numa transação só.
   - Escritas em `OperacaoIdempotente` (todos os recibos, de qualquer módulo) e em `MovimentacaoEstoque` esperam até o **COMMIT da migration**: os dois builds somados, mais a espera pela trava da 2ª tabela.
   - A ordem recibos → movimentos é a mesma dos comandos, então não há ciclo de espera (runbook §0).
   - Mitigação: janela de pouca escrita e transações abertas medidas no preflight (runbook §3.1 e §4).
   - Achado da revisão crítica, corrigido no texto da migration, do runbook e do preflight. A troca de ordem sugerida pelo revisor foi recusada, porque criaria risco de deadlock.
2. **Custo de escrita:**
   - cada movimento passa a atualizar mais um índice de 4 colunas;
   - cada recibo, mais um de 3 colunas.
   
   Aceitável para o ganho medido. O `AuditLog` não ganhou índice, de propósito (§2.1).
3. **Índice redundante:** `(cliente_id, empresa_id)` em `MovimentacaoEstoque`. Remoção só com decisão CONTRACT própria.
4. **Keyset sem consumidor até a P1-04.** O contrato manda o índice antes da central, e o teste X2/X3 fixa a semântica que a P1-04 tem de usar.
5. **I2 (P1-02) continua pendente** de decisão do proprietário. Não foi misturado nesta PR.

## 8. Bandeiras

```
CODE_READY=depende da CI full verde no HEAD final (ver PR e resposta final)
MERGE_READY=NÃO   (a ordem com DDL é GO-1 → GO-2 → aplicação → postcheck → merge)
RELEASE_READY=NÃO (GO-1 e GO-2 não concedidos)
SCHEMA_APPLIED_LOCAL=SIM (PG17 local: migrate deploy + diff sem drift)
SCHEMA_APPLIED_PRODUCAO=NÃO
DB_WRITES_PRODUCAO=0
GO_PENDENTE=GO-1 (preflight só leitura + --verificar-alvo) e GO-2 (--aplicar + merge)
M7=INCOMPLETO (R2-2 bloqueado por falta de consumidor; §2.1)
```
