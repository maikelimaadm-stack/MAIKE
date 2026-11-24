# MAIKE — Produto, unidades de conversão: runbook de release (D-PROD-288)

> **Estado: PENDENTE.** `SCHEMA_APPLIED_PROD: NÃO`. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de leituras reais.

>
> Integrada a `main` com a PR #370 (`20261125100000_insumo_por_jato`, D-PROD-283, aplicada em produção: 78/0); a migration foi renomeada para depois dela (o checksum não mudou: o nome não está no arquivo).

Decisão: [D-PROD-288](./DECISIONS.md) · SPEC: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md) ·
Relatório: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-REPORT.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-REPORT.md).
Molde: [`MAIKE-ESTOQUE-CONTROLE-LOTE-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-CONTROLE-LOTE-RUNBOOK-RELEASE.md) e, para o formato
CONVERSÃO sem DROP, as áreas da atividade (D-PROD-249).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261125200000_produto_unidades_conversao` |
| Natureza | **CONTRACT condicionado, formato CONVERSÃO sem DROP**: 5 CHECKs de unidade recriados mais largos (`EntradaEstoqueItem_unidade_check`, `SaidaEstoqueItem_unidade_check`, `AjusteEstoqueItem_unidade_check`, `OperacaoFinanceiraItem_unidade_check`, `OperacaoFinanceiraItem_forma_check`); tabela nova `ProdutoUnidadeConversao` (CHECKs, FKs, único parcial, RLS); `CADFORMULACAO.consumo_minimo_pv`/`consumo_maximo_pv` DECIMAL(14,6) anuláveis; cópia pinada: `INSERT … SELECT` da conversão SACO (multiplica pelo `peso_por_saco_kg`, produtos não-L com peso > 0) e `UPDATE` do consumo mínimo/máximo da formulação a partir do produto dela. Nenhum DROP de tabela ou coluna |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `779347bf9780ecb391dc76e64048601e6adcad449b5b868a44811def12be863b` |
| Guarda (`MIGRATIONS_CONTRACT_APROVADAS`) | `86df7d20db22e4ae2596dba4c29788fa60537d41e6e4cfa35d68171266fd0ff8`, literais `Produto`, `CADFORMULACAO`, `EntradaEstoqueItem`, `SaidaEstoqueItem`, `AjusteEstoqueItem`, `OperacaoFinanceiraItem` |
| RLS (`DO_RLS_APROVADOS`) | `6518df2877f62ef12dac0f111dbe514254272d7086e8c3d252be96fd66a683af` |
| `_prisma_migrations` | esperado **78** concluídas, 0 abertas (a última `20261125100000_insumo_por_jato`, checksum `725a8c5ac873ad19d0c191cd7c2f303dc84ef97170b74c0bb2133479c76d3551`); depois **79**. Recontar no §2 |
| Tabelas em `public` | **111** antes, **112** depois |

**Por que antes do merge (D-PROD-72 item 1):** o cadastro de produto e as entradas/saídas/ajustes/financeiro leem
`ProdutoUnidadeConversao`; sem a tabela, respondem 500. O runtime antigo não lê a tabela nova e continua igual com o banco
migrado (os CHECKs só ficaram mais largos) — **não há janela**.

**Efeito durante a transação:** as 6 tabelas ficam em `ACCESS EXCLUSIVE` até o COMMIT; os 5 `ADD CONSTRAINT … CHECK`
varrem as linhas de lançamento uma vez (todas já cumprem o CHECK mais largo). Para o volume de hoje, segundos; espera além
do `lock_timeout` de 5 s aborta tudo. Fazer fora do horário de lançamento.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-288`
  (depois `--verificar-alvo` e `--aplicar`), numa máquina protegida, com `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-288`.
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do proprietário
  para esta migration**, como nas anteriores.

## 2. Preflight — somente leitura

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())::text                                           AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 78
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261125100000_insumo_por_jato'
     AND checksum = '725a8c5ac873ad19d0c191cd7c2f303dc84ef97170b74c0bb2133479c76d3551' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261125200000_produto_unidades_conversao') AS registrada, -- 0
  (SELECT to_regclass('public."ProdutoUnidadeConversao"') IS NULL)                                    AS tabela_ausente, -- true
  (SELECT count(*) FROM "Produto" WHERE peso_por_saco_kg > 0 AND unidade_principal_estoque <> 'L')     AS sacos_a_copiar, -- <n>
  (SELECT count(*) FROM "Produto" WHERE peso_por_saco_kg > 0 AND unidade_principal_estoque = 'L')      AS sacos_em_litros, -- <n> (não copiados; conferir com o dono)
  (SELECT count(*) FROM "CADFORMULACAO" f JOIN "Produto" p ON p.cliente_id = f.cliente_id AND p.id = f.produto_id
     WHERE p.consumo_minimo_pv IS NOT NULL OR p.consumo_maximo_pv IS NOT NULL)                         AS formulacoes_a_copiar, -- <n>
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- 111
```

## 3. Caminho B — uma transação

O envelope pronto, com o `migration.sql` integral entre marcadores, fica fora do repositório:
`/tmp/claude-0/-home-user-MAIKE/27578f93-c0bb-5a9e-bc93-81a4694dbf4f/scratchpad/aplicar-unidades-conversao.sql`
(sha256 do arquivo `c81690992d80636310eb7bb04177fb39e7eaedfed4f33b5a7f205d65be8241aa`; o trecho entre os marcadores tem o
sha256 da migration, `779347bf…863b`). Forma:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(72707369);
DO $envelope$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261125200000_produto_unidades_conversao') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 78 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261125100000_insumo_por_jato'
                    AND checksum = '725a8c5ac873ad19d0c191cd7c2f303dc84ef97170b74c0bb2133479c76d3551'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261125100000_insumo_por_jato) não está concluída com o checksum do repositório';
  END IF;
