# MAIKE — Estoque, controle de lote: runbook de release (D-PROD-281)

> **Estado: PENDENTE.** `SCHEMA_APPLIED_PROD: NÃO`. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de leituras reais.

Decisão: [D-PROD-281](./DECISIONS.md) · SPEC: [`MAIKE-ESTOQUE-CONTROLE-LOTE-SPEC.md`](./MAIKE-ESTOQUE-CONTROLE-LOTE-SPEC.md) ·
Relatório: [`MAIKE-ESTOQUE-CONTROLE-LOTE-REPORT.md`](./MAIKE-ESTOQUE-CONTROLE-LOTE-REPORT.md).
Anterior em produção: a EXPAND do produto do implemento (`20261124100000_tipo_implemento_produto`, D-PROD-279, PR #366),
aplicada: produção com **76** concluídas e 0 com falha, 111 tabelas; as colunas do controle de lote ainda não existem. Molde: [`MAIKE-ESTOQUE-AJUSTE-INVENTARIO-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-AJUSTE-INVENTARIO-RUNBOOK-RELEASE.md)
e, para a CONTRACT aditiva, a data de término do apontamento (D-PROD-265).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261124200000_estoque_controle_lote` |
| Natureza | **CONTRACT condicionado, ADITIVO**: em `Produto`, `controla_lote` e `controla_validade` BOOLEAN NOT NULL DEFAULT false e o CHECK `Produto_controla_validade_check` (validade só com lote); em `EstoqueLoteNota`, `lote_fabricante` VARCHAR(64) e `data_validade` DATE, anuláveis, sem DEFAULT; o índice não-único `EstoqueLoteNota_fefo_idx` (`cliente_id`, `empresa_id`, `produto_id`, `local_estoque_id`, `data_validade`). Nenhuma tabela criada ou apagada; nenhuma linha muda de valor; nenhum DROP ou DML. É CONTRACT só porque a allowlist EXPAND recusa em tabela antiga NOT NULL DEFAULT, DATE e CHECK |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `b6b33b0ebb35f44d91d7b3766525a51e839d68348aca78388fd26ab2645948fc` |
| Guarda (`MIGRATIONS_CONTRACT_APROVADAS`) | `98e741eef93fcd2931fdea5ae8838c24fd842b89e161df32a6e4b66621c588fc`, literais `Produto`, `EstoqueLoteNota` |
| `_prisma_migrations` | esperado **76** concluídas, 0 abertas (a última `20261124100000_tipo_implemento_produto`, checksum `a18362400ec4345487bca6bb4b6c94c62991cb120bb36786448a46c39a64ae45`); depois **77**. Recontar no §2 |
| Tabelas em `public` | **111** antes e depois |

**Por que antes do merge (D-PROD-72 item 1):** o motor de estoque novo lê `Produto.controla_lote` e grava
`lote_fabricante`/`data_validade`; sem as colunas, toda entrada e saída de estoque responde 500. O runtime antigo não
conhece as colunas e segue igual com o banco migrado (as colunas novas têm padrão) — **não há janela**.

**Efeito durante a transação:** `Produto` e `EstoqueLoteNota` ficam em `ACCESS EXCLUSIVE` até o COMMIT. `ADD COLUMN …
DEFAULT false` é metadado no Postgres 11+ (sem reescrever); o CHECK confere as linhas (todas `false`), e o índice
varre `EstoqueLoteNota` uma vez. Para o volume de hoje, segundos; uma espera além do `lock_timeout` de 5 s aborta tudo
sem aplicar nada. Fazer fora do horário de lançamento.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-281`
  (depois `--verificar-alvo` e `--aplicar`), numa máquina protegida, com `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-281`.
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do
  proprietário para esta migration**, como nas anteriores.

## 2. Preflight — somente leitura

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())::text                                           AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 76
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261124100000_tipo_implemento_produto'
     AND checksum = 'a18362400ec4345487bca6bb4b6c94c62991cb120bb36786448a46c39a64ae45' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261124200000_estoque_controle_lote') AS registrada, -- 0
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'Produto' AND column_name IN ('controla_lote', 'controla_validade'))
       OR (table_name = 'EstoqueLoteNota' AND column_name IN ('lote_fabricante', 'data_validade'))))  AS colunas_novas, -- 0
  (SELECT count(*) FROM "EstoqueLoteNota")                                                            AS camadas,     -- <n> (só para o tempo do índice)
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- 111
```

## 3. Caminho B — uma transação

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261124200000_estoque_controle_lote') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 76 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261124100000_tipo_implemento_produto'
                    AND checksum = 'a18362400ec4345487bca6bb4b6c94c62991cb120bb36786448a46c39a64ae45'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261124100000_tipo_implemento_produto) não está concluída com o checksum do repositório';
  END IF;
END $envelope$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição (a guarda dele confere as
--     colunas, o CHECK e o índice ausentes e trava as duas tabelas) >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'b6b33b0ebb35f44d91d7b3766525a51e839d68348aca78388fd26ab2645948fc', now(),
        '20261124200000_estoque_controle_lote', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no rascunho da sessão; confira o SHA-256
do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local:** registrado no relatório §5 (banco recriado, `migrate deploy` até a anterior, o envelope acima com o
`system_identifier` local no lugar do de produção, a conferência do §4, e a 2ª execução recusada pelo envelope).

## 4. Conferência — somente leitura

```sql
SELECT
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)        AS concluidas, -- 77
  (SELECT checksum FROM _prisma_migrations WHERE migration_name = '20261124200000_estoque_controle_lote')   AS checksum,   -- b6b33b0e…48fc
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                              AS tabelas,    -- 111
  (SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ', ' ORDER BY column_name)
     FROM information_schema.columns WHERE table_schema = 'public'
      AND ((table_name = 'Produto' AND column_name IN ('controla_lote', 'controla_validade'))
        OR (table_name = 'EstoqueLoteNota' AND column_name IN ('lote_fabricante', 'data_validade'))))     AS colunas,
  -- controla_lote:boolean:NO:false, controla_validade:boolean:NO:false, data_validade:date:YES:-, lote_fabricante:character varying:YES:-
  (SELECT count(*) FROM pg_constraint WHERE conname = 'Produto_controla_validade_check')                    AS check_ok,   -- 1
  (SELECT count(*) FROM pg_indexes WHERE indexname = 'EstoqueLoteNota_fefo_idx')                            AS indice_ok,  -- 1
  (SELECT count(*) FROM "Produto" WHERE controla_lote OR controla_validade)                                AS marcados;   -- 0
```

`get_advisors` (security): nenhum alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel. 3. Smoke: `/api/native/estoque/lotes-disponiveis` sem
sessão → 401; uma saída manual de um produto **sem** lote (custo médio, como antes); marcar um produto de teste com
saldo zero como "Controla lote", dar entrada com lote e validade, ver o detalhe por lote no Saldo e fazer uma saída
escolhendo o lote (o custo é o da entrada); excluir a saída (o lote volta). Nenhum produto é marcado por padrão.

## 6. Rollback

Com o código novo no ar, reverter o código primeiro. As colunas novas não são lidas pelo código antigo; deixá-las no
banco não tem efeito. Removê-las seria uma migration nova (CONTRACT, com GO próprio: DROP do índice, do CHECK e das 4
colunas), nunca editando esta.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | 2026-11-24 |
| Caminho | B — envelope `aplicar-controle-lote.sql` (sha256 `2c3491cd…cb90`) pelo MCP do Supabase, uma transação |
| GO | dono do produto ("Pode aplicar, publicar e fazer merge") e confirmação no Supabase |
| Preflight (§2) | 76 concluídas, 0 com falha, última `20261124100000_tipo_implemento_produto` |
| Postcheck (§4) | 77 concluídas; checksum `b6b33b0e…48fc`; `Produto.controla_lote`/`controla_validade` boolean NOT NULL default false; `EstoqueLoteNota.lote_fabricante` varchar / `data_validade` date anuláveis; CHECK `Produto_controla_validade_check` e índice `EstoqueLoteNota_fefo_idx` presentes; 0 produtos com lote; advisors de segurança: nenhum |
| Resultado | **APLICADA** |
