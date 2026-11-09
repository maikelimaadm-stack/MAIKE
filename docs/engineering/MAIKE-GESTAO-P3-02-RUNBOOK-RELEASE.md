# MAIKE — Gestão P3-02: runbook de release expand-only (D-PROD-156)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
> Nada da P3-02 foi enviado ao Supabase de produção nem à Vercel. A migration só
> rodou em PostgreSQL local de teste. Este documento é o plano. Cada passo exige
> o GO específico do proprietário e para no primeiro desvio com
> **`RELEASE_BLOCKED`**.
>
> Valores entre `<…>` são preenchidos na hora da execução, sempre a partir de
> leituras reais.

Decisão: [D-PROD-156](./DECISIONS.md). Relatório:
[`MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md`](./MAIKE-GESTAO-P3-02-RATEIO-POR-ITEM-REPORT.md).
Modelo e histórico da release anterior:
[runbook da P3-01](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md), executado em
2026-11-09 às 14:08:36 UTC.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261109200000_gestao_p3_02_rateio_por_item` |
| Natureza | expand-only. Uma coluna **anulável e sem DEFAULT** `OperacaoFinanceira.rateio_escopo VARCHAR(12)` e uma tabela nova `OperacaoFinanceiraItemRateio`, com 20 colunas, 6 FKs compostas, 2 CHECKs, PK, 2 uniques, 3 índices e um bloco DO de RLS e REVOKE. Nenhum dado é migrado e nenhuma constraint ou índice entra em tabela antiga. |
| Tabelas antigas referenciadas (FK) | `Cliente`, `OperacaoFinanceira`, `OperacaoFinanceiraItem`, `NaturezaFinanceira`, `CentroCusto`, `CentroResultado` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `df4d1ab29144d551793bb2fe43616d60bed86b87f10ec044d1cae2552076f4a0` |
| Hash do DO pinado (`DO_RLS_APROVADOS`) | `dc05126cd737c77090c54fc04cd6f7d2ac0b7613168f13fb944a7477ca7bd576` |
| Classificador | `expand: true`; `tabelas_novas: [OperacaoFinanceiraItemRateio]`; `colunas_novas_em_tabelas_antigas: [OperacaoFinanceira.rateio_escopo]`; 0 violações |
| `_prisma_migrations` | antes **35** concluídas (a última é `20261109100000_gestao_p3_01_central_lancamentos`); depois **36** |

**Por que a migration vem antes do merge:** a Vercel publica a `main` sozinha.
Sem a coluna e a tabela nova, o runtime novo responde 500 em toda leitura e
escrita de lançamento. O runtime antigo (P3-01) ignora a coluna anulável e a
tabela nova, então o banco migrado continua atendendo a ele sem mudança.

**Se o runtime voltar ao da P3-01 depois que existir documento POR_ITEM** (§9.2):

| Operação no runtime antigo | Resposta exata | O que a tela antiga mostra |
|---|---|---|
| Confirmar (e a prévia de) um rascunho POR_ITEM | **422 `OPERACAO_RATEIO_INVALIDO`**, `reason: soma_diferente` (não há rateio geral: a soma é 0) | "a soma do rateio difere do total" / "os percentuais precisam somar 100" |
| Editar (Salvar) ou descartar o rascunho POR_ITEM | **403 `TENANT_SCOPE_VIOLATION`**, `message: "vínculo inválido para este tenant"`. O `apagarFilhosDoRascunho` antigo apaga o item, a FK RESTRICT da linha por item recusa (Prisma `P2003`) e o `errorHandler` traduz `P2003` em 403 | "Você não tem acesso a este registro." |
| Detalhe de confirmado POR_ITEM | 200, sem as linhas do rateio | o documento sem classificação |

Nos três casos nada se perde e nada fica errado: a transação recusada não grava
nada. As respostas, porém, **enganam**: o código antigo não tem como ser
corrigido, então o aviso fica aqui.

> **Aviso ao suporte e ao monitoramento (janela de rollback):** enquanto o
> runtime da P3-01 estiver no ar com a migration da P3-02 aplicada, um **403
> `TENANT_SCOPE_VIOLATION`** em `PUT` ou `DELETE /operacoes-financeiras/:id` de
> um rascunho POR_ITEM **não é incidente de tenancy**: é a FK da linha por item
> segurando o item. E um 422 `soma_diferente` ao confirmar esse rascunho não é
> erro de digitação do usuário. O documento volta a funcionar quando o runtime
> da P3-02 voltar. Não "corrigir" apagando linhas por item no banco.

**Efeito durante a transação:**
- `ADD FOREIGN KEY` toma `SHARE ROW EXCLUSIVE` nas 6 tabelas referenciadas até o
  `COMMIT`, e `ADD COLUMN` toma `ACCESS EXCLUSIVE` em `OperacaoFinanceira` por um
  instante. Coluna anulável sem DEFAULT não reescreve a tabela.
- O `lock_timeout` de 5 s aborta tudo, sem aplicar nada, se houver uma transação
  longa no caminho.

## 1. Caminho

- **Padrão (D-PROD-74):** runner oficial `premerge-migrate.mjs --sha <SHA_APROVADO>`,
  primeiro com `--verificar-alvo` e depois com `--aplicar`. Roda numa máquina
  protegida do operador, com `MIGRATION_DATABASE_URL` direta ou de sessão (porta
  5432, nunca o pooler 6543) e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360`.
