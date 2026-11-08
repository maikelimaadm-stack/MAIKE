# MAIKE — Gestão P3-01: runbook de release expand-only (D-PROD-154)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
> Nesta missão nada foi enviado ao Supabase de produção nem à Vercel: nenhum
> `CREATE`, nenhum registro em `_prisma_migrations`, nenhuma variável alterada,
> nenhum merge. A migration só rodou em PostgreSQL local de teste. Este documento
> é o plano. Cada passo exige o GO do proprietário e para no primeiro desvio com
> **`RELEASE_BLOCKED`**.
>
> Valores entre `<…>` (por exemplo `<SHA_APROVADO>`) são preenchidos na hora da
> execução, a partir de leituras reais, nunca copiados deste texto.

Relatório da missão:
[`MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md`](./MAIKE-GESTAO-P3-01-LANCAMENTO-UNICO-REPORT.md).
Decisão: [D-PROD-154](./DECISIONS.md).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261109100000_gestao_p3_01_central_lancamentos` |
| Natureza | expand-only: 8 tabelas novas, 33 FKs, 33 CHECKs, 25 uniques, 12 índices e um bloco DO de RLS/REVOKE; zero `ALTER` em tabela antiga; nenhum dado migrado |
| Tabelas novas | `PerfilFinanceiroEmpresa`, `OperacaoFinanceira`, `OperacaoFinanceiraItem`, `OperacaoFinanceiraConsumoLote`, `OperacaoFinanceiraRateio`, `TituloFinanceiro`, `LiquidacaoFinanceira`, `LiquidacaoFinanceiraEstorno` |
| Tabelas antigas referenciadas (FK) | `Cliente`, `Empresa`, `Usuario`, `Fornecedor`, `Produto`, `LocalEstoque`, `MovimentacaoEstoque`, `EstoqueLoteNota`, `NaturezaFinanceira`, `CentroCusto`, `CentroResultado` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `69def1b65a43842270533f08485dd104ef5f2f864035a9976b743101e295bdb7` |
| Hash do DO pinado (`DO_RLS_APROVADOS`) | `0289125dfdf6df7bccc8ca070208a4c9d1bf948fad1b341ae4d443e9f13ab4fe` |
| `_prisma_migrations` | antes **34** concluídas (as 34 pastas da `main` `7ab43f7f`, a última `20261108100000_gestao_p2_naturezas_financeiras`); depois **35** |

**Por que a migration vem antes do merge:** a Vercel publica a `main` em produção
sozinha, e o runtime novo sem as 8 tabelas responde 500 nas 12 rotas novas que as
usam (perfil, lista, detalhe, rascunho, prévia e comandos; as 7 rotas de opções
não as leem) e também nos caminhos antigos que passaram a contá-las (exclusão de
parceiro, produto, local de estoque e empresa; PATCH administrativo e DELETE de
lote de nota). O runtime antigo ignora as tabelas novas, então o banco migrado o
atende sem mudança.

**Efeito durante a transação:** `ADD FOREIGN KEY` toma `SHARE ROW EXCLUSIVE`
nas 11 tabelas referenciadas até o `COMMIT`. Escritas nelas esperam por alguns
instantes. Com `lock_timeout` de 5 s, uma transação longa segurando uma delas
aborta tudo, sem aplicar nada.

## 1. Caminho oficial e o caminho usado na P1 e na P2

- **Regra (D-PROD-74, item 1):** migration só pelo runner oficial
  `npm run deploy:migrate`. Antes do merge, ele roda por
  [`premerge-migrate.mjs`](../../scripts/deploy/premerge-migrate.mjs)
  `--sha <SHA_APROVADO> --aplicar`, numa máquina protegida do operador com
  `MIGRATION_DATABASE_URL` (sessão/direta, nunca o pooler 6543) e
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`. Depois do merge, o caminho é o workflow
  `.github/workflows/release-migrate.yml`.
