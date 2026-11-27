# MAIKE — Estoque na unidade do cadastro: runbook de release (D-PROD-371, UE-1)

> **Estado: PENDENTE.** `SCHEMA_APPLIED_PROD: NÃO`. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário. Ele para no primeiro desvio com **`RELEASE_BLOCKED`**.
> Valores entre `<…>` são preenchidos na hora, a partir de leituras reais.

Decisão: [D-PROD-371](./DECISIONS.md) · SPEC: [`MAIKE-ESTOQUE-UNIDADE-CADASTRO-SPEC.md`](./MAIKE-ESTOQUE-UNIDADE-CADASTRO-SPEC.md) ·
Relatório: [`MAIKE-ESTOQUE-UNIDADE-CADASTRO-UE1-REPORT.md`](./MAIKE-ESTOQUE-UNIDADE-CADASTRO-UE1-REPORT.md).
Molde: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md) e, para a
troca de um CHECK com o mesmo nome, o tipo do funcionário (D-PROD-209).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261127200000_estoque_unidade_cadastro` |
| Natureza | **CONTRACT condicionado, formato de sempre** (sem DROP TABLE, sem resto, sem DML). Os 6 CHECKs são recriados mais largos, com o mesmo nome: `ProdutoUnidadeConversao_sigla_check` (sai o `NOT IN ('KG','L','UN')`), `EntradaEstoqueItem_unidade_check`, `SaidaEstoqueItem_unidade_check` e `AjusteEstoqueItem_unidade_check` (sai o `<> 'UN'`), `OperacaoFinanceiraItem_forma_check` (a mercadoria sem o `<> 'UN'`; o serviço continua `= 'UN'`) e `AtividadeApontamentoProduto_valores_check` (`unidade IN ('L','KG')` vira unidade não vazia). Nenhuma coluna, tabela ou dado muda |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `f9719220fd738d6a522fa0c0967c77dcde0dd6fa498d9ef31744b2387878a77f` |
| Guarda (`MIGRATIONS_CONTRACT_APROVADAS`) | `8d78338bcd424a644f78ea2a2bc2e506a71af7c57b23c87cf60271224b7a9af7`. Os literais são as 6 tabelas, `UN` e `KG` |
| `_prisma_migrations` | esperado **83** concluídas e 0 abertas (a última `20261127100000_diario_maquina`, checksum `b1896a7c2d350fe31a313563f97192bd961db4c9b905b235bbecced90bfc0aeb`). Depois, **84**. Recontar no §2: `<a conferir>` |
| Tabelas em `public` | `<a conferir>` antes, o mesmo número depois (nenhuma tabela nova; o esperado pela soma dos runbooks é 115) |

**Por que antes do merge (D-PROD-72 item 1):** o código novo aceita estoque em UN e conversão em KG, L ou UN. Com os CHECKs
antigos, gravar essas linhas responderia 500. O runtime antigo continua igual com o banco migrado, porque os CHECKs só
ficaram mais largos. Por isso **não há janela**.

**Efeito durante a transação:** as 6 tabelas ficam em `ACCESS EXCLUSIVE` até o COMMIT. Os 6 `ADD CONSTRAINT … CHECK` varrem
as linhas uma vez, e todas já cumprem o CHECK mais largo. Para o volume de hoje, leva segundos. Uma espera além do
`lock_timeout` de 5 s aborta tudo. Fazer fora do horário de lançamento.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-371`,
  depois `--verificar-alvo` e `--aplicar`. Numa máquina protegida, com `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-371`.
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do proprietário
  para esta migration**, como nas anteriores.