- **Caminho B (conector Supabase, uma transação):** só com GO escrito que cite
  esta migration, este alvo e o desvio da D-PROD-74. Foi o caminho usado na P1,
  na P2 e na P3-01.

## 2. Pré-requisitos do GO

1. PR da P3-02 aprovada pelo proprietário e CI verde no `<SHA_APROVADO>` (40 hex).
2. GO escrito: esta migration, este alvo, caminho A ou B, ciência da janela.
3. Backup comprovado (§4.4). Em 2026-11-09 o PITR estava **desligado** e havia
   backup físico diário.
4. Nenhuma outra migration na janela e **nenhuma escrita de teste na Preview**. A
   Preview usa o banco de produção.

## 3. Ordem

GO → preflight só leitura (§4) → ensaio local do SQL com o arquivo do SHA (§4.6)
→ migration (§5) → conferência (§6) → registro (§11) → merge manual → deploy →
smoke (§8).

## 4. Preflight (somente leitura)

### 4.1 Alvo
`SELECT system_identifier FROM pg_control_system();` deve devolver
`7692130048193495360`, e o PostgreSQL deve ser o 17.x. As variáveis de banco do
projeto Vercel `maike` precisam vir da integração Supabase deste projeto
(conferir só os nomes).

### 4.2 Histórico
- Exatamente **35** linhas concluídas e nenhuma com falha.
- A última é `20261109100000_gestao_p3_01_central_lancamentos`, com checksum
  `bb89f4e0…4a451dc18a`.
- A P3-02 está ausente.
- `conferirHistoricoRemoto` (35 linhas × arquivos do SHA) deve dar `ok: true`,
  `pendentes: [20261109200000_gestao_p3_02_rateio_por_item]` e 0 falhas.
- Recontar a `main` no GO; se ela tiver ganhado migration, o número esperado
  muda pela recontagem.
- A tabela `OperacaoFinanceiraItemRateio` e a coluna `OperacaoFinanceira.rateio_escopo`
  não podem existir.
- Anote as contagens de `OperacaoFinanceira`, `OperacaoFinanceiraItem`,
  `OperacaoFinanceiraRateio` e `TituloFinanceiro`.

### 4.3 Checksum
`git show <SHA_APROVADO>:backend/prisma/migrations/20261109200000_gestao_p3_02_rateio_por_item/migration.sql | sha256sum`
deve ser igual ao valor de `MIGRATIONS_APROVADAS`. O valor gravado em
`_prisma_migrations` é o calculado aqui.

### 4.4 Backup
Vale uma destas provas:
- a API de gestão do Supabase, `GET /v1/projects/uuemcasqcdjucflulkne/database/backups`,
  com o token do proprietário;
- o painel do Supabase;
- um dump lógico do proprietário.

Exige último backup `COMPLETED` anterior à janela. Sem prova → `RELEASE_BLOCKED`.

### 4.5 Classificador
`node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>` (análise local, sem
credenciais) deve sair 0, com `migrations_novas` = só a P3-02, `expand: true` e
0 violações.

### 4.6 Ensaio local imediato
Com o arquivo do SHA, num PostgreSQL 17 local que tenha os papéis `anon`,
`authenticated` e `maike_vercel`:
- o SQL do §5 com o identificador de produção é recusado (`alvo divergente`);
- com o identificador local, ele aplica até o `COMMIT`, e `prisma migrate diff --exit-code` dá 0;
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
              WHERE migration_name = '20261109200000_gestao_p3_02_rateio_por_item') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 35 OR n_ruim <> 0 THEN   -- 35 = recontagem do §4.2
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261109100000_gestao_p3_01_central_lancamentos'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: P3-01 ausente';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relname = 'OperacaoFinanceiraItemRateio') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela nova já existe';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'OperacaoFinanceira' AND column_name = 'rateio_escopo') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: coluna rateio_escopo já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '<SHA256_CALCULADO_NO_4.3>', now(),
        '20261109200000_gestao_p3_02_rateio_por_item', NULL, NULL, now(), 1);