- **O que a P1 e a P2 fizeram** (e antes delas a S04-P1 e a S04-P2): a sessão não
  tinha conexão de banco protegida, então a migration foi enviada pelo conector
  Supabase (`execute_sql`) como **uma única transação**: guardas, `migration.sql`
  integral, `INSERT` em `_prisma_migrations` com o sha256 do arquivo e
  `applied_steps_count = 1`, e `COMMIT`. Cada vez isso foi registrado como desvio
  da D-PROD-74 nos relatórios
  ([P1 §9](./MAIKE-GESTAO-CADASTROS-P1-REPORT.md),
  [P2 §12](./MAIKE-GESTAO-CADASTROS-P2-NATUREZAS-REPORT.md),
  [S04-P1 §13](./MAIKE-SAAS-ADMIN-S04-P1-REVOGACAO-SESSOES.md)), e a correção
  G4-R5 da própria D-PROD-74 deixa claro que esse formato **não é precedente**. A
  D-PROD-75 provou que ele dá o mesmo resultado do `prisma migrate deploy`.
- **Padrão desta release: o runner oficial (caminho A, §5).** O caminho B (o da P1
  e da P2) só vale com autorização escrita e específica do proprietário para ESTA
  migration, registrada no GO como desvio da D-PROD-74 — nunca presumida a partir
  das releases anteriores nem de uma autorização genérica. As checagens antes e
  depois são as mesmas nos dois caminhos.
- **Por que não usar o `apply_migration` do Supabase:**
  - Ele grava em `supabase_migrations.schema_migrations`, outro histórico, com
    versão própria. O `prisma migrate deploy`, o `premerge-migrate`, o
    `conferirHistoricoRemoto`, o preflight e o `release-migrate.yml` só leem
    `_prisma_migrations`.
  - Para o Prisma a migration ficaria pendente. O próximo `deploy:migrate`
    rodaria o SQL de novo e falharia na tabela que já existe, deixando uma linha
    com falha que trava toda release seguinte até resolução manual.
  - Passariam a existir dois históricos (SSOT duplicado), e o do Supabase listaria
    uma migration que o repositório não tem: não há pasta `supabase/` aqui.
  - As guardas e o registro em `_prisma_migrations` não entrariam na mesma
    unidade atômica do DDL.
  - As releases pelo conector registradas no repositório usaram `execute_sql`,
    não `apply_migration` (a S04-P1 registra: "`supabase_migrations` não foi
    usada").
- **Por que não DDL solto pelo `execute_sql`:**
  - Sem uma transação única, uma falha no meio deixa parte das tabelas e
    constraints criada e nenhum registro: um estado que nem o Prisma nem o
    classificador reconhecem e que exigiria limpeza manual em produção.
  - Registrar `_prisma_migrations` à parte ("marcar à mão") é exatamente o que a
    D-PROD-74 proíbe.
  - Só a forma atômica é aceita: o schema e o registro do histórico entram juntos,
    ou nada entra.

## 2. Pré-requisitos do GO (sem eles, não começa)

1. **Código aprovado:** os 8 achados da revisão adversarial fechados (relatório
   §7.4), CI verde no HEAD final e PR #230 aprovada pelo proprietário no review.
2. **SHA aprovado** `<SHA_APROVADO>` (40 hex): o HEAD da PR #230 na aprovação.
3. **GO escrito do proprietário:** autoriza esta migration neste alvo, escolhe o
   caminho A ou B e aceita a janela.
4. **Prova de backup/PITR** (§4.4).
5. **Congelamento:** nenhuma outra migration aplicada na janela, e nenhuma escrita
   de teste na Preview da PR #230. A Preview usa o mesmo banco de produção (S04-P1
   §13.5): depois da migration, um teste nela criaria lançamento e estoque reais.

## 3. Ordem (cada passo só começa com o anterior comprovado)

GO do proprietário → preflight só leitura (§4) → migration (§5) → conferência
(§6) → merge manual (§7) → deploy → smoke (§8). Rollback no §9 e estados que
bloqueiam no §10.

## 4. Preflight — somente leitura

### 4.1 Alvo (Vercel ↔ Supabase `uuemcasqcdjucflulkne`)

