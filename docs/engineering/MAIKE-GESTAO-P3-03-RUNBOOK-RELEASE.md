# MAIKE — Gestão P3-03: runbook de release expand-only (D-PROD-157)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
> Nada da P3-03 foi enviado ao Supabase de produção nem à Vercel. A migration só
> rodou em PostgreSQL local de teste. Cada passo exige o GO específico do
> proprietário e para no primeiro desvio com **`RELEASE_BLOCKED`**.

Decisão: [D-PROD-157](./DECISIONS.md). Relatório:
[`MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md`](./MAIKE-GESTAO-P3-03-EDITAR-EXCLUIR-DUPLICAR-REPORT.md).
Modelo seguido: [runbook da P3-02](./MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md), executado em 2026-11-09 às 17:42:13 UTC.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261109300000_gestao_p3_03_editar_excluir` |
| Natureza | expand-only, sem backfill e sem constraint nem índice em tabela antiga. Acrescenta: duas colunas **anuláveis e sem DEFAULT** em `OperacaoFinanceira` (`excluido_em`, `retificado_em`); uma tabela nova `OperacaoFinanceiraEvento` com o histórico de retificação e exclusão (FKs compostas, CHECKs, uniques, índices e snapshot da versão anterior); um bloco DO de RLS e REVOKE |
| SHA-256 / DO pinados | ver §11 e `MIGRATIONS_APROVADAS` / `DO_RLS_APROVADOS` no HEAD aprovado |
| `_prisma_migrations` | antes **36** concluídas (a última é `20261109200000_gestao_p3_02_rateio_por_item`); depois **37** |

**Por que a migration vem antes do merge:** a Vercel publica a `main` sozinha. O
runtime novo lê `excluido_em`, `retificado_em` e a tabela nova em toda listagem
e todo detalhe; sem elas, responderia 500. O runtime atual (P3-02) ignora as
colunas anuláveis e a tabela nova, então o banco migrado continua a atendê-lo.

**Se o runtime voltar ao da P3-02 depois de existir retificação ou exclusão:**
- o documento excluído e a versão substituída são `CANCELADO` com motivo, então o
  runtime antigo os mostra como cancelados;
- a versão substituída aparece com o número `<n>/r<v>`;
- nada se perde e nada fica errado;
- a lista antiga só não esconde esses documentos.

## 1. Caminho
- **Padrão (D-PROD-74):** runner oficial `premerge-migrate.mjs --sha <SHA_APROVADO>`,
  primeiro com `--verificar-alvo` e depois com `--aplicar`, numa máquina protegida.
- **Caminho B:** conector Supabase em uma transação, só com GO escrito que cite
  esta migration, este alvo e o desvio da D-PROD-74.

## 2. Pré-requisitos do GO
1. PR da P3-03 aprovada e CI verde no `<SHA_APROVADO>`.
2. GO escrito, específico para esta migration.
3. Backup comprovado: último `COMPLETED` anterior à janela (o PITR estava desligado em 2026-11-09).
4. Nenhuma outra migration na janela. Nenhuma escrita de teste na Preview, que usa o banco de produção.

## 3. Ordem
GO → preflight só leitura (§4) → ensaio local com o arquivo do SHA → migration (§5)
→ conferência (§6) → registro (§11) → merge manual → deploy → smoke (§8).

## 4. Preflight (somente leitura)
- `system_identifier` = `7692130048193495360`; PostgreSQL 17.x.
- Histórico:
  - exatamente **36** concluídas e 0 com falha;
  - a última é a P3-02 (`df4d1ab2…`), e a P3-03 está ausente;
  - `conferirHistoricoRemoto` (36 linhas × arquivos do SHA) → `ok: true`, com a P3-03 como única pendente;
  - recontar a `main` no GO.
- `OperacaoFinanceiraEvento` ausente; `OperacaoFinanceira.excluido_em` e `.retificado_em` ausentes.
- SHA-256 do arquivo no SHA aprovado igual ao manifesto.
- Classificador (`premerge-migrate.mjs --sha`): `expand: true`, com 0 violações.
- Backup `COMPLETED` anterior à janela, pela API de gestão do Supabase ou pelo painel.
- Ensaio local imediato em PG17, com `anon`, `authenticated` e `maike_vercel`:
  - o SQL do §5 com o identificador de produção é recusado;
  - com o identificador local, chega ao `COMMIT` com 37 migrations e `migrate diff` 0;
  - repetir a transação é recusado;
  - o rollback do §9.1 funciona.

## 5. Aplicação (uma transação)

### Caminho A
```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
```

### Caminho B (conector, uma chamada `execute_sql`, só com GO escrito específico)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);  -- a mesma trava do prisma migrate (D-PROD-75)
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations
              WHERE migration_name = '20261109300000_gestao_p3_03_editar_excluir') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 36 OR n_ruim <> 0 THEN   -- 36 = recontagem do §4
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261109200000_gestao_p3_02_rateio_por_item'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: P3-02 ausente';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relname = 'OperacaoFinanceiraEvento') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela nova já existe';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'OperacaoFinanceira'
                AND column_name IN ('excluido_em', 'retificado_em')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: coluna nova já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '<SHA256_CALCULADO_NO_4>', now(),
        '20261109300000_gestao_p3_03_editar_excluir', NULL, NULL, now(), 1);
COMMIT;
```

