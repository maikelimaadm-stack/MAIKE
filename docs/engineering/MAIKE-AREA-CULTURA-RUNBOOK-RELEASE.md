# MAIKE — Área ligada à Cultura: runbook de release CONTRACT aditiva + vínculo das áreas (D-PROD-216)

> **Estado: PLANO — aguardando o GO do proprietário.** `SCHEMA_APPLIED_PROD: NÃO`. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`** / **`BACKFILL_BLOCKED`**. Valores entre
> `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-216](./DECISIONS.md) · Relatório:
[`MAIKE-AREA-CULTURA-REPORT.md`](./MAIKE-AREA-CULTURA-REPORT.md).
Precedentes executados: [`MAIKE-CULTURAS-RUNBOOK-RELEASE.md`](./MAIKE-CULTURAS-RUNBOOK-RELEASE.md) §7
(caminho B, a anterior) e a CONTRACT aditiva da D-PROD-197
([`MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md)).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261117000000_area_cultura` |
| Natureza | **CONTRACT aditiva** (entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`, decisão D-PROD-216): coluna anulável `AreaPastagem.cultura_id` VARCHAR(64), UNIQUE `CADCULTURAS(cliente_id, empresa_id, id)`, FK composta `(cliente_id, empresa_id, cultura_id) → CADCULTURAS` `RESTRICT`/`CASCADE` e o índice `(cliente_id, empresa_id, cultura_id)`. Nenhuma linha muda, nenhum DROP, nenhuma tabela nova. É CONTRACT só porque a allowlist EXPAND recusa UNIQUE em tabela antiga e FK de tabela antiga para tabela antiga |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26` |
| Guarda pinada (`guarda_sha256`) | `e60b6bdc95568ba28c0406649d95cd76da6a2394dc3bdfdb1daf06a6469f3da6` |
| `_prisma_migrations` | esperado **63** concluídas, 0 abertas (a última `20261116500000_cadculturas`, D-PROD-215, checksum `37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715`); depois **64**. Recontar no §2 |
| Tabelas em `public` | **95** antes e depois |
| Dados | **Passo separado (§4b)**, depois da migration: as 107 áreas não-infraestrutura da fazenda `cmw13bo4a0003l508adj0rdw2` (cliente `ca98fddc19f711cde8c2a6383`) passam a apontar para a cultura **001** (BRACHIARIA BRIZANTHA CV. MARANDU), uso `Pastagem`, `tipo_pastagem` = nome da cultura |

**Por que antes do merge (D-PROD-72 item 1):** o runtime novo lê `AreaPastagem.cultura_id`
(e a relação com a cultura) em toda leitura de áreas: sem a migration, `/areas-pastagem`
e o Mapa Geral respondem 500. O runtime antigo não conhece a coluna e segue igual com
o banco migrado (coluna anulável, nada muda nas linhas) — **não há janela**. O vínculo
(§4b) pode rodar antes ou depois do merge; com o runtime antigo no ar, a área ligada
só mostra o nome novo em `tipo_pastagem`.

**Efeito durante a transação:** `AreaPastagem` fica em `ACCESS EXCLUSIVE` (a guarda trava
até o COMMIT; o ADD COLUMN anulável sem DEFAULT é só catálogo, e a FK valida 0 linhas
não nulas) e `CADCULTURAS` em `SHARE` para o UNIQUE (11 linhas). Milissegundos; espera
além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.

**PR #303 (D-PROD-214, outra sessão, rascunho):** traz a
`20261116400000_abastecimento_fk_apontamento_atividade` (nome anterior ao desta e ao da
D-PROD-215, já aplicada). As duas são independentes (a #303 só toca AbastecimentoBem).
A guarda abaixo exige **63** concluídas com a anterior `20261116500000_cadculturas`; se a
#303 for aplicada antes, a guarda recusa (64 concluídas) e precisa ser ajustada (64,
mesma anterior por nome mais recente) antes de pedir o GO. Esta não muda nada na #303.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (sessão/direta, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e `DATABASE_URL` do
  mesmo banco (CONTRACT: com `--contract D-PROD-216`):
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-216
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-216 --verificar-alvo
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-216 --aplicar
  ```
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização
  **escrita e específica do proprietário para esta migration**, registrada como
  desvio da D-PROD-74.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- 63, 0
SELECT migration_name, checksum FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261116500000_cadculturas, 37a71c46…
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'AreaPastagem' AND column_name = 'cultura_id';   -- 0
SELECT to_regclass('public."CADCULTURAS_cliente_id_empresa_id_id_key"');  -- null
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 95
-- para o §4b:
SELECT id, codigo, nome, ativo FROM "CADCULTURAS"
 WHERE cliente_id = 'ca98fddc19f711cde8c2a6383' AND empresa_id = 'cmw13bo4a0003l508adj0rdw2' AND codigo = '001';  -- 1 linha, MARANDU, t
SELECT tipo_cultura, tipo_pastagem, count(*) FROM "AreaPastagem"
 WHERE cliente_id = 'ca98fddc19f711cde8c2a6383' AND empresa_id = 'cmw13bo4a0003l508adj0rdw2' GROUP BY 1, 2;  -- Pastagem | Brachiaria | 107
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: CONTRACT`, `contract[0].decisao = D-PROD-216`,
`colunas_adicionadas = ["AreaPastagem.cultura_id"]` e `violacoes: []` (teste B32a).

## 3. Caminho B — uma transação (a migration)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261117000000_area_cultura') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 63 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261116500000_cadculturas'
                    AND checksum = '37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261116500000_cadculturas) não está concluída com o checksum do repositório';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26', now(),
        '20261117000000_area_cultura', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no
rascunho da sessão (`aplicar216.sql`); confira que o trecho do meio é idêntico ao
`migration.sql` antes de usar. A guarda da própria migration (dentro do arquivo)
confere de novo que a coluna, o UNIQUE e a FK não existem e trava `AreaPastagem`.
Qualquer falha desfaz tudo. Confirme pelo §4 que nada mudou, corrija a causa e peça novo GO.

**Ensaio local (2026-11-16):** banco à parte com as 63 migrations da `main`
(`prisma migrate deploy` de uma cópia com as pastas até a `20261116500000_cadculturas`),
semeado com o cliente/fazenda/setor do proprietário (ids iguais), a cultura 001 e 107
áreas `Pastagem/Brachiaria` + 1 curral: com o `system_identifier` de produção recusou
(`RELEASE_BLOCKED: alvo divergente`); com o local, aplicou (63 → 64 / 0, `migrate diff`
vazio, `migrate status` "Database schema is up to date!"); a 2ª execução recusou
(`RELEASE_BLOCKED: migration já registrada`).

## 4. Conferência — somente leitura (depois da migration)

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261117000000_area_cultura';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 64, 0
SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns
 WHERE table_name = 'AreaPastagem' AND column_name = 'cultura_id';  -- character varying, 64, YES
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conname = 'AreaPastagem_cliente_id_empresa_id_cultura_id_fkey';  -- FOREIGN KEY (…) REFERENCES "CADCULTURAS"(…) ON UPDATE CASCADE ON DELETE RESTRICT
SELECT indexname FROM pg_indexes
 WHERE indexname IN ('CADCULTURAS_cliente_id_empresa_id_id_key', 'AreaPastagem_cliente_id_empresa_id_cultura_id_idx');  -- as 2
SELECT count(*) FROM "AreaPastagem" WHERE cultura_id IS NOT NULL;  -- 0 (antes do §4b)
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 95
```

Mais: `get_advisors` (segurança) sem alerta novo.

### 4b. O vínculo das áreas à cultura 001 (DML, uma transação)

Pedido do proprietário: "pastagens tudo brachiaria marandu código 001 da cultura e tipo
tudo pastagem". Só depois do §4, com o GO do proprietário. A guarda confere o alvo, a
migration concluída com o checksum pinado, a cultura 001 ativa e Marandu na fazenda e
exatamente **107** áreas não-infraestrutura, todas sem cultura; o UPDATE confere que tocou
exatamente 107 linhas; um evento `backfill_cultura_area` entra na auditoria
(`request_id = 'd-prod-216-backfill'`). Qualquer divergência → `BACKFILL_BLOCKED` e nada
muda. Script pronto no rascunho da sessão: `backfill216.sql`.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $backfill$
DECLARE
  v_cliente constant text := 'ca98fddc19f711cde8c2a6383';
  v_empresa constant text := 'cmw13bo4a0003l508adj0rdw2';
  v_esperadas constant int := 107;
  v_cultura_id text;
  v_cultura_nome text;
  n_alvo int;
  n_ligadas int;
  n_atualizadas int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'BACKFILL_BLOCKED: alvo divergente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261117000000_area_cultura'
                    AND checksum = 'e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'BACKFILL_BLOCKED: a migration 20261117000000_area_cultura não está concluída com o checksum do repositório';
  END IF;

  SELECT id, nome INTO v_cultura_id, v_cultura_nome
    FROM "CADCULTURAS"
   WHERE cliente_id = v_cliente AND empresa_id = v_empresa AND codigo = '001' AND ativo = true;
  IF v_cultura_id IS NULL THEN
    RAISE EXCEPTION 'BACKFILL_BLOCKED: cultura 001 ativa não encontrada na fazenda';
  END IF;
  IF v_cultura_nome NOT LIKE '%MARANDU%' THEN
    RAISE EXCEPTION 'BACKFILL_BLOCKED: a cultura 001 da fazenda não é Marandu (%)', v_cultura_nome;
  END IF;

  -- Trava as áreas da fazenda até o COMMIT (ninguém grava nelas enquanto o vínculo entra).
  PERFORM 1 FROM "AreaPastagem" WHERE cliente_id = v_cliente AND empresa_id = v_empresa FOR UPDATE;

  SELECT count(*) FILTER (WHERE tipo_cultura <> 'Infraestrutura'),
         count(*) FILTER (WHERE cultura_id IS NOT NULL)
    INTO n_alvo, n_ligadas
    FROM "AreaPastagem" WHERE cliente_id = v_cliente AND empresa_id = v_empresa;
  IF n_alvo <> v_esperadas THEN
    RAISE EXCEPTION 'BACKFILL_BLOCKED: % áreas não-infraestrutura na fazenda, esperado %', n_alvo, v_esperadas;
  END IF;
  IF n_ligadas <> 0 THEN
    RAISE EXCEPTION 'BACKFILL_BLOCKED: % áreas já têm cultura (o passo já rodou ou alguém ligou pela tela)', n_ligadas;
  END IF;

  UPDATE "AreaPastagem"
     SET cultura_id = v_cultura_id,
         tipo_cultura = 'Pastagem',
         tipo_pastagem = v_cultura_nome,
         "updatedAt" = now()
   WHERE cliente_id = v_cliente AND empresa_id = v_empresa AND tipo_cultura <> 'Infraestrutura';
  GET DIAGNOSTICS n_atualizadas = ROW_COUNT;
  IF n_atualizadas <> v_esperadas THEN
    RAISE EXCEPTION 'BACKFILL_BLOCKED: o UPDATE tocou % linhas, esperado %', n_atualizadas, v_esperadas;
  END IF;

  INSERT INTO "AuditLog" (id, cliente_id, usuario_id, acao, entidade, entidade_id, dados_anteriores, dados_novos, request_id, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, v_cliente, NULL, 'backfill_cultura_area', 'AreaPastagem', NULL,
          jsonb_build_object('tipo_pastagem', 'Brachiaria', 'cultura_id', NULL),
          jsonb_build_object('decisao', 'D-PROD-216', 'empresa_id', v_empresa, 'cultura_id', v_cultura_id, 'codigo', '001',
                             'tipo_cultura', 'Pastagem', 'tipo_pastagem', v_cultura_nome, 'total_atualizado', n_atualizadas),
          'd-prod-216-backfill', now(), now());

  RAISE NOTICE 'D-PROD-216 backfill: % áreas ligadas à cultura 001 (%)', n_atualizadas, v_cultura_nome;
END $backfill$;
COMMIT;
```

Conferência (somente leitura):

```sql
-- Postcheck (fora da transação; só leitura).
SELECT a.tipo_cultura, a.tipo_pastagem, c.codigo, count(*) AS areas
  FROM "AreaPastagem" a LEFT JOIN "CADCULTURAS" c ON c.cliente_id = a.cliente_id AND c.id = a.cultura_id
 WHERE a.cliente_id = 'ca98fddc19f711cde8c2a6383' AND a.empresa_id = 'cmw13bo4a0003l508adj0rdw2'
 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
SELECT acao, entidade, dados_novos->>'total_atualizado' AS total, "createdAt"
  FROM "AuditLog" WHERE request_id = 'd-prod-216-backfill';
```

Esperado: `Pastagem | BRACHIARIA BRIZANTHA CV. MARANDU | 001 | 107` (e as áreas de
infraestrutura, se houver, intactas) e 1 evento com `total = 107`.

**Ensaio local (2026-11-16, mesmo banco do §3):** antes da migration recusou
(`BACKFILL_BLOCKED: a migration … não está concluída`); depois, ligou as 107 (o curral
intacto) e gravou o evento; a 2ª execução recusou (`BACKFILL_BLOCKED: 107 áreas já têm
cultura`).

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: abrir **Mapa → Cadastro de Áreas**, conferir a
coluna Cultura "001 · BRACHIARIA BRIZANTHA CV. MARANDU"; abrir uma área e ver o campo
**Cultura** com a lista do cadastro; trocar para 007 e salvar (o nome muda junto); voltar
para 001. Em **Manejo → Culturas**, tentar excluir a 001 → "Esta cultura está ligada a
áreas do mapa…" (409).

## 6. Rollback

Reverter seria uma migration nova (CONTRACT, com GO próprio) com `DROP` da FK, do
índice, do UNIQUE e da coluna — nunca editando esta. O vínculo (§4b) se desfaz com
`UPDATE "AreaPastagem" SET cultura_id = NULL` na fazenda (o texto `tipo_pastagem` fica
com o nome da cultura). Com o código novo no ar, reverter o código primeiro.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | `<…>` |
| Caminho | `<A ou B>` |
| GO | `<texto do proprietário>` |
| Preflight (§2) | `<…>` |
| Postcheck (§4) | `<…>` |
| Vínculo (§4b) | `<…>` |
| Resultado | `<…>` |