- O projeto Supabase é MAIKE `uuemcasqcdjucflulkne` (sa-east-1), e
  `SELECT system_identifier FROM pg_control_system();` devolve
  `7692130048193495360`, o mesmo das releases P1 e P2.
- O projeto `maike` da Vercel (production) recebe as variáveis de banco da
  integração Supabase desse projeto. Confira só os nomes das variáveis, nunca os
  valores.
- A correlação aparece no banco: conexões ativas da aplicação via Supavisor em
  `pg_stat_activity` (contagem por `usename`/`application_name`, sem imprimir
  segredo), ou um id recente dos logs de produção que existe nesse banco.
- No caminho A, também `node scripts/deploy/conferir-alvo-banco.mjs` deve sair 0.
- Qualquer divergência → `RELEASE_BLOCKED`.

### 4.2 Histórico `_prisma_migrations`

```sql
SELECT migration_name, checksum, finished_at IS NOT NULL AS concluida,
       rolled_back_at IS NOT NULL AS revertida, applied_steps_count
  FROM _prisma_migrations ORDER BY started_at;
```

Esperado:

- **Contagem:** exatamente **34** linhas, todas concluídas e nenhuma revertida.
  São as 34 pastas de migration da `main`. Reconte no GO com
  `git ls-tree --name-only origin/main backend/prisma/migrations/ | grep -vc toml`;
  se a `main` tiver ganhado migration, o número esperado muda pela recontagem,
  nunca por suposição.
- **Última linha:** `20261108100000_gestao_p2_naturezas_financeiras`, com
  checksum `db299e1d…62f04`.
- **P3-01:** `20261109100000_gestao_p3_01_central_lancamentos` ausente.
- **Checksums:** avalie as linhas com `conferirHistoricoRemoto({ locais, linhas })`
  de [`premergeMigrateLib.mjs`](../../scripts/deploy/premergeMigrateLib.mjs),
  com `locais` = nome e sha256 de cada arquivo no SHA aprovado. O resultado deve
  ser `ok: true`, `pendentes: ['20261109100000_gestao_p3_01_central_lancamentos']`
  e 0 falhas. Os 4 checksums `manual` históricos são aceitos só pelos nomes de
  `CHECKSUM_MANUAL_HISTORICO`.

As 8 tabelas não podem existir:

```sql
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('PerfilFinanceiroEmpresa','OperacaoFinanceira',
   'OperacaoFinanceiraItem','OperacaoFinanceiraConsumoLote','OperacaoFinanceiraRateio',
   'TituloFinanceiro','LiquidacaoFinanceira','LiquidacaoFinanceiraEstorno');  -- 0 linhas
```

Anote, para comparar depois, as contagens de `Cliente`, `Usuario`, `Empresa`,
`Fornecedor`, `Produto`, `EstoqueLoteNota` e `MovimentacaoEstoque`.

### 4.3 Checksum (sha256 do arquivo, nunca fabricado)

No clone do operador, sem alterar a árvore:

```bash
git show <SHA_APROVADO>:backend/prisma/migrations/20261109100000_gestao_p3_01_central_lancamentos/migration.sql | sha256sum
```

- O resultado tem de ser igual a
  `MIGRATIONS_APROVADAS['20261109100000_gestao_p3_01_central_lancamentos']` =
  `69def1b65a43842270533f08485dd104ef5f2f864035a9976b743101e295bdb7`.
- O valor gravado em `_prisma_migrations` é **o calculado aqui**, nunca copiado de
  documento nem digitado de memória.
- Divergência → `RELEASE_BLOCKED`. Não se "acerta" a pinagem para a release
  passar.

### 4.4 Backup, PITR e restauração (prova exigida)

Vale uma destas evidências, registrada no §11:

- **Painel do Supabase → Database → Backups:** PITR ativo com janela de retenção
  que cobre a janela da release, ou backup diário concluído com horário UTC
  anterior a ela. Serve captura ou texto copiado pelo proprietário.
