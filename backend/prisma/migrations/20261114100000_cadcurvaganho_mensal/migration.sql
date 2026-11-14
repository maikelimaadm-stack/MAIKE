-- MAIKE-CADCURVAGANHO-MENSAL — a Curva de Ganho de Peso passa a ter 12 GMD
-- (kg/dia), um por mês do calendário (janeiro a dezembro), no lugar dos 3 GMD
-- por tipo de estação (ÁGUAS, TRANSIÇÃO e SECA) da primeira fatia. A curva
-- deixa de depender das Estações (CADESTACOES segue como cadastro próprio).
-- Decisão, runbook e relatório em docs/engineering/
-- (MAIKE-CADCURVAGANHO-MENSAL-*.md). O número da decisão fica FORA deste
-- arquivo de propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- MODO CONTRACT (exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7): esta
-- migration APAGA a tabela "CADCURVAGANHO" e a cria de novo com a estrutura
-- mensal. Só é aceita VAZIA: a guarda recusa se houver qualquer curva, então
-- nenhum dado é perdido. O classificador do premerge só a aceita pela entrada
-- fechada de MIGRATIONS_CONTRACT_APROVADAS: guarda DO com hash pinado como
-- PRIMEIRA instrução, depois EXATAMENTE o DROP TABLE "CADCURVAGANHO" e, no
-- resto, só o que a allowlist EXPAND aceita para a tabela recriada.
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação;
--  - pg_advisory_xact_lock(72707369), a mesma trava do prisma migrate;
--  - CADCURVAGANHO existe e está travada em ACCESS EXCLUSIVE antes de contar;
--  - a estrutura é a da primeira fatia: as 3 colunas gmd_aguas,
--    gmd_transicao e gmd_seca, e nenhuma outra coluna gmd_* (se não, a
--    migration já rodou ou o schema está fora do esperado);
--  - a tabela está VAZIA (nenhuma curva cadastrada);
--  - nenhuma FK de outra tabela aponta para ela, nenhum gatilho de usuário e
--    nenhuma política além de maike_backend_all (o DROP os apagaria em
--    silêncio);
--  - nenhuma função ou procedure de schema não-sistema cita as 3 colunas
--    antigas, sem distinguir maiúsculas (quebraria depois da troca).
--
-- Reversão: não há reversão automática. Como a tabela sai e volta vazia, voltar
-- à estrutura por estação seria uma migration nova, nunca editando esta.

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  tabela oid;
  n_antigas int;
  n_outras int;
  curvas bigint;
  referencias text;
  gatilhos text;
  politicas text;
  rotinas text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  tabela := to_regclass('public."CADCURVAGANHO"');
  IF tabela IS NULL THEN
    RAISE EXCEPTION 'cadcurvaganho_mensal: a tabela public.CADCURVAGANHO não existe: schema fora do esperado; nada foi alterado';
  END IF;
  LOCK TABLE public."CADCURVAGANHO" IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) FILTER (WHERE a.attname IN ('gmd_aguas', 'gmd_transicao', 'gmd_seca')),
         count(*) FILTER (WHERE a.attname LIKE 'gmd%' AND a.attname NOT IN ('gmd_aguas', 'gmd_transicao', 'gmd_seca'))
    INTO n_antigas, n_outras
    FROM pg_attribute a
   WHERE a.attrelid = tabela AND a.attnum > 0 AND NOT a.attisdropped;
  IF n_antigas <> 3 OR n_outras <> 0 THEN
    RAISE EXCEPTION 'cadcurvaganho_mensal: CADCURVAGANHO tem % das 3 colunas por estação e % outras colunas gmd: migration já aplicada ou schema fora do esperado; nada foi alterado', n_antigas, n_outras;
  END IF;
  SELECT count(*) INTO curvas FROM public."CADCURVAGANHO";
  IF curvas <> 0 THEN
    RAISE EXCEPTION 'cadcurvaganho_mensal: CADCURVAGANHO tem % curvas cadastradas: esta migration só troca a estrutura da tabela vazia; nada foi alterado', curvas;
  END IF;
  SELECT string_agg(k.conname || ' em ' || k.conrelid::regclass::text, ', ' ORDER BY k.conname) INTO referencias
    FROM pg_constraint k
   WHERE k.confrelid = tabela AND k.conrelid <> tabela;
  IF referencias IS NOT NULL THEN
    RAISE EXCEPTION 'cadcurvaganho_mensal: outra tabela referencia CADCURVAGANHO (%): o DROP falharia; nada foi alterado', referencias;
  END IF;
  SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname) INTO gatilhos
    FROM pg_trigger t
   WHERE t.tgrelid = tabela AND NOT t.tgisinternal;
  IF gatilhos IS NOT NULL THEN
    RAISE EXCEPTION 'cadcurvaganho_mensal: gatilho criado fora das migrations em CADCURVAGANHO (%): o DROP o apagaria em silêncio; nada foi alterado', gatilhos;
  END IF;
  SELECT string_agg(p.polname, ', ' ORDER BY p.polname) INTO politicas
    FROM pg_policy p
   WHERE p.polrelid = tabela AND p.polname <> 'maike_backend_all';
  IF politicas IS NOT NULL THEN
    RAISE EXCEPTION 'cadcurvaganho_mensal: política criada fora das migrations em CADCURVAGANHO (%): o DROP a apagaria em silêncio; nada foi alterado', politicas;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO rotinas
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg\_%'
     AND (p.prosrc || ' ' || coalesce(array_to_string(p.proargnames, ' '), '')) ~* '(gmd_aguas|gmd_transicao|gmd_seca)';
  IF rotinas IS NOT NULL THEN
    RAISE EXCEPTION 'cadcurvaganho_mensal: função ou procedure cita as colunas por estação (%): quebraria depois da troca; nada foi alterado', rotinas;
  END IF;
