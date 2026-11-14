-- MAIKE-CADCATEGORIA-CURVA-GANHO — a Categoria de Manejo ("CADCATEGORIA") passa a
-- ter uma Curva de Ganho ("CADCURVAGANHO") OBRIGATÓRIA, da MESMA fazenda.
-- Decisão, runbook e relatório em docs/engineering/
-- (MAIKE-CADCATEGORIA-CURVA-GANHO-*.md). O número da decisão fica FORA deste
-- arquivo de propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- MODO CONTRACT (exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7): a
-- coluna nova nasce NOT NULL, então as categorias que já existem são ligadas,
-- na mesma transação, à curva chamada 'CURVA PADRÃO' da própria fazenda
-- (cadastrada pelo proprietário antes desta migration). A FK composta
-- (cliente_id, empresa_id, curva_ganho_id) → CADCURVAGANHO(cliente_id,
-- empresa_id, id) garante tenant e fazenda; ON DELETE RESTRICT barra excluir
-- uma curva em uso. O classificador do premerge só aceita esta migration pela
-- entrada fechada de MIGRATIONS_CONTRACT_APROVADAS: guarda DO com hash pinado
-- como PRIMEIRA instrução, depois EXATAMENTE as instruções pinadas
-- (ADD COLUMN, UPDATE, SET NOT NULL, UNIQUE em CADCURVAGANHO e a FK) e, no
-- resto, só o índice não-único (allowlist EXPAND).
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação;
--  - pg_advisory_xact_lock(72707369), a mesma trava do prisma migrate;
--  - CADCATEGORIA e CADCURVAGANHO existem e ficam travadas antes de contar
--    (CADCURVAGANHO em SHARE: ninguém renomeia nem apaga curva no meio);
--  - CADCATEGORIA ainda não tem a coluna curva_ganho_id (senão a migration já
--    rodou ou o schema está fora do esperado);
--  - TODA fazenda que tem categoria tem EXATAMENTE UMA curva chamada
--    'CURVA PADRÃO' (sem ela, a categoria ficaria sem curva e o NOT NULL
--    falharia; com duas, a escolha seria ambígua).
--
-- Reversão: não há reversão automática. Desfazer seria uma migration nova
-- (DROP da FK, do índice, do UNIQUE e da coluna), nunca editando esta.

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  categorias oid;
  curvas oid;
  n_coluna int;
  sem_padrao bigint;
  com_duas bigint;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  categorias := to_regclass('public."CADCATEGORIA"');
  curvas := to_regclass('public."CADCURVAGANHO"');
  IF categorias IS NULL OR curvas IS NULL THEN
    RAISE EXCEPTION 'cadcategoria_curva_ganho: CADCATEGORIA ou CADCURVAGANHO não existe: schema fora do esperado; nada foi alterado';
  END IF;
  LOCK TABLE public."CADCURVAGANHO" IN SHARE MODE;
  LOCK TABLE public."CADCATEGORIA" IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO n_coluna
    FROM pg_attribute a
   WHERE a.attrelid = categorias AND a.attname = 'curva_ganho_id' AND NOT a.attisdropped;
  IF n_coluna <> 0 THEN
    RAISE EXCEPTION 'cadcategoria_curva_ganho: CADCATEGORIA já tem curva_ganho_id: migration já aplicada ou schema fora do esperado; nada foi alterado';
  END IF;
  SELECT count(*) FILTER (WHERE f.padroes = 0), count(*) FILTER (WHERE f.padroes > 1)
    INTO sem_padrao, com_duas
    FROM (
      SELECT c.cliente_id, c.empresa_id,
             (SELECT count(*) FROM public."CADCURVAGANHO" k
               WHERE k.cliente_id = c.cliente_id AND k.empresa_id = c.empresa_id AND k.nome = 'CURVA PADRÃO') AS padroes
        FROM (SELECT DISTINCT cliente_id, empresa_id FROM public."CADCATEGORIA") c
    ) f;
  IF sem_padrao <> 0 OR com_duas <> 0 THEN
    RAISE EXCEPTION 'cadcategoria_curva_ganho: % fazendas com categoria e sem a CURVA PADRÃO e % com mais de uma: cadastre exatamente uma CURVA PADRÃO em cada fazenda com categoria; nada foi alterado', sem_padrao, com_duas;
  END IF;
END $$;

-- 2. Instruções pinadas, nesta ordem: a coluna, a ligação das categorias que já
-- existem à CURVA PADRÃO da fazenda, o NOT NULL, o UNIQUE que a FK composta
-- exige em CADCURVAGANHO e a FK.
ALTER TABLE "CADCATEGORIA" ADD COLUMN "curva_ganho_id" VARCHAR(64);
UPDATE "CADCATEGORIA" AS c SET "curva_ganho_id" = k."id" FROM "CADCURVAGANHO" AS k WHERE k."cliente_id" = c."cliente_id" AND k."empresa_id" = c."empresa_id" AND k."nome" = 'CURVA PADRÃO';
ALTER TABLE "CADCATEGORIA" ALTER COLUMN "curva_ganho_id" SET NOT NULL;
CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_empresa_id_id_key" ON "CADCURVAGANHO"("cliente_id", "empresa_id", "id");
ALTER TABLE "CADCATEGORIA" ADD CONSTRAINT "CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "curva_ganho_id") REFERENCES "CADCURVAGANHO"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Resto (allowlist EXPAND): o índice não-único da busca por curva.
CREATE INDEX "CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_idx" ON "CADCATEGORIA"("cliente_id", "empresa_id", "curva_ganho_id");
