-- MAIKE-TIPO-TAREFA-DROP-COLUNAS (Fatia LIMPEZA) — remoção física das 4 colunas
-- dormentes de TipoTarefa. Decisão, runbook e relatório em docs/engineering/
-- (MAIKE-TIPO-TAREFA-DROP-COLUNAS-*.md). O número da decisão fica FORA deste
-- arquivo de propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- As colunas: exige_area, pode_ter_produto, pode_ter_maquina e
-- pode_ter_implemento. Elas saíram do cadastro na D-PROD-181 (Prisma Client, API, porta e
-- formulário) e ficaram no banco, sem leitor nem escritor, à espera desta
-- remoção com GO próprio. As opções equivalentes voltam depois no
-- APONTAMENTO, nunca no cadastro.
--
-- MODO CONTRACT (segunda exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7,
-- depois da D-PROD-162): esta migration APAGA as 4 colunas, com os
-- valores gravados nelas, em TODOS os clientes. O classificador do premerge só
-- a aceita pela entrada fechada de MIGRATIONS_CONTRACT_APROVADAS: guarda DO com
-- hash pinado como PRIMEIRA instrução e, depois, exatamente estes 4
-- ALTER TABLE … DROP COLUMN, nesta ordem e com texto pinado. Nenhuma tabela é
-- criada nem apagada; nenhuma outra tabela é tocada.
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação;
--  - pg_advisory_xact_lock(72707369), a mesma trava do prisma migrate;
--  - TipoTarefa existe e está travada em ACCESS EXCLUSIVE antes de contar;
--  - as 4 colunas existem, cada uma BOOLEAN NOT NULL DEFAULT false (se faltar
--    alguma, a migration já rodou ou o schema está fora do esperado);
--  - nenhum objeto depende das 4 colunas além do próprio DEFAULT: índice,
--    constraint, visão/regra, política, gatilho, estatística ou publicação
--    seriam apagados em silêncio ou fariam o DROP falhar;
--  - nenhuma função ou procedure de schema não-sistema cita as colunas no corpo
--    (gatilho ou rotina criada fora das migrations quebraria depois do DROP);
--  - com algum valor true nas 4 colunas (ou com o parâmetro informado): exige
--    maike.tipo_tarefa_flags_impressao igual à impressão aprovada no GO
--    (preflight do runbook: id e as 4 flags das linhas com algum true, por
--    cliente). Sem nenhum true não há o que perder e o parâmetro é dispensado.
--
-- Reversão: não há reversão automática. Os valores apagados só voltam do
-- backup anotado no runbook; as colunas voltariam vazias (DEFAULT false) por
-- uma migration EXPAND nova, nunca editando esta.

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  colunas constant text[] := ARRAY['exige_area','pode_ter_produto','pode_ter_maquina','pode_ter_implemento'];
  tabela oid;
  n_colunas int;
  numeros smallint[];
  dependentes text;
  rotinas text;
  linhas text[];
  total bigint;
  impressao text;
  esperada text := nullif(current_setting('maike.tipo_tarefa_flags_impressao', true), '');
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  tabela := to_regclass('public."TipoTarefa"');
  IF tabela IS NULL THEN
    RAISE EXCEPTION 'tipo_tarefa_drop_colunas: a tabela public.TipoTarefa não existe: schema fora do esperado; nada foi alterado';
  END IF;
  LOCK TABLE public."TipoTarefa" IN ACCESS EXCLUSIVE MODE;
  SELECT count(*), array_agg(a.attnum ORDER BY a.attnum) INTO n_colunas, numeros
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = tabela AND a.attname = ANY (colunas) AND NOT a.attisdropped
     AND a.atttypid = 'boolean'::regtype AND a.attnotnull
     AND pg_get_expr(d.adbin, d.adrelid) = 'false';
  IF n_colunas <> 4 THEN
    RAISE EXCEPTION 'tipo_tarefa_drop_colunas: TipoTarefa tem % das 4 colunas BOOLEAN NOT NULL DEFAULT false: migration já aplicada ou schema fora do esperado; nada foi alterado', n_colunas;
  END IF;
  SELECT string_agg(DISTINCT pg_describe_object(dp.classid, dp.objid, dp.objsubid), ', ') INTO dependentes
    FROM pg_depend dp
   WHERE dp.refclassid = 'pg_class'::regclass AND dp.refobjid = tabela AND dp.refobjsubid = ANY (numeros)
     AND NOT (dp.classid = 'pg_attrdef'::regclass
              AND dp.objid IN (SELECT d.oid FROM pg_attrdef d WHERE d.adrelid = tabela AND d.adnum = dp.refobjsubid));
  IF dependentes IS NOT NULL THEN
    RAISE EXCEPTION 'tipo_tarefa_drop_colunas: objeto depende das colunas apagadas (%): o DROP o apagaria em silêncio ou falharia; nada foi alterado', dependentes;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO rotinas
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg\_%'
     AND p.prosrc ~ '(exige_area|pode_ter_produto|pode_ter_maquina|pode_ter_implemento)';
  IF rotinas IS NOT NULL THEN
    RAISE EXCEPTION 'tipo_tarefa_drop_colunas: função ou procedure cita as colunas apagadas (%): quebraria depois do DROP; nada foi alterado', rotinas;
  END IF;
  SELECT coalesce(array_agg(t.cliente_id || '|' || t.id || '|' || t.exige_area || '|' || t.pode_ter_produto || '|' || t.pode_ter_maquina || '|' || t.pode_ter_implemento
                            ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[]),
         count(*)
    INTO linhas, total
    FROM public."TipoTarefa" t
   WHERE t.exige_area OR t.pode_ter_produto OR t.pode_ter_maquina OR t.pode_ter_implemento;
  impressao := left(md5(array_to_string(linhas, E'\n')), 12);
  IF (total > 0 OR esperada IS NOT NULL) AND esperada IS DISTINCT FROM impressao THEN
    RAISE EXCEPTION 'tipo_tarefa_drop_colunas: os valores true das colunas apagadas (% tipos de tarefa) não são os aprovados no GO (maike.tipo_tarefa_flags_impressao = %): refaça o preflight e peça novo GO; nada foi alterado', total, coalesce(esperada, 'ausente');
  END IF;
END $$;

-- 2. Contração: as 4 colunas, nesta ordem, sem CASCADE e sem IF EXISTS (uma
-- dependência inesperada faz o DROP falhar e desfaz tudo).
ALTER TABLE "TipoTarefa" DROP COLUMN "exige_area";
ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_produto";
ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_maquina";
ALTER TABLE "TipoTarefa" DROP COLUMN "pode_ter_implemento";