## 6. Conferência pós-aplicação (somente leitura)

| # | Conferência | Esperado |
|---|---|---|
| 1 | `_prisma_migrations` | **37** concluídas e 0 com falha; a P3-03 tem o checksum do §4 e `applied_steps_count = 1` |
| 2 | Colunas novas | `excluido_em` e `retificado_em` em `timestamp(3)`, anuláveis, sem default; todas as linhas NULL |
| 3 | Tabela `OperacaoFinanceiraEvento` | colunas, FKs, CHECKs, uniques e índices como no arquivo (contagens no §11 do ensaio); RLS ligado sem FORCE; 1 política `maike_backend_all` para `{maike_vercel}`; 0 grants a `anon`, `authenticated` e `PUBLIC` |
| 4 | Contagens | tabela nova com 0 linhas; contagens de `OperacaoFinanceira`, `TituloFinanceiro` e `MovimentacaoEstoque` iguais às de antes |
| 5 | Advisor de segurança | nenhum alerta novo |
| 6 | Runtime no ar | health 200; logs sem erro novo por 30 min |
| 7 | Impressão digital | md5 das colunas, constraints, índices, política e RLS **idêntico** ao do ensaio local |

## 7. Merge manual
Só com o §6 conferido. O merge é do proprietário. O registro do §11 entra por
commit de documentação na própria PR, e a CI precisa ficar verde de novo.

## 8. Deploy e smoke (só leitura)
1. Health 200.
2. A lista padrão continua igual à de antes.
3. O filtro "Excluídos" abre vazio.
4. O detalhe de um documento existente mostra `eventos: []`.
5. Logs sem 500 em 30 min.

Nenhuma retificação ou exclusão de teste em produção: o primeiro uso é real e do
proprietário.

## 9. Rollback

### 9.1 Antes do merge (tabela nova vazia e colunas todas NULL)
```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM "OperacaoFinanceiraEvento") THEN
    RAISE EXCEPTION 'tabela nova com linhas: isto não é rollback de schema vazio';
  END IF;
  IF EXISTS (SELECT 1 FROM "OperacaoFinanceira" WHERE excluido_em IS NOT NULL OR retificado_em IS NOT NULL) THEN
    RAISE EXCEPTION 'colunas novas já gravadas: o runtime novo já rodou';
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE migration_name = '20261109300000_gestao_p3_03_editar_excluir') <> 1 THEN
    RAISE EXCEPTION 'registro da migration ausente ou duplicado';
  END IF;
END $guarda$;
DROP TABLE "OperacaoFinanceiraEvento";
ALTER TABLE "OperacaoFinanceira" DROP COLUMN "retificado_em";
ALTER TABLE "OperacaoFinanceira" DROP COLUMN "excluido_em";
DELETE FROM _prisma_migrations WHERE migration_name = '20261109300000_gestao_p3_03_editar_excluir';
COMMIT;
```

### 9.2 Depois do merge
- Não fazer `DROP`: os eventos e as marcas são o histórico de retificações e exclusões reais.
- Problema de código → rollback de deployment ou revert da PR. O schema fica.
- O comportamento do runtime antigo está descrito no §0.

## 10. Estados que bloqueiam (`RELEASE_BLOCKED`)
- alvo divergente;
- histórico diferente de 36/0;
- P3-03, tabela ou colunas já existentes;
- checksum diferente;
- classificador com violação;
- sem backup;
- CI não verde;
- sem GO;
- qualquer erro na transação.

## 11. Registro de execução (preencher só quando executado)

| Campo | Valor |
|---|---|
| GO do proprietário | não executado |
| Caminho | não executado |
| Alvo e histórico antes | não executado |
| SHA-256 e classificador | não executado |
| Backup | não executado |
| Ensaio local | não executado |
| Transação | não executado |
| Conferência do §6 | não executado |
| Merge, deploy e smoke | não executado |