- **API de gestão do Supabase:**
  `GET /v1/projects/uuemcasqcdjucflulkne/database/backups`, com o token do
  proprietário (nunca colado no chat). Deve mostrar `pitr_enabled` e/ou o último
  backup concluído com horário anterior à janela.
- **Backup lógico feito pelo proprietário** (`pg_dump`/`supabase db dump`),
  guardado fora do repositório, com data e tamanho.

Também é preciso conhecer o procedimento de restauração. Restaurar backup ou PITR
volta o **banco inteiro**, todos os tenants, a um ponto no tempo: não é o rollback
desta release (§9.3).

Sem prova → **`RELEASE_BLOCKED`**. Na P1 e na P2 a falta de prova foi aceita como
desvio; a D-PROD-154 não aceita.

### 4.5 Preflight expand-only (classificador)

- `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>` (análise local,
  sem credenciais, no clone do operador com checkout exato do SHA): árvore limpa,
  HEAD = SHA, `origin/main` igual ao remoto, e as
  migrations novas = exatamente a P3-01 do manifesto. Sem recusa (exit 3 =
  `RELEASE_BLOCKED`).
- `classificarMigrations([{ nome, sql }])` sobre o arquivo do SHA aprovado deve
  dar `expand: true`, `tabelas_novas` = as 8 tabelas,
  `colunas_novas_em_tabelas_antigas: []` e `violacoes: []`. Um DO fora de
  `DO_RLS_APROVADOS` aparece como `DO_NAO_RECONHECIDO`.

### 4.6 Janela

- Escolha horário de pouco uso e avise as fazendas, se o proprietário quiser.
- Acompanhe os logs do Supabase e da Vercel durante a janela.
- A transação é curta: só cria objetos novos em tabelas vazias.

## 5. Aplicação — uma transação

O padrão é o caminho A (runner oficial). O caminho B só entra com a autorização
escrita e específica descrita no §1; sem ela, use o A ou pare (`RELEASE_BLOCKED`).

### Caminho B (o da P1 e da P2, só com autorização específica): conector Supabase, uma chamada `execute_sql`

Envie tudo numa chamada só. O proprietário vê e aprova o diálogo do conector.

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
              WHERE migration_name = '20261109100000_gestao_p3_01_central_lancamentos') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 34 OR n_ruim <> 0 THEN   -- 34 = recontagem do §4.2
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relname IN ('PerfilFinanceiroEmpresa',
                'OperacaoFinanceira','OperacaoFinanceiraItem','OperacaoFinanceiraConsumoLote',
                'OperacaoFinanceiraRateio','TituloFinanceiro','LiquidacaoFinanceira',
                'LiquidacaoFinanceiraEstorno')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela nova já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '<SHA256_CALCULADO_NO_4.3>', now(),
        '20261109100000_gestao_p3_01_central_lancamentos', NULL, NULL, now(), 1);
COMMIT;
```

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios (o único `BEGIN` está dentro
  do bloco DO) e o único `DROP` dele é `DROP POLICY IF EXISTS` nas próprias
  tabelas novas. Nenhum `DELETE`, `TRUNCATE` ou `UPDATE` de dado.
- Se qualquer comando falhar, nada fica. Confirme com o §6 que as 8 tabelas não
  existem e que não há linha nova, corrija a causa e peça novo GO.

### Caminho A (runner oficial, D-PROD-74)

```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
```

O `--aplicar` chama `npm run deploy:migrate`, que confere de novo o alvo, recusa o
pooler e faz o próprio Prisma gravar `_prisma_migrations` com o checksum do
arquivo.

## 6. Conferência pós-aplicação (somente leitura)

Nas consultas abaixo, `t` é a lista das 8 tabelas:

```sql
WITH t(nome) AS (VALUES ('PerfilFinanceiroEmpresa'),('OperacaoFinanceira'),('OperacaoFinanceiraItem'),
  ('OperacaoFinanceiraConsumoLote'),('OperacaoFinanceiraRateio'),('TituloFinanceiro'),
  ('LiquidacaoFinanceira'),('LiquidacaoFinanceiraEstorno'))