## 2. Preflight — somente leitura

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())::text                                           AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 83
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261127100000_diario_maquina'
     AND checksum = 'b1896a7c2d350fe31a313563f97192bd961db4c9b905b235bbecced90bfc0aeb' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261127200000_estoque_unidade_cadastro') AS registrada, -- 0
  (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname IN ('ProdutoUnidadeConversao_sigla_check',
     'EntradaEstoqueItem_unidade_check', 'SaidaEstoqueItem_unidade_check', 'AjusteEstoqueItem_unidade_check')
     AND pg_get_constraintdef(oid) LIKE '%''UN''%')                                                  AS checks_com_un, -- 4
  (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname = 'OperacaoFinanceiraItem_forma_check'
     AND pg_get_constraintdef(oid) LIKE '%<> ''UN''%')                                                AS forma_antiga, -- 1
  (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname = 'AtividadeApontamentoProduto_valores_check'
     AND pg_get_constraintdef(oid) LIKE '%''KG''%')                                                   AS valores_antigo, -- 1
  (SELECT count(*) FROM "Produto" WHERE unidade_principal_estoque NOT IN ('KG', 'L', 'SACO'))         AS produtos_fora, -- <n> (legado; conferir com o dono)
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- <a conferir>
```

## 3. Caminho B — uma transação

O envelope tem o `migration.sql` integral entre marcadores e fica fora do repositório (no scratchpad da sessão que
aplicar). Forma:

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261127200000_estoque_unidade_cadastro') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 83 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261127100000_diario_maquina'
                    AND checksum = 'b1896a7c2d350fe31a313563f97192bd961db4c9b905b235bbecced90bfc0aeb'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261127100000_diario_maquina) não está concluída com o checksum do repositório';
  END IF;
END $envelope$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição (a guarda dele confere as 6 tabelas e
--     os 6 CHECKs no formato anterior, e trava as 6 tabelas) >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'f9719220fd738d6a522fa0c0967c77dcde0dd6fa498d9ef31744b2387878a77f', now(),
        '20261127200000_estoque_unidade_cadastro', NULL, NULL, now(), 1);
COMMIT;
```

Qualquer falha desfaz tudo. **Ensaio local:** relatório §4 (PostgreSQL 17 local: 83 → 84; rodar a guarda de novo depois
falha fechada com "os 6 CHECKs de unidade não estão no formato anterior").

## 4. Conferência — somente leitura

```sql
SELECT
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)              AS concluidas, -- 84
  (SELECT checksum FROM _prisma_migrations WHERE migration_name = '20261127200000_estoque_unidade_cadastro')      AS checksum,   -- f9719220…a77f
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                                    AS tabelas,    -- = §2
  (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname IN ('ProdutoUnidadeConversao_sigla_check',
     'EntradaEstoqueItem_unidade_check', 'SaidaEstoqueItem_unidade_check', 'AjusteEstoqueItem_unidade_check',
     'OperacaoFinanceiraItem_forma_check', 'AtividadeApontamentoProduto_valores_check'))                         AS checks,     -- 6
  (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname IN ('ProdutoUnidadeConversao_sigla_check',
     'EntradaEstoqueItem_unidade_check', 'SaidaEstoqueItem_unidade_check', 'AjusteEstoqueItem_unidade_check')
     AND pg_get_constraintdef(oid) LIKE '%''UN''%')                                                              AS ainda_com_un; -- 0
```

`get_advisors` (security): nenhum alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4.
2. Deploy READY.
3. Smoke:
   - `/api/native/produtos` sem sessão responde 401;
   - num produto de teste, escolher a Unidade de Medida SC do cadastro de Unidades: a aba "Estoque" mostra "0 SC";
   - na aba "Conversão de unidades", cadastrar KG que divide 25 e ver a prévia "1 KG = 0,04 SC";
   - fazer uma entrada de 500 KG a R$ 2: devem entrar 20 SC a R$ 50, e o movimento sai rotulado SC;
   - tentar o cocho com esse produto: deve recusar com a mensagem da unidade;
   - excluir a entrada (D-PROD-273) e o produto de teste.

## 6. Rollback

Reverter o código primeiro. O código antigo não grava as unidades novas, e os CHECKs mais largos não o afetam. Voltar os
CHECKs ao texto antigo só se nenhuma linha usar a unidade nova (UN na linha de estoque, KG/L/UN como conversão, unidade
fora de L/KG na linha de produto da atividade). Isso seria uma migration nova (CONTRACT, GO próprio), nunca uma edição desta.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | — |
| Caminho | — |
| GO | — |
| Preflight (§2) | — |
| Postcheck (§4) | — |
| Resultado | **PENDENTE** |
