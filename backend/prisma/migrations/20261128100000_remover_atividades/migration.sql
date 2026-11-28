-- D-PROD-383 — MAIKE Atividades: o domínio das atividades sai inteiro para recomeçar do zero.
-- Decisão do proprietário (2026-11-28): apagar código e dados das atividades (Lançamento de Atividades e
-- lançamentos de máquina, produto, mão de obra e serviço, áreas da atividade, plantio, misturas), dos tipos de
-- atividade, do cadastro de Serviços e da reforma de pastagem (Planejamento). O Grupo de atividade FICA (é das
-- tarefas). A estrutura nova vem depois, em missões próprias.
--
-- MODO CONTRACT (exceção aprovada pelo proprietário, registrada na D-PROD-383): esta migration APAGA as 16 tabelas
-- abaixo (com o que houver nelas, em TODOS os clientes) e tira de "AbastecimentoBem" o vínculo com a atividade
-- (CHECK, 2 FKs, 2 índices e as colunas "atividade_id" e "apontamento_id"). O classificador do premerge só a aceita
-- pela entrada fechada de MIGRATIONS_CONTRACT_APROVADAS: guarda DO com hash pinado como PRIMEIRA instrução, depois
-- exatamente as 7 instruções em "AbastecimentoBem" (texto pinado) e, por último (`drop_no_fim`: as FKs de
-- "AbastecimentoBem" para as tabelas que saem só caem nas instruções anteriores), exatamente os 16 DROP TABLE, nesta
-- ordem (filhas antes das mães, sem CASCADE). Nada é criado.
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação; pg_advisory_xact_lock(72707369), a mesma trava do
--    prisma migrate;
--  - as 16 tabelas existem e "AbastecimentoBem" ainda tem "atividade_id" e "apontamento_id";
--  - LOCK das 16 e de "AbastecimentoBem" em ACCESS EXCLUSIVE antes de contar;
--  - o papel da conexão é o dono das 16;
--  - recusa se houver abastecimento ligado a atividade (o vínculo some sem volta);
--  - com linhas nas 16 (ou com o parâmetro informado): exige maike.remover_atividades_impressao igual à impressão
--    das contagens por tabela e cliente aprovada no GO (preflight do runbook);
--  - recusa se alguma FK de FORA das 16 apontar para elas (além das 2 de "AbastecimentoBem", que caem aqui), ou se
--    houver visão/regra dependente, gatilho, política ou publicação criados fora das migrations.
-- Resíduos sem FK ficam como histórico (AuditLog, OperacaoIdempotente, EntidadeCodigoSequencia das atividades e as
-- linhas antigas de Permissao.permissoes_telas das telas que saíram).

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  apagadas constant text[] := ARRAY['AtividadePlantio','AtividadeApontamentoProdutoConsumoLote','AtividadeApontamentoMaquina','AtividadeApontamentoMaoObra','AtividadeApontamentoServico','AtividadeMisturaItem','AtividadeMisturaMovimento','PlanejamentoArea','AtividadeApontamentoProduto','Servico','AtividadeMistura','AtividadeApontamento','AtividadeArea','Atividade','TipoAtividade','Planejamento'];
  tbl text;
  oids oid[];
  n_ligados bigint;
  externas text;
  dependentes text;
  estranhos text;
  parte text[];
  linhas text[] := ARRAY[]::text[];
  subtotal bigint;
  total bigint := 0;
  impressao text;
  esperada text := nullif(current_setting('maike.remover_atividades_impressao', true), '');
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  FOREACH tbl IN ARRAY apagadas
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE EXCEPTION 'D-PROD-383: a tabela public.% não existe: schema fora do esperado; nada foi alterado', tbl;
    END IF;
  END LOOP;
  IF to_regclass('public."AbastecimentoBem"') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public."AbastecimentoBem"') AND attname = 'atividade_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public."AbastecimentoBem"') AND attname = 'apontamento_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'D-PROD-383: public.AbastecimentoBem sem atividade_id/apontamento_id: migration já aplicada ou schema fora do esperado; nada foi alterado';
  END IF;
  LOCK TABLE public."AbastecimentoBem", public."AtividadePlantio", public."AtividadeApontamentoProdutoConsumoLote", public."AtividadeApontamentoMaquina", public."AtividadeApontamentoMaoObra", public."AtividadeApontamentoServico", public."AtividadeMisturaItem", public."AtividadeMisturaMovimento", public."PlanejamentoArea", public."AtividadeApontamentoProduto", public."Servico", public."AtividadeMistura", public."AtividadeApontamento", public."AtividadeArea", public."Atividade", public."TipoAtividade", public."Planejamento" IN ACCESS EXCLUSIVE MODE;
  SELECT array_agg(c.oid) INTO oids
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = ANY (apagadas);
  SELECT string_agg(c.relname || '=' || pg_get_userbyid(c.relowner), ', ' ORDER BY c.relname) INTO estranhos
    FROM pg_class c
   WHERE c.oid = ANY (oids) AND pg_get_userbyid(c.relowner) <> current_user;
  IF estranhos IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-383: o papel da conexão (%) não é o dono das tabelas apagadas (%); nada foi alterado', current_user, estranhos;
  END IF;
  SELECT count(*) INTO n_ligados FROM public."AbastecimentoBem" WHERE "atividade_id" IS NOT NULL OR "apontamento_id" IS NOT NULL;
  IF n_ligados > 0 THEN
    RAISE EXCEPTION 'D-PROD-383: há % abastecimento(s) ligado(s) a atividade: o vínculo sumiria sem volta; peça novo GO; nada foi alterado', n_ligados;
  END IF;
  FOREACH tbl IN ARRAY apagadas
  LOOP
    EXECUTE format('SELECT coalesce(array_agg(%L || ''|'' || s.cliente_id || ''|'' || s.n ORDER BY s.cliente_id COLLATE "C"), ARRAY[]::text[]), coalesce(sum(s.n), 0) FROM (SELECT cliente_id, count(*) AS n FROM public.%I GROUP BY cliente_id) s', tbl, tbl)
      INTO parte, subtotal;
    linhas := linhas || parte;
    total := total + subtotal;
  END LOOP;
  impressao := left(md5(array_to_string(linhas, E'\n')), 12);
  IF (total > 0 OR esperada IS NOT NULL) AND esperada IS DISTINCT FROM impressao THEN
    RAISE EXCEPTION 'D-PROD-383: as contagens das tabelas apagadas (% linhas) não são as aprovadas no GO (maike.remover_atividades_impressao = %, calculada %): refaça o preflight e peça novo GO; nada foi alterado', total, coalesce(esperada, 'ausente'), impressao;
  END IF;
  SELECT string_agg(k.conrelid::regclass::text || '.' || k.conname, ', ' ORDER BY k.conname) INTO externas
    FROM pg_constraint k
   WHERE k.contype = 'f' AND k.confrelid = ANY (oids) AND NOT (k.conrelid = ANY (oids))
     AND NOT (k.conrelid = to_regclass('public."AbastecimentoBem"') AND k.conname IN ('AbastecimentoBem_atividade_fkey', 'AbastecimentoBem_apontamento_fkey'));
  IF externas IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-383: FK de fora das atividades aponta para as tabelas apagadas (%); nada foi alterado', externas;
  END IF;
  SELECT string_agg(DISTINCT r.ev_class::regclass::text, ', ') INTO dependentes
    FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
   WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = ANY (oids) AND NOT (r.ev_class = ANY (oids));
  IF dependentes IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-383: visão ou regra depende das tabelas apagadas (%); nada foi alterado', dependentes;
  END IF;
  SELECT string_agg(x.objeto, ', ' ORDER BY x.objeto) INTO estranhos
    FROM (SELECT t.tgrelid::regclass::text || ' gatilho ' || t.tgname AS objeto FROM pg_trigger t WHERE t.tgrelid = ANY (oids) AND NOT t.tgisinternal
          UNION ALL SELECT p.polrelid::regclass::text || ' política ' || p.polname FROM pg_policy p WHERE p.polrelid = ANY (oids) AND p.polname <> 'maike_backend_all'
          UNION ALL SELECT pr.prrelid::regclass::text || ' publicação ' || pb.pubname FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid = pr.prpubid WHERE pr.prrelid = ANY (oids)) x;
  IF estranhos IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-383: objeto criado fora das migrations nas tabelas apagadas (%): o DROP o apagaria em silêncio; nada foi alterado', estranhos;
  END IF;