SELECT …;
```

| # | Conferência | Esperado |
|---|---|---|
| 1 | `_prisma_migrations`: concluídas e com falha; linha da P3-01 | **35** concluídas, 0 com falha; `checksum` = §4.3; `applied_steps_count = 1` |
| 2 | `pg_class`: `relrowsecurity`, `relforcerowsecurity`, `pg_get_userbyid(relowner)` das 8 e de `NaturezaFinanceira` | 8 tabelas; RLS ligado, sem FORCE; mesmo dono de `NaturezaFinanceira` |
| 3 | `information_schema.columns` por tabela | 9 / 33 / 22 / 9 / 17 / 15 / 12 / 10 (na ordem do §0), 127 no total |
| 4 | `pg_constraint` por `contype` | `p` 8, `f` 33, `c` 33 |
| 5 | FKs: `confdeltype`, `confupdtype` | 33 com `ON DELETE RESTRICT` (`r`); `ON UPDATE CASCADE` (`c`) em 31 e `RESTRICT` (`r`) nas 2 do rateio (→ `OperacaoFinanceira` com direção, → `NaturezaFinanceira` com tipo) |
| 6 | `pg_index`: PK, unique e não unique | 8 / 25 / 12 (45 no total) |
| 7 | `pg_policies` | 8 × `maike_backend_all`, `ALL`, `{maike_vercel}` (o bloco DO só cria a política se o papel existir; em produção ele existe, como na conferência da P2) |
| 8 | `information_schema.role_table_grants` das 8 e de `NaturezaFinanceira` | 0 para `anon`, `authenticated` e `PUBLIC`; cada outro grantee com os mesmos privilégios que tem em `NaturezaFinanceira` |
| 9 | `count(*)` das 8 e das tabelas anotadas no §4.2 | 8 × 0 linhas; contagens antigas iguais às de antes |
| 10 | Advisor de segurança do Supabase (só leitura) | nenhum alerta novo de RLS ou grant nas 8 tabelas |
| 11 | Runtime antigo no ar | `GET https://www.makgestao.com/api/native/health` → 200; nenhum erro novo nos logs de produção em 30 min |

Qualquer divergência → **não fazer o merge**. Registre e avalie o rollback do §9.1.

## 7. Merge manual

- Só com o §6 inteiro conferido. O proprietário faz o merge manual da PR #230; o
  agente não faz merge.
- O registro da aplicação (o §11 preenchido) entra no relatório e nesta página por
  commit de documentação na própria PR, antes do merge, como na P2. Com esse
  commit o HEAD muda; a CI precisa estar verde de novo, mas o arquivo da migration
  continua o mesmo.

## 8. Deploy e smoke

- Aguarde o deployment de produção do commit de merge ficar pronto na Vercel
  (consulta só leitura do estado).
- **Smoke só leitura**, feito pelo proprietário ou com a conta de administrador
  dele:
  1. `GET /api/native/health` → 200.
  2. O menu mostra "Lançamentos Financeiros" só para quem tem `visualizar`.
  3. `GET /api/native/perfis-financeiros-empresa?empresa_id=<id>` → 200 (`perfil:
     null` antes do onboarding).
  4. `GET /api/native/operacoes-financeiras?empresa_id=<id>&limit=1` → 200, e as 7
     rotas `/operacoes-financeiras-opcoes/*` → 200.
  5. O Mapa Geral abre e a suplementação continua aparecendo como antes.
  6. Logs de produção sem 500 novo nas rotas novas nem nas exclusões, nos 30 min
     seguintes.
- **Escrita no smoke**, só com consentimento expresso:
  - O onboarding do perfil é ação real do proprietário, não teste.
  - Um rascunho SEM_PRODUTOS salvo e descartado deixa `AuditLog` e consome um
    número de documento.
  - Nunca confirmar documento de teste com mercadoria em produção: cria fato real
    de estoque.

## 9. Rollback

