# MAIKE — Estoque "Novo movimento" (motivos de entrada): runbook de release

> Decisão: [D-PROD-259](./DECISIONS.md). Relatório: [`MAIKE-ESTOQUE-NOVO-MOVIMENTO-REPORT.md`](./MAIKE-ESTOQUE-NOVO-MOVIMENTO-REPORT.md).

**Executado em produção em 2026-11-19** (preflight, envelope e postcheck), com o GO escrito do proprietário e a emenda da D-PROD-259 aprovada. Registro no relatório §3.

## 0. O que muda no banco

Migration `20261119200000_estoque_entradas_motivos`, modo **CONTRACT**, SHA-256 `ebb37b6886e71847c61eaab28e1c90a7c29069f6e3924055dfb65e7adf101c25`, pinada em `MIGRATIONS_APROVADAS` e com entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS` (guarda `a6db1e3e…a0b1`, 12 `alter_antigas` pinadas).

- **Guarda própria** (bloco `DO` no topo do `migration.sql`):
  - `lock_timeout` 5s e trava 72707369;
  - as 3 tabelas das Entradas existem, com `LOCK … ACCESS EXCLUSIVE`, e **têm de estar vazias** (senão `RAISE`);
  - `MotivoEntradaEstoque`, as colunas novas e as constraints novas não podem existir;
  - os CHECKs antigos têm de existir;
  - os alvos das FKs compostas têm de ter o UNIQUE exigido (`Fornecedor_cliente_id_id_key`, `CentroCusto_cliente_id_empresa_id_id_key`, `CentroResultado_cliente_id_empresa_id_id_key`).
- **Tabelas antigas (pinado):**
  - DROP do CHECK da justificativa;
  - CHECK do motivo recriado com `SALDO_IMPLANTACAO | ENTRADA`;
  - 5 colunas anuláveis: `fornecedor_id`, `centro_custo_id` e `centro_resultado_id` em `EntradaEstoque`; `lote_fabricante` e `data_validade` em `EntradaEstoqueItem`;
  - 3 FKs compostas RESTRICT;
  - CHECK "implantação sem fornecedor".
- **Resto, pela allowlist EXPAND:**
  - tabela `MotivoEntradaEstoque` com `cliente_id`, uniques e índices por `cliente_id`, 2 CHECKs, a FK do cliente e RLS de corpo aprovado;
  - `EntradaEstoque.motivo_id` com FK para ela;
  - 4 índices não-únicos.
- **Nada** é migrado nem semeado. Os motivos padrão nascem pelo backend na primeira leitura.

## 1. Caminho: B, uma transação com guardas

O mesmo caminho da `20261119100000` (aplicada em 2026-11-19 17:54:41 UTC): o envelope é aplicado pelo `execute_sql` do Supabase (projeto `uuemcasqcdjucflulkne`). Ele contém:

1. `BEGIN`, `SET LOCAL lock_timeout = '5s'`, `statement_timeout = '60s'`, `pg_advisory_xact_lock(72707369)`;
2. a guarda do envelope:
   - `system_identifier` = `7692130048193495360`;
   - a migration não registrada;
   - histórico **exato**: as 69 concluídas da base (as 68 da D-PROD-257 + `20261119100000_estoque_entradas`), nenhuma falhada ou revertida, nenhuma a mais;
   - `MotivoEntradaEstoque` ausente;
3. o `migration.sql` **integral e sem edição** (com a guarda própria dele);
4. o `INSERT` em `_prisma_migrations` com o checksum acima e `applied_steps_count = 1`;
5. `COMMIT`.

Qualquer `RAISE` desfaz tudo; nada fica pela metade.

O envelope é gerado a partir do repositório (o gerador é o mesmo da D-PROD-257, com o nome e a guarda de tabela trocados). **Ensaio local** em PostgreSQL 17 com as 69 migrations da base aplicadas pelo `prisma migrate deploy`:
- o envelope aplica;
- a segunda execução recusa com `RELEASE_BLOCKED: migration já registrada`;
- `prisma migrate status` diz *up to date* (70);
- `prisma migrate diff` contra o `schema.prisma` vem vazio.

**Proibido:** `npm run deploy:migrate` à mão, `release-migrate.yml`, editar o `migration.sql` dentro do envelope, mudar segredo ou variável de release.

## 2. GOs

| GO | O quê | Estado |
|---|---|---|
| Emenda | Aprovação explícita da emenda constitucional proposta na D-PROD-259 | **concedida** em 2026-11-19 ("Aprovo as duas") |
| GO-1 | Preflight **só leitura** (§3) | **concedido**; executado: tudo conforme |
| GO-2 | Aplicar o envelope (§1) e rodar o postcheck (§4) | **concedido**; aplicado às 19:33:14 UTC; postcheck conforme |

## 3. Preflight (somente leitura)

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())                                         AS sid,            -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,  -- 69
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)  AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261119100000_estoque_entradas' AND finished_at IS NOT NULL) AS entradas_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261119200000_estoque_entradas_motivos') AS motivos_registrada, -- 0
  to_regclass('public."MotivoEntradaEstoque"') IS NULL                                        AS motivo_ausente, -- true
  (SELECT count(*) FROM "EntradaEstoque")                                                     AS entradas,       -- 0
  (SELECT count(*) FROM "EntradaEstoqueItem")                                                 AS itens,          -- 0
  (SELECT count(*) FROM "EntradaEstoqueEvento")                                               AS eventos;        -- 0
```

Qualquer valor diferente do comentário: **PARAR**. Se alguém já lançou uma entrada em produção (`entradas > 0`), a guarda recusa. A decisão sobre o que fazer com esses lançamentos (excluir pela tela ou adaptar a migration) volta ao proprietário.

## 4. Postcheck (somente leitura)

| Conferência | Esperado |
|---|---|
| `_prisma_migrations` concluídas / falhadas | 70 / 0; a `20261119200000` com o checksum do §0 e 1 passo |
| tabelas em `public` (com `_prisma_migrations`) | 101 |
| `MotivoEntradaEstoque` | RLS ligado sem FORCE; política `maike_backend_all` só para `maike_vercel`; sem GRANT para `anon`/`authenticated`; 2 CHECKs, 1 FK, 4 índices válidos |
| `EntradaEstoque` | 5 CHECKs, 6 FKs, 10 índices válidos; colunas `motivo_id`, `fornecedor_id`, `centro_custo_id`, `centro_resultado_id` |
| `EntradaEstoqueItem` | 4 CHECKs, 7 FKs, 10 índices válidos; colunas `lote_fabricante`, `data_validade` |
| `get_advisors` (security) | nenhum alerta novo |
| site | `/api/native/health` ok; `GET /api/native/estoque/motivos-entrada` sem login → 401 |

## 5. Se der errado

- **`RAISE` na guarda:** nada foi aplicado. Ler a mensagem, rodar o preflight e voltar ao proprietário.
- **Erro depois do `COMMIT`** (postcheck diverge): não corrigir no SQL Editor. Parar e registrar no relatório. Uma correção é uma migration nova, com GO próprio.
- **Rollback** de uma CONTRACT aplicada: não há `down`. Desfazer é uma migration nova, com GO próprio.
