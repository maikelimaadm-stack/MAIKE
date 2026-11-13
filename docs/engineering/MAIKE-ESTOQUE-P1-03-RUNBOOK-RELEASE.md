# MAIKE — Estoque P1-03 (índices M7): runbook de release

> Decisão: [D-PROD-185](./DECISIONS.md). Relatório: [`MAIKE-ESTOQUE-P1-03-REPORT.md`](./MAIKE-ESTOQUE-P1-03-REPORT.md).
> Contrato: [`MAIKE-ESTOQUE-P1-CONTRATO.md`](./MAIKE-ESTOQUE-P1-CONTRATO.md) §2 M7, §6.5 e §7 (ordem com DDL: runbook → GO → ensaio local → runner oficial → postcheck → **só depois** o merge).

**Nada deste runbook foi executado em produção.** Cada passo remoto exige o GO correspondente do proprietário, escrito no chat. O merge **não** substitui GO nenhum.

## 0. O que muda no banco

Migration `20261113300000_estoque_p1_03_indices`, modo **EXPAND**, SHA-256 `13a60881dbcccfbbba31db57b8757b5828b9b8fd95baaf4268e6be078bf1336b`, pinada em `MIGRATIONS_APROVADAS`. São duas instruções, ambas `CREATE INDEX` comum, não-único, sem predicado:

| Índice | Tabela | Colunas | Para quê |
|---|---|---|---|
| `OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx` | `OperacaoIdempotente` | `cliente_id, tipo_operacao, createdAt` | LC-2: recibos de estoque por tipo dentro do intervalo (reconciliação) |
| `MovimentacaoEstoque_keyset_empresa_idx` | `MovimentacaoEstoque` | `cliente_id, empresa_id, data_movimentacao DESC, id DESC` | keyset da futura central de movimentos (P1-04) |

- **Sem** tabela, coluna, constraint, dado, função, gatilho, RLS, GRANT ou DROP.
- **Sem `CONCURRENTLY`.** O classificador não aceita, e o Prisma aplica a migration dentro de transação.
- **Trava:** cada `CREATE INDEX` toma `SHARE LOCK` na tabela durante o build. Leituras seguem normalmente. **Escritas** naquela tabela esperam o fim do build:
  - em `MovimentacaoEstoque`: lançamentos com estoque, abastecimentos, transferências, suplementação e saída do depósito;
  - em `OperacaoIdempotente`: **todo** comando idempotente, porque cada um grava o recibo.

## 1. Caminho

O caminho é o oficial da D-PROD-74, numa máquina protegida do operador:

```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                    # análise local: EXPAND, 1 migration nova
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo   # alvo, só leitura (GO-1)
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar          # aplica pelo runner oficial (GO-2)
```

- **Sem `--contract`**: a release é EXPAND.
- **Isolamento da D-PROD-183 (CONTRACT do `TipoTarefa`):**
  - já aplicada em produção (CURRENT-STATE, runbook da D-PROD-183 §11);
  - se o preflight mostrar que **não** está, PARAR. O runner recusaria (`CONTRACT_INESPERADO` / `DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`), e esta release não pode levar a CONTRACT junto.
- **Proibido:**
  - `npm run deploy:migrate` à mão;
  - `release-migrate.yml`;
  - SQL Editor com o DDL;
  - qualquer mudança de segredo ou variável de release.

## 2. GOs

| GO | O quê | Estado |
|---|---|---|
| GO-1 | Rodar em produção o preflight **só leitura** (§3) e o `--verificar-alvo` | **não concedido** |
| GO-2 | Aplicar a migration pelo runner oficial (§4), na janela escolhida, e depois mergear | **não concedido** |

## 3. Preflight (GO-1, somente leitura)

Arquivo: `scripts/ops/sql-editor/estoque-p1-03-preflight-indices-somente-leitura.sql`.
- É um único SELECT sobre catálogos, sem dado de negócio nem pessoal.
- Foi validado localmente numa transação READ ONLY pelo teste X5 de `backend/tests/estoqueP1M7Indices.test.mjs`.

| Linha | Esperado | Se não for |
|---|---|---|
| `indice.novos_ja_existem` | `0` | PARAR: alguém criou à mão; investigar antes de qualquer GO-2 |
| `indice.invalidos_nas_2_tabelas` | `0` | PARAR |
| `migration.concluidas` | `42` | PARAR e conferir com `--verificar-alvo` |
| `migration.inacabadas_ou_revertidas` | `0` | PARAR |
| `migration.contract_d_prod_183_aplicada` | `SIM` | PARAR (isolamento, §1) |
| `migration.p1_03_ja_registrada` | `0` | PARAR |
| `tabela.*.linhas_estimadas`, `tamanho_*` | — | Dimensiona o build (§3.1) |
| `atividade.*` | baixo / `0` | Escolher outra janela |

### 3.1 Duração esperada

A medida é **local** e não é estimativa de produção: PostgreSQL 17, 1 worker de manutenção, 1.000.000 de linhas sintéticas.

| Índice | Build local |
|---|---|
| keyset | 3,6 s |
| LC-2 | 1,7 s |

A conta do operador fica proporcional ao `linhas_estimadas` do preflight. Com dezenas de milhares de linhas, o build é de frações de segundo. Durante o build, as escritas da tabela esperam (§0).

**Não se inventa cardinalidade de produção.** O número vem do preflight.

## 4. Aplicação (GO-2)

1. A janela deve ter pouca escrita. Repetir as linhas `atividade.*` do preflight imediatamente antes.
2. `--verificar-alvo` e, sem pendência inesperada, `--aplicar` (§1).
3. Se o runner falhar: a migration roda em **uma** transação do Prisma, então nada fica pela metade. Ela fica `failed` em `_prisma_migrations`, e o caminho é o da D-PROD-74 (`migrate resolve --rolled-back` só com GO próprio).

## 5. Postcheck (só leitura, antes do merge)

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND indexname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx');
SELECT x.indisvalid, x.indisready, c.relname FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
WHERE c.relname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx');
SELECT migration_name, finished_at FROM public._prisma_migrations WHERE migration_name = '20261113300000_estoque_p1_03_indices';
```

Esperado:
- as duas definições iguais às do teste X1;
- `indisvalid` e `indisready` verdadeiros;
- a migration com `finished_at`.

Depois disso, o proprietário faz o merge manual.

## 6. Reversão

- **Índice não muda dado.** Se causar problema (por exemplo, custo de escrita inesperado), a reversão é `DROP INDEX` dos dois. Isso é DDL **destrutivo**, CONTRACT, fora do classificador EXPAND, e exige decisão e GO próprios.
- **Rollback de código:** este PR só acrescenta índices. O código anterior funciona com eles e sem eles, então não há janela de incompatibilidade.

## 7. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 (texto literal, data) | — |
| Preflight (linhas) | — |
| GO-2 (texto literal, data, janela) | — |
| `--aplicar` (saída) | — |
| Postcheck | — |
| Merge | — |