COMMIT;
```

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios e não tem `DELETE`,
  `TRUNCATE`, `UPDATE` nem `INSERT` de dado. O único `DROP` é `DROP POLICY IF EXISTS`
  na tabela nova.
- Qualquer falha desfaz tudo. Confira com o §6 que nada ficou e peça um novo GO.

## 6. Conferência pós-aplicação (somente leitura)

| # | Conferência | Esperado |
|---|---|---|
| 1 | `_prisma_migrations` | **36** concluídas e 0 com falha; a linha da P3-02 tem o `checksum` do §4.3 e `applied_steps_count = 1` |
| 2 | `information_schema.columns` de `OperacaoFinanceira.rateio_escopo` | `character varying(12)`, `is_nullable = YES`, `column_default` NULL; todas as linhas antigas com NULL |
| 3 | `pg_class` da tabela nova | RLS ligado, sem FORCE; mesmo dono de `OperacaoFinanceiraRateio` |
| 4 | Colunas da tabela nova | 20 |
| 5 | `pg_constraint` da tabela nova | `p` 1, `f` 6, `c` 2. FKs: `operacao` e `natureza` com `(r,r)`; `cliente`, `item`, `centro_custo` e `centro_resultado` com `(r,c)` |
| 6 | `pg_index` da tabela nova | PK 1, unique 2, não unique 3 |
| 7 | `pg_policies` | 1 × `maike_backend_all`, `ALL`, `{maike_vercel}` |
| 8 | Grants da tabela nova | 0 para `anon`, `authenticated` e `PUBLIC`; os demais grantees iguais aos de `OperacaoFinanceiraRateio` |
| 9 | Contagens | tabela nova com 0 linhas; contagens do §4.2 iguais |
| 10 | Advisor de segurança | nenhum alerta novo |
| 11 | Runtime no ar | `GET /api/native/health` → 200; lista e detalhe de lançamentos do runtime antigo funcionando; nenhum erro novo nos logs em 30 min |

Qualquer divergência → **não fazer o merge**. Registre e avalie o §9.1.

## 7. Merge manual
Só com o §6 inteiro conferido. O merge é do proprietário. O registro do §11 entra
por commit de documentação na própria PR antes do merge, e a CI precisa ficar
verde de novo.

## 8. Deploy e smoke
- Deployment de produção do commit de merge em READY (consulta só leitura).
- **Smoke só leitura**, com a conta do proprietário:
  1. health 200;
  2. a tela "Lançamentos Financeiros" abre;
  3. a lista e o detalhe de um documento da P3-01 mostram o rateio geral igual
     ao de antes;
  4. a prévia de um rascunho existente funciona;
  5. logs sem 500 novo em 30 min.
- **Nenhum documento de teste com mercadoria confirmado em produção.** Isso cria
  fato real de estoque. O primeiro uso POR_ITEM é uso real do proprietário.

## 9. Rollback

### 9.1 Antes do merge (tabela nova vazia, coluna toda NULL)
Só com autorização expressa e com a PR **não** mergeada:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM "OperacaoFinanceiraItemRateio") THEN
    RAISE EXCEPTION 'tabela nova com linhas: isto não é rollback de schema vazio';
  END IF;
  IF EXISTS (SELECT 1 FROM "OperacaoFinanceira" WHERE rateio_escopo IS NOT NULL) THEN
    RAISE EXCEPTION 'rateio_escopo já gravado: o runtime novo já rodou';
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE migration_name = '20261109200000_gestao_p3_02_rateio_por_item') <> 1 THEN
    RAISE EXCEPTION 'registro da migration ausente ou duplicado';
  END IF;
END $guarda$;
DROP TABLE "OperacaoFinanceiraItemRateio";
ALTER TABLE "OperacaoFinanceira" DROP COLUMN "rateio_escopo";
DELETE FROM _prisma_migrations WHERE migration_name = '20261109200000_gestao_p3_02_rateio_por_item';
COMMIT;
```

### 9.2 Depois do merge
- Não fazer `DROP`: podem existir classificações reais por item.
- Problema de código → rollback de deployment na Vercel ou revert da PR. A
  coluna e a tabela ficam. Como o runtime antigo se comporta está no quadro do
  §0: falha segura, sem perda de dado, mas com respostas que enganam. Antes do
  rollback, avisar o suporte: nessa janela, **403 `TENANT_SCOPE_VIOLATION`** ao
  salvar ou descartar um rascunho POR_ITEM e **422 `OPERACAO_RATEIO_INVALIDO`
  `soma_diferente`** ao confirmá-lo são esperados e não são incidente de tenancy.

### 9.3 Restaurar backup
Não é rollback desta release. Volta o banco inteiro, com todos os tenants. Exige
plano explícito e decisão do proprietário (ver o runbook da P3-01, §9.3).

## 10. Estados que bloqueiam (`RELEASE_BLOCKED`)
- `system_identifier` divergente;
- histórico ≠ 35/0;
- P3-02 já registrada, tabela nova ou coluna já existentes;
- checksum diferente do manifesto;
- classificador com violação;
- sem prova de backup;
- CI não verde no SHA aprovado;
- sem GO escrito;
- qualquer erro na transação.

## 11. Registro de execução (preencher só quando executado)

| Campo | Valor |
|---|---|
| GO do proprietário (texto e data/hora UTC) | não executado |
| Caminho (A runner / B conector) | não executado |
| `system_identifier` e vínculo Vercel ↔ Supabase | não executado |
| Histórico antes | não executado |
| SHA-256 calculado no §4.3 | não executado |
| Evidência de backup | não executado |
| Classificador e ensaio local | não executado |
| Resultado da transação | não executado |
| Conferência do §6 | não executado |
| Merge, deployment e smoke | não executado |
