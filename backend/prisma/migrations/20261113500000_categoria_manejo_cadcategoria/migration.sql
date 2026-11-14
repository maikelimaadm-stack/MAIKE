-- MAIKE-CATEGORIA-MANEJO-CADCATEGORIA (Fatia D) — remoção física das 15
-- colunas dormentes de CategoriaManejo e do vínculo com o ícone oficial
-- (catalogo_categoria_visual_id, com a FK e o índice), e troca do nome físico
-- da tabela para CADCATEGORIA. Decisão, runbook e relatório em
-- docs/engineering/ (MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-*.md). O número da
-- decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca muda
-- o checksum aplicado.
--
-- As colunas: raca, categoria_oficial, ganho_peso_anual_kg e gmd_janeiro …
-- gmd_dezembro saíram do cadastro na Fatia C (Prisma Client com @ignore, API,
-- porta e formulário) e ficaram no banco, sem leitor nem escritor, à espera
-- desta remoção com GO próprio. O vínculo com o ícone oficial do catálogo
-- global (catalogo_categoria_visual_id) sai do cadastro e do banco junto, por
-- emenda do proprietário. O model Prisma continua CategoriaManejo, agora com
-- @@map para CADCATEGORIA; os nomes de pkey, unique, índice e FK que ficam são
-- renomeados para os que o Prisma espera com o nome novo.
--
-- MODO CONTRACT (terceira exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7,
-- depois da D-PROD-162 e da D-PROD-183): esta migration APAGA as 16 colunas,
-- com os valores gravados nelas, em TODOS os clientes, e renomeia a tabela. O
-- classificador do premerge só a aceita pela entrada fechada de
-- MIGRATIONS_CONTRACT_APROVADAS: guarda DO com hash pinado como PRIMEIRA
-- instrução e, depois, exatamente as 23 instruções abaixo, nesta ordem e com
-- texto pinado. Nenhuma tabela é criada nem apagada; nenhuma outra tabela é
-- tocada (CatalogoCategoriaVisual só deixa de ser referenciada pela FK).
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação;
--  - pg_advisory_xact_lock(72707369), a mesma trava do prisma migrate;
--  - CategoriaManejo existe, CADCATEGORIA não existe (nem como tipo), e a
--    tabela está travada em ACCESS EXCLUSIVE antes de contar;
--  - as 16 colunas existem com o tipo esperado, anuláveis, sem DEFAULT, sem
--    identidade e não geradas (se faltar alguma, a migration já rodou ou o
--    schema está fora do esperado);
--  - os índices são exatamente os 4 de hoje e as constraints (fora NOT NULL)
--    exatamente as 3 de hoje; nenhum dos 3 nomes novos de índice está ocupado;
--  - nenhum objeto depende das 16 colunas além do índice e da FK do ícone, que
--    esta migration remove explicitamente antes do DROP COLUMN;
--  - nenhuma função ou procedure de schema não-sistema cita o nome físico da
--    tabela ou as 16 colunas no corpo ou nos parâmetros de saída, sem
--    distinguir maiúsculas (rotina criada fora das migrations quebraria
--    depois);
--  - com algum valor nas 16 colunas (ou com o parâmetro informado): exige
--    maike.categoria_manejo_legado_impressao igual à impressão aprovada no GO
--    (preflight do runbook: cliente_id, id e os 16 valores das linhas com
--    algum valor). Sem nenhum valor não há o que perder e o parâmetro é
--    dispensado.
--
-- Reversão: não há reversão automática. Os valores apagados só voltam do
-- backup anotado no runbook; as colunas voltariam vazias e o nome antigo só
-- com uma migration nova, nunca editando esta.

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  colunas constant text[] := ARRAY['raca', 'categoria_oficial', 'ganho_peso_anual_kg', 'gmd_janeiro', 'gmd_fevereiro', 'gmd_marco', 'gmd_abril', 'gmd_maio', 'gmd_junho', 'gmd_julho', 'gmd_agosto', 'gmd_setembro', 'gmd_outubro', 'gmd_novembro', 'gmd_dezembro', 'catalogo_categoria_visual_id'];
  tipos constant text[] := ARRAY['character varying(128)', 'character varying(128)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'numeric(14,4)', 'character varying(64)'];
  indices_antigos constant text[] := ARRAY['CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx', 'CategoriaManejo_cliente_id_empresa_id_idx', 'CategoriaManejo_cliente_id_id_key', 'CategoriaManejo_pkey'];
  constraints_antigas constant text[] := ARRAY['CategoriaManejo_catalogo_categoria_visual_id_fkey', 'CategoriaManejo_cliente_id_fkey', 'CategoriaManejo_pkey'];
  indices_novos constant text[] := ARRAY['CADCATEGORIA_pkey', 'CADCATEGORIA_cliente_id_id_key', 'CADCATEGORIA_cliente_id_empresa_id_idx'];
  tabela oid;
  n_colunas int;
  numeros smallint[];
  num_icone smallint;
  achados text[];
  ocupados text;
  dependentes text;
  rotinas text;
  linhas text[];
  total bigint;
  impressao text;
  esperada text := nullif(current_setting('maike.categoria_manejo_legado_impressao', true), '');
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  tabela := to_regclass('public."CategoriaManejo"');
  IF tabela IS NULL THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: a tabela public.CategoriaManejo não existe: migration já aplicada ou schema fora do esperado; nada foi alterado';
  END IF;
  IF to_regclass('public."CADCATEGORIA"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_type y WHERE y.typnamespace = 'public'::regnamespace AND y.typname = 'CADCATEGORIA') THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: o nome public.CADCATEGORIA já está ocupado: o RENAME falharia; nada foi alterado';
  END IF;
  LOCK TABLE public."CategoriaManejo" IN ACCESS EXCLUSIVE MODE;
  SELECT count(*), array_agg(a.attnum ORDER BY a.attnum) INTO n_colunas, numeros
    FROM pg_attribute a
    JOIN unnest(colunas, tipos) AS e(nome, tipo) ON e.nome = a.attname
   WHERE a.attrelid = tabela AND a.attnum > 0 AND NOT a.attisdropped
     AND format_type(a.atttypid, a.atttypmod) = e.tipo AND NOT a.attnotnull
     AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = '';
  IF n_colunas <> 16 THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: CategoriaManejo tem % das 16 colunas anuláveis com o tipo esperado: migration já aplicada ou schema fora do esperado; nada foi alterado', n_colunas;
  END IF;
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname::text COLLATE "C"), ARRAY[]::text[]) INTO achados
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = tabela;
  IF achados IS DISTINCT FROM indices_antigos THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: os índices de CategoriaManejo (%) não são os 4 esperados: schema fora do esperado; nada foi alterado', array_to_string(achados, ', ');
  END IF;
  SELECT coalesce(array_agg(k.conname::text ORDER BY k.conname::text COLLATE "C"), ARRAY[]::text[]) INTO achados
    FROM pg_constraint k
   WHERE k.conrelid = tabela AND k.contype <> 'n';
  IF achados IS DISTINCT FROM constraints_antigas THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: as constraints de CategoriaManejo (%) não são as 3 esperadas: schema fora do esperado; nada foi alterado', array_to_string(achados, ', ');
  END IF;
  SELECT string_agg(n, ', ' ORDER BY n) INTO ocupados
    FROM unnest(indices_novos) AS n
   WHERE to_regclass(format('public.%I', n)) IS NOT NULL;
  IF ocupados IS NOT NULL THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: nome novo de índice já ocupado (%): o RENAME falharia; nada foi alterado', ocupados;
  END IF;
  SELECT a.attnum INTO num_icone
    FROM pg_attribute a
   WHERE a.attrelid = tabela AND a.attname = 'catalogo_categoria_visual_id' AND NOT a.attisdropped;
  SELECT string_agg(DISTINCT pg_describe_object(dp.classid, dp.objid, dp.objsubid), ', ') INTO dependentes
    FROM pg_depend dp
   WHERE dp.refclassid = 'pg_class'::regclass AND dp.refobjid = tabela AND dp.refobjsubid = ANY (numeros)
     AND NOT (dp.refobjsubid = num_icone AND dp.classid = 'pg_class'::regclass
              AND dp.objid IN (SELECT i.indexrelid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                                WHERE i.indrelid = tabela AND c.relname = 'CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx'))
     AND NOT (dp.refobjsubid = num_icone AND dp.classid = 'pg_constraint'::regclass
              AND dp.objid IN (SELECT k.oid FROM pg_constraint k
                                WHERE k.conrelid = tabela AND k.conname = 'CategoriaManejo_catalogo_categoria_visual_id_fkey'));
  IF dependentes IS NOT NULL THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: objeto depende das colunas apagadas (%): o DROP o apagaria em silêncio ou falharia; nada foi alterado', dependentes;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO rotinas
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg\_%'
     AND (p.prosrc || ' ' || coalesce(array_to_string(p.proargnames, ' '), '')) ~* '\m(categoriamanejo|raca|categoria_oficial|ganho_peso_anual_kg|gmd_(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|catalogo_categoria_visual_id)\M';
  IF rotinas IS NOT NULL THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: função ou procedure cita a tabela pelo nome físico antigo ou as colunas apagadas (%): quebraria depois; nada foi alterado', rotinas;
  END IF;
  SELECT coalesce(array_agg(concat_ws('|', t.cliente_id, t.id, quote_nullable(t.raca), quote_nullable(t.categoria_oficial), quote_nullable(t.ganho_peso_anual_kg), quote_nullable(t.gmd_janeiro), quote_nullable(t.gmd_fevereiro), quote_nullable(t.gmd_marco), quote_nullable(t.gmd_abril), quote_nullable(t.gmd_maio), quote_nullable(t.gmd_junho), quote_nullable(t.gmd_julho), quote_nullable(t.gmd_agosto), quote_nullable(t.gmd_setembro), quote_nullable(t.gmd_outubro), quote_nullable(t.gmd_novembro), quote_nullable(t.gmd_dezembro), quote_nullable(t.catalogo_categoria_visual_id))
                            ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[]),
         count(*)
    INTO linhas, total
    FROM public."CategoriaManejo" t
   WHERE num_nonnulls(t.raca, t.categoria_oficial, t.ganho_peso_anual_kg, t.gmd_janeiro, t.gmd_fevereiro, t.gmd_marco, t.gmd_abril, t.gmd_maio, t.gmd_junho, t.gmd_julho, t.gmd_agosto, t.gmd_setembro, t.gmd_outubro, t.gmd_novembro, t.gmd_dezembro, t.catalogo_categoria_visual_id) > 0;
  impressao := left(md5(array_to_string(linhas, E'\n')), 12);
  IF (total > 0 OR esperada IS NOT NULL) AND esperada IS DISTINCT FROM impressao THEN
    RAISE EXCEPTION 'categoria_manejo_cadcategoria: os valores das colunas apagadas (% categorias de manejo) não são os aprovados no GO (maike.categoria_manejo_legado_impressao = %): refaça o preflight e peça novo GO; nada foi alterado', total, coalesce(esperada, 'ausente');
  END IF;
END $$;

-- 2. Vínculo com o ícone oficial: a FK e o índice saem explicitamente, antes
-- da coluna (sem CASCADE e sem IF EXISTS).
ALTER TABLE "CategoriaManejo" DROP CONSTRAINT "CategoriaManejo_catalogo_categoria_visual_id_fkey";
DROP INDEX "CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx";

-- 3. Contração: as 16 colunas, nesta ordem, sem CASCADE e sem IF EXISTS (uma
-- dependência inesperada faz o DROP falhar e desfaz tudo).
ALTER TABLE "CategoriaManejo" DROP COLUMN "raca";
ALTER TABLE "CategoriaManejo" DROP COLUMN "categoria_oficial";
ALTER TABLE "CategoriaManejo" DROP COLUMN "ganho_peso_anual_kg";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_janeiro";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_fevereiro";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_marco";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_abril";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_maio";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_junho";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_julho";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_agosto";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_setembro";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_outubro";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_novembro";
ALTER TABLE "CategoriaManejo" DROP COLUMN "gmd_dezembro";
ALTER TABLE "CategoriaManejo" DROP COLUMN "catalogo_categoria_visual_id";

-- 4. Nome físico novo da tabela e dos objetos que ficam (os que o Prisma
-- espera com @@map("CADCATEGORIA")). O OID, as linhas, a RLS, as políticas e
-- os grants são os mesmos.
ALTER TABLE "CategoriaManejo" RENAME TO "CADCATEGORIA";
ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_pkey" TO "CADCATEGORIA_pkey";
ALTER INDEX "CategoriaManejo_cliente_id_id_key" RENAME TO "CADCATEGORIA_cliente_id_id_key";
ALTER INDEX "CategoriaManejo_cliente_id_empresa_id_idx" RENAME TO "CADCATEGORIA_cliente_id_empresa_id_idx";
ALTER TABLE "CADCATEGORIA" RENAME CONSTRAINT "CategoriaManejo_cliente_id_fkey" TO "CADCATEGORIA_cliente_id_fkey";