### 9.1 Antes do merge (tabelas novas e vazias, sem leitor)

Só com autorização expressa do proprietário e só com a PR #230 **não** mergeada
(o operador confere que `origin/main` não tem a pasta da migration). Uma
transação:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM "PerfilFinanceiroEmpresa") OR EXISTS (SELECT 1 FROM "OperacaoFinanceira")
     OR EXISTS (SELECT 1 FROM "OperacaoFinanceiraItem") OR EXISTS (SELECT 1 FROM "OperacaoFinanceiraConsumoLote")
     OR EXISTS (SELECT 1 FROM "OperacaoFinanceiraRateio") OR EXISTS (SELECT 1 FROM "TituloFinanceiro")
     OR EXISTS (SELECT 1 FROM "LiquidacaoFinanceira") OR EXISTS (SELECT 1 FROM "LiquidacaoFinanceiraEstorno") THEN
    RAISE EXCEPTION 'tabela nova com linhas: isto não é rollback de schema vazio';
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE migration_name = '20261109100000_gestao_p3_01_central_lancamentos') <> 1 THEN
    RAISE EXCEPTION 'registro da migration ausente ou duplicado';
  END IF;
END $guarda$;
-- filhas antes das mães; sem CASCADE: dependência inesperada faz falhar e nada muda
DROP TABLE "LiquidacaoFinanceiraEstorno";
DROP TABLE "LiquidacaoFinanceira";
DROP TABLE "TituloFinanceiro";
DROP TABLE "OperacaoFinanceiraConsumoLote";
DROP TABLE "OperacaoFinanceiraRateio";
DROP TABLE "OperacaoFinanceiraItem";
DROP TABLE "OperacaoFinanceira";
DROP TABLE "PerfilFinanceiroEmpresa";
DELETE FROM _prisma_migrations WHERE migration_name = '20261109100000_gestao_p3_01_central_lancamentos';
COMMIT;
```

Políticas, índices e constraints saem com as tabelas. Depois confira: 34
concluídas, as 8 tabelas ausentes e as contagens antigas iguais.

### 9.2 Depois do merge

- Não fazer `DROP`: as tabelas podem ter lançamentos reais, e os lotes e
  movimentos de estoque gerados por eles continuam fatos do estoque.
- Problema de código → rollback de deployment na Vercel para o anterior, ou
  revert da PR. As tabelas ficam: são aditivas, e o runtime antigo as ignora.
- No runtime antigo, excluir um cadastro referenciado por lançamento responde 403
  (FK RESTRICT) em vez de 409, sem perda de dado.

### 9.3 Restaurar backup ou PITR

Não é rollback desta release. Volta o banco inteiro no tempo, com todos os
tenants e todas as escritas depois do ponto. Exige plano explícito (janela,
comunicação, reconciliação) e decisão do proprietário
([runbook da PR #174, Rollback](./MAIKE-PR174-RELEASE-CUTOVER-RUNBOOK.md)).

### 9.4 Ensaio local do SQL deste runbook (não é produção)

Em 2026-11-08 o SQL dos §5 (caminho B), §6 e §9.1 foi ensaiado num PostgreSQL 16
local descartável, com as 34 migrations da `main` aplicadas por
`prisma migrate deploy`. Foi trocado só o `system_identifier`, pelo do banco
local, e o banco foi removido no fim.

- **Com o `system_identifier` de produção:** a guarda abortou
  (`RELEASE_BLOCKED: alvo divergente`), com 34 linhas e nenhuma tabela nova.
- **Com o do banco local:** `COMMIT`; 35 linhas; checksum
  `69def1b6…e295bdb7`; `applied_steps_count = 1`.
- **O Prisma aceitou o registro:** `prisma migrate status` → "Database schema is
  up to date!"; `prisma migrate diff --exit-code` → 0; `prisma migrate deploy` →
  "No pending migrations to apply".
- **Repetir a transação:** abortou (`migration já registrada`).
- **Conferência do §6:**
  - 8 tabelas com RLS e sem FORCE; colunas 9/33/22/9/17/15/12/10;
  - `p`/`f`/`c` = 8/33/33; FKs `(r, c)` 31 e `(r, r)` 2; índices 8/25/12;
  - 0 grants para `anon`/`authenticated`;
  - 0 políticas, porque `maike_vercel` não existe no banco local.
- **Rollback do §9.1:**
  - com uma linha em `PerfilFinanceiroEmpresa`, abortou;
  - vazio, `COMMIT`: 34 linhas, as 8 tabelas removidas, e o Prisma voltou a ver
    a P3-01 como pendente;
  - a reaplicação seguinte deu `COMMIT` com 35 linhas.

O ensaio prova a sintaxe, as guardas e a equivalência com o Prisma no
PostgreSQL 16. Não prova nada sobre o banco de produção (PostgreSQL 17), que não
foi tocado.

## 10. Estados que bloqueiam (fail-closed → `RELEASE_BLOCKED`)

- **Alvo:** `system_identifier` divergente ou vínculo Vercel ↔ Supabase não
  comprovado.
- **Histórico:**
  - número de concluídas diferente da recontagem (34 hoje), ou linha parcial ou
    revertida;
  - checksum divergente;
  - P3-01 já registrada;
  - alguma das 8 tabelas já existe.
- **Arquivo:** SHA do arquivo ≠ manifesto; classificador sem `expand: true` ou
  com violação; `premerge-migrate` com exit 3.
- **Backup:** sem prova de backup/PITR.
- **Código:** achado da revisão aberto sem aceite escrito do proprietário, ou CI
  não verde no SHA aprovado.
- **Autorização:** sem GO escrito ou sem escolha entre os caminhos A e B.
- **Execução:** qualquer erro na transação. Confirme que nada ficou antes de
  qualquer nova tentativa.

## 11. Registro de execução (preencher só quando executado)

| Campo | Valor |
|---|---|
| GO do proprietário (texto e data/hora UTC) | não executado |
| Caminho (A runner / B conector) | não executado |
| `system_identifier` e vínculo Vercel ↔ Supabase | não executado |
| Histórico antes (concluídas, falhas, última) | não executado |
| SHA-256 calculado no §4.3 | não executado |
| Evidência de backup/PITR | não executado |
| Classificador e `premerge-migrate` | não executado |
| Resultado da transação | não executado |
| Conferência do §6 (itens 1 a 11) | não executado |
| Commit de merge e deployment | não executado |
| Smoke | não executado |

## 12. Referências

- Decisões: [D-PROD-154, D-PROD-74, D-PROD-75 e D-PROD-56](./DECISIONS.md).
- Registros das releases anteriores: [P1 §9](./MAIKE-GESTAO-CADASTROS-P1-REPORT.md),
  [P2 §10 e §12](./MAIKE-GESTAO-CADASTROS-P2-NATUREZAS-REPORT.md),
  [S04-P1 §13](./MAIKE-SAAS-ADMIN-S04-P1-REVOGACAO-SESSOES.md) e
  [S04-P2 §11](./MAIKE-SAAS-ADMIN-S04-P2-TROCA-SENHA-INICIAL.md).
- Runner e bibliotecas: [`premerge-migrate.mjs`](../../scripts/deploy/premerge-migrate.mjs),
  [`premergeMigrateLib.mjs`](../../scripts/deploy/premergeMigrateLib.mjs),
  [`conferir-alvo-banco.mjs`](../../scripts/deploy/conferir-alvo-banco.mjs),
  [`preflightSchemaLib.mjs`](../../scripts/deploy/preflightSchemaLib.mjs) e
  [`release-migrate.yml`](../../.github/workflows/release-migrate.yml).
- RLS e grants: [P8 — grants e RLS](./P8-SUPABASE-PUBLIC-GRANTS-RLS-REPORT.md).
- Runbook da PR #174: [`MAIKE-PR174-RELEASE-CUTOVER-RUNBOOK.md`](./MAIKE-PR174-RELEASE-CUTOVER-RUNBOOK.md).