END $envelope$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição (a guarda dele confere a tabela
--     e as colunas ausentes e os 5 CHECKs presentes, e trava as 6 tabelas) >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '779347bf9780ecb391dc76e64048601e6adcad449b5b868a44811def12be863b', now(),
        '20261125200000_produto_unidades_conversao', NULL, NULL, now(), 1);
COMMIT;
```

Qualquer falha desfaz tudo. **Ensaio local:** relatório §5.

## 4. Conferência — somente leitura

```sql
SELECT
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)              AS concluidas, -- 79
  (SELECT checksum FROM _prisma_migrations WHERE migration_name = '20261125200000_produto_unidades_conversao')    AS checksum,   -- 779347bf…863b
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                                    AS tabelas,    -- 112
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'ProdutoUnidadeConversao')                                 AS rls,        -- true
  (SELECT count(*) FROM pg_constraint WHERE conname IN ('EntradaEstoqueItem_unidade_check', 'SaidaEstoqueItem_unidade_check',
     'AjusteEstoqueItem_unidade_check', 'OperacaoFinanceiraItem_unidade_check', 'OperacaoFinanceiraItem_forma_check',
     'ProdutoUnidadeConversao_operacao_check', 'ProdutoUnidadeConversao_sigla_check', 'ProdutoUnidadeConversao_uso_check')) AS checks, -- 8
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'ProdutoUnidadeConversao_sigla_key')                         AS unico,      -- 1
  (SELECT count(*) FROM "ProdutoUnidadeConversao" WHERE sigla = 'SACO')                                           AS sacos,      -- = sacos_a_copiar do §2
  (SELECT count(*) FROM "CADFORMULACAO" WHERE consumo_minimo_pv IS NOT NULL OR consumo_maximo_pv IS NOT NULL)     AS formulacoes; -- = formulacoes_a_copiar do §2
```

`get_advisors` (security): nenhum alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY. 3. Smoke: `/api/native/produtos` sem sessão → 401; abrir um produto
com peso por saco e ver a unidade SACO na aba Unidades ("1 SACO = 25 KG"); uma entrada em SACO de um produto de teste
(quantidade de estoque = sacos × peso, custo por kg = custo do saco ÷ peso); uma saída em KG do mesmo produto (custo médio,
como antes); excluir as duas (D-PROD-273).

## 6. Rollback

Reverter o código primeiro: o código antigo não lê a tabela nova e os CHECKs mais largos não o afetam. Voltar os CHECKs
ao texto antigo só se nenhuma linha usar sigla de conversão; apagar a tabela e as 2 colunas seria uma migration nova
(CONTRACT, GO próprio), nunca editando esta.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | — |
| Caminho | — |
| GO | — |
| Preflight (§2) | — |
| Postcheck (§4) | — |
| Resultado | **PENDENTE** |
