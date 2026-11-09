# MAIKE — Gestão P3-03: runbook de release expand-only (D-PROD-158)

> **Estado: EXECUTADO até a conferência do §6. `SCHEMA_APPLIED_PROD: SIM`.**
> A migration foi aplicada em produção em 2026-11-09, às 21:32:01 UTC, pelo
> caminho B, com GO escrito do proprietário (§11). Pendentes: merge manual da
> PR #234, deploy e smoke (§7–§8).

Decisão: [D-PROD-158](./DECISIONS.md). Relatório:
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

### 7.1 Depois da PR #232 (Patrimônio) na `main` — situação em 2026-11-09, 22:30 UTC
- A `main` `76edc913` já traz o runtime do Patrimônio, mas a migration
  `20261110100000_patrimonio_p1_01_cadastros` **não** está aplicada em produção.
  A produção tem 37 migrations, a P3-03 é a última, e `BemPatrimonial` e
  `TipoCombustivelProduto` não existem.
- Os domínios de produção (`www.makgestao.com`, `makgestao.com`,
  `maike-five.vercel.app`) servem o deploy anterior `afbebcbc`, o que é compatível
  com um rollback. Pela documentação da Vercel, depois de um rollback um deploy
  novo da `main` **não** recebe os domínios sozinho: precisa de `promote`.
- Merge desta PR: o schema da P3-03 já está aplicado, então o merge não pede
  migration nova. Ele acrescenta à `main` o arquivo da P3-03, que já está no banco,
  e isso **destrava** o runner oficial para o Patrimônio:
  - `conferirHistoricoRemoto` com as 37 linhas de produção e os arquivos da `main`
    `76edc913` recusa (`PREMERGE_MIGRATIONS_NAO_COMPROVADAS`, porque a migration
    está no banco sem o arquivo na release);
  - com a árvore integrada desta PR, `ok: true`, e só o Patrimônio fica pendente.
- **Não promover** a `main` a produção, com ou sem esta PR, antes de aplicar a
  migration do Patrimônio pelo runbook dele, com GO próprio. O runtime do
  Patrimônio sem as tabelas responde 500 nas rotas dele e na exclusão de produto
  e de fornecedor (as duas consultam `TipoCombustivelProduto` e `BemPatrimonial`).
  A troca de empresa de produto também.

### 7.2 Atualização em 2026-11-09, 23:19 UTC (só leitura)
- A migration do Patrimônio foi aplicada **por outro fluxo** às 23:04:22 UTC, com
  checksum `b8818ba8…ffd64dc`. A produção tem **38** concluídas e 0 com falha, e
  82 tabelas.
- `conferirHistoricoRemoto` com as 38 linhas de produção e a árvore desta PR dá
  `ok: true` e **0 pendentes**. Depois do merge, a `main` fica idêntica ao banco de
  produção. Com a `main` `76edc913`, continua recusando, porque falta o arquivo da P3-03.
- Os domínios de produção ainda servem `afbebcbc`. Depois do merge, o novo deploy
  da `main` (P3-03 + Patrimônio) só vai ao ar por `promote` do proprietário. Com
  as duas migrations aplicadas, o schema não impede o promote. Depois dele, vem o
  smoke do §8, só de leitura.

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

## 11. Registro de execução