END $$;

-- 2. "AbastecimentoBem" sem o vínculo com a atividade (a única tabela antiga alterada; nenhuma linha muda: a guarda
-- exigiu as duas colunas vazias).
ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_atividade_check";
ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_apontamento_fkey";
ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_atividade_fkey";
DROP INDEX "AbastecimentoBem_apontamento_idx";
DROP INDEX "AbastecimentoBem_atividade_idx";
ALTER TABLE "AbastecimentoBem" DROP COLUMN "apontamento_id";
ALTER TABLE "AbastecimentoBem" DROP COLUMN "atividade_id";

-- 3. Contração: filhas antes das mães, sem CASCADE (uma dependência inesperada faz o DROP falhar e desfaz tudo).
DROP TABLE "AtividadePlantio";
DROP TABLE "AtividadeApontamentoProdutoConsumoLote";
DROP TABLE "AtividadeApontamentoMaquina";
DROP TABLE "AtividadeApontamentoMaoObra";
DROP TABLE "AtividadeApontamentoServico";
DROP TABLE "AtividadeMisturaItem";
DROP TABLE "AtividadeMisturaMovimento";
DROP TABLE "PlanejamentoArea";
DROP TABLE "AtividadeApontamentoProduto";
DROP TABLE "Servico";
DROP TABLE "AtividadeMistura";
DROP TABLE "AtividadeApontamento";
DROP TABLE "AtividadeArea";
DROP TABLE "Atividade";
DROP TABLE "TipoAtividade";
DROP TABLE "Planejamento";