END $$;

-- 2. Contração: a tabela vazia sai, sem CASCADE e sem IF EXISTS (uma
-- dependência inesperada faz o DROP falhar e desfaz tudo).
DROP TABLE "CADCURVAGANHO";

-- 3. A tabela volta com o mesmo nome físico, as mesmas chaves de escopo e os
-- 12 GMD mensais (kg/dia, de -2 a 3; negativo = perda de peso).

-- CreateTable
CREATE TABLE "CADCURVAGANHO" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "gmd_jan" DECIMAL(6,3) NOT NULL,
    "gmd_fev" DECIMAL(6,3) NOT NULL,
    "gmd_mar" DECIMAL(6,3) NOT NULL,
    "gmd_abr" DECIMAL(6,3) NOT NULL,
    "gmd_mai" DECIMAL(6,3) NOT NULL,
    "gmd_jun" DECIMAL(6,3) NOT NULL,
    "gmd_jul" DECIMAL(6,3) NOT NULL,
    "gmd_ago" DECIMAL(6,3) NOT NULL,
    "gmd_set" DECIMAL(6,3) NOT NULL,
    "gmd_out" DECIMAL(6,3) NOT NULL,
    "gmd_nov" DECIMAL(6,3) NOT NULL,
    "gmd_dez" DECIMAL(6,3) NOT NULL,
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CADCURVAGANHO_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CADCURVAGANHO_cliente_id_empresa_id_ativo_idx" ON "CADCURVAGANHO"("cliente_id", "empresa_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_id_key" ON "CADCURVAGANHO"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_empresa_id_nome_key" ON "CADCURVAGANHO"("cliente_id", "empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "CADCURVAGANHO" ADD CONSTRAINT "CADCURVAGANHO_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADCURVAGANHO" ADD CONSTRAINT "CADCURVAGANHO_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Faixa do GMD (kg/dia) em cada mês: de -2 (perda de peso) a 3. O serviço
-- valida antes; o banco é a última barreira.
ALTER TABLE "CADCURVAGANHO" ADD CONSTRAINT "CADCURVAGANHO_gmd_check" CHECK ("gmd_jan" BETWEEN -2 AND 3 AND "gmd_fev" BETWEEN -2 AND 3 AND "gmd_mar" BETWEEN -2 AND 3 AND "gmd_abr" BETWEEN -2 AND 3 AND "gmd_mai" BETWEEN -2 AND 3 AND "gmd_jun" BETWEEN -2 AND 3 AND "gmd_jul" BETWEEN -2 AND 3 AND "gmd_ago" BETWEEN -2 AND 3 AND "gmd_set" BETWEEN -2 AND 3 AND "gmd_out" BETWEEN -2 AND 3 AND "gmd_nov" BETWEEN -2 AND 3 AND "gmd_dez" BETWEEN -2 AND 3);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['CADCURVAGANHO'];
BEGIN
  FOREACH tbl IN ARRAY tabelas
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO maike_vercel USING (true) WITH CHECK (true)', pol_name, tbl);
    END IF;
  END LOOP;
END $$;