| Campo | Valor |
|---|---|
| GO do proprietário | GO escrito `MAIKE-GESTAO-P3-03-RELEASE-MIGRATION-B-PR234` (2026-11-09). Autoriza esta migration, no HEAD aprovado `bf2c5842`, com o checksum `3f3af00e…df890b`, pelo caminho B, com desvio da D-PROD-74 só para ela. O PITR desligado foi reconhecido pelo proprietário |
| Caminho | **B**: conector Supabase (`execute_sql`), uma única transação. O runner não rodou na máquina do proprietário |
| `main` e PR | `origin/main` em `afbebcbc` (#233, só UI e docs). Nenhuma migration nova na `main` (lista idêntica à `e4e907ea`). A PR #234 faz merge sem conflito |
| CI no HEAD aprovado | `quality` run 42698668677 **verde** em `bf2c5842`; `verify:all` local verde no mesmo HEAD (1029 s) |
| Alvo e histórico antes | Projeto `uuemcasqcdjucflulkne` (MAIKE, sa-east-1, `ACTIVE_HEALTHY`), PostgreSQL 17.11, `system_identifier` `7692130048193495360`. **36** concluídas e 0 com falha; a última é a P3-02 `df4d1ab2…2076f4a0`; P3-03 ausente; tabela e colunas novas ausentes. Sem sessão ativa, sem trava 72707369 e sem outra migration. `conferirHistoricoRemoto` (36 linhas × 37 arquivos do SHA): `ok: true`, só a P3-03 pendente. Papel `maike_vercel` presente. As variáveis de banco do projeto Vercel `maike` vêm da integração Supabase `icfg_UsO8aBOPSy5sBgT4u7v1x57q` (só os nomes foram conferidos); health de produção 200, banco `up`, release `afbebcbc` |
| SHA-256 e classificador | Arquivo no `bf2c5842`: `3f3af00edaffcce8ab0b64336029a93341bfbaba26c847e32e1d2658e4df890b`, igual ao manifesto. Classificador `expand: true`, 0 violações. Advisor de segurança antes: 0 alertas |
| Backup | API de gestão do Supabase (`GET /v1/projects/uuemcasqcdjucflulkne/database/backups`, HTTP 200, às 21:29:31 UTC): último backup físico **`COMPLETED` em 2026-11-09T05:48:27Z**, anterior à janela. `pitr_enabled: false` (**PITR desligado**): transações posteriores a esse backup não têm recuperação garantida |
| Contagens antes | `OperacaoFinanceira` 1, `OperacaoFinanceiraItem` 1, `TituloFinanceiro` 2, `LiquidacaoFinanceira` 0, `MovimentacaoEstoque` 1, `EstoqueLoteNota` 1, `OperacaoFinanceiraItemRateio` 0, `Usuario` 5, `Cliente` 2, `AuditLog` 649 |
| Ensaio local | PG17 descartável, com `anon`, `authenticated` e `maike_vercel`, imediatamente antes. O SQL com o identificador de produção foi recusado (`RELEASE_BLOCKED: alvo divergente`). Com o local: `COMMIT`, 36→37, `migrate diff` 0, `migrate status` em dia. Repetir foi recusado (`migration já registrada`). O rollback do §9.1 voltou a 36 e a reaplicação, a 37. Impressão digital local: colunas `7b44a465…`, constraints `fd9520f2…`, índices `265a2529…`, política `555b56ed…`, RLS `c734cb3c…` |
| Transação | Às 21:32:01 UTC: `BEGIN`, `lock_timeout` 5 s, trava 72707369, guarda (alvo, 36/0, P3-02 presente, P3-03, tabela e colunas ausentes), `migration.sql` **integral** do `bf2c5842`, registro em `_prisma_migrations` e `COMMIT`. Sem erro |
| Conferência do §6 | Às 21:32:13 UTC:<br>(1) **37** concluídas e 0 com falha; a P3-03 com o checksum `3f3af00e…` e `applied_steps_count = 1`.<br>(2) `excluido_em` e `retificado_em` em `timestamp(3)`, anuláveis, sem default; 0 linhas não nulas.<br>(3) `OperacaoFinanceiraEvento`: 15 colunas; `p` 1, `f` 4, `c` 4; FKs em `(r,c)`; índices: 1 PK, 2 uniques, 2 outros; RLS ligado sem FORCE; dono `postgres`; 1 × `maike_backend_all`, `ALL`, `{maike_vercel}`; 0 grants a `anon`, `authenticated` e `PUBLIC`; 0 constraint ou índice novo em tabela antiga.<br>(4) Tabela nova com 0 linhas; contagens iguais às de antes.<br>(5) Advisor de segurança: 0 alertas.<br>(6) `health` 200, banco `up`, release `afbebcbc` (runtime da P3-02); `/LancamentosFinanceiros` 200; API sem sessão 401; 0 erros de runtime na Vercel desde 21:25 UTC.<br>(7) Impressão digital **idêntica** à do ensaio local |
| Merge, deploy e smoke | Pendentes: o merge manual da PR #234 é do proprietário |
