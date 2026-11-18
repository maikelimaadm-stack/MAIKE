-- MAIKE-ATIVIDADE-AREAS — várias áreas por atividade: uma atividade ("Combate à
-- cigarrinha") feita em vários pastos ao longo do tempo, cada lançamento (o
-- apontamento) de UMA área. Tabela nova "AtividadeArea" (as áreas da atividade,
-- com a área planejada e o ciclo de cada uma: PLANEJADA → EM_ANDAMENTO, com a
-- data de início → CONCLUIDA, com a data de conclusão) e a coluna anulável
-- "AtividadeApontamento"."atividade_area_id", com a FK composta que prova que a
-- área do lançamento é DA MESMA atividade. Decisão, contrato, runbook e relatório
-- em docs/engineering/ (MAIKE-ATIVIDADE-AREAS-*.md). O número da decisão fica
-- FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS), no
-- formato CONVERSÃO, nesta ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma
--      migrate (72707369), o estado esperado (as 3 tabelas existem; a tabela nova e
--      a coluna nova ainda não; o alvo (cliente_id, empresa_id, id) de "Atividade"
--      existe) e as travas na ordem do app (a área é lida, a atividade travada e o
--      lançamento gravado): "AreaPastagem" em SHARE ROW EXCLUSIVE (o modo que a FK
--      nova pede nela; o mapa continua lendo), "Atividade" e "AtividadeApontamento"
--      em ACCESS EXCLUSIVE, já no modo mais forte que as instruções pedem nelas
--      (sem subir de trava no meio da transação: subir fecharia ciclo com o
--      lançamento, que trava a atividade e depois grava o apontamento). Depois das
--      travas, aborta se alguma atividade CONCLUIDA com área estiver sem a data de
--      conclusão (a área concluída exige a data);
--   2. a coluna anulável, sem DEFAULT, em "AtividadeApontamento" (texto pinado);
--   3. o resto pela allowlist EXPAND: a tabela nova, os índices, as FKs dela, os
--      CHECKs e o RLS de sempre; o índice não-único da coluna nova;
--   4. a cauda pinada: o backfill (cada atividade com área ganha a área nº 1, com a
--      área planejada, o setor e o autor dela; a área já começou: o início é o da
--      atividade, ou o 1º lançamento, ou o dia da criação; CONCLUIDA, com a data de
--      conclusão, se a atividade está concluída, senão EM_ANDAMENTO — a cancelada
--      também, só leitura; os lançamentos dessas atividades passam a ser dessa área)
--      e, por último, a FK composta do lançamento para a área, validada sobre o que
--      o backfill gravou. Atividade sem área: lançamentos sem área (nulo).
--
-- Nenhuma linha é apagada; nenhuma coluna existente muda de tipo ou de valor.

-- Guarda: falha fechada se o banco não estiver no estado que esta migration conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."Atividade"') IS NULL
     OR to_regclass('public."AtividadeApontamento"') IS NULL
     OR to_regclass('public."AreaPastagem"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "Atividade", "AtividadeApontamento" e "AreaPastagem" têm de existir';
  END IF;
  IF to_regclass('public."AtividadeArea"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'AtividadeApontamento' AND column_name = 'atividade_area_id')
     OR to_regclass('public."Atividade_cliente_id_empresa_id_id_key"') IS NULL THEN
    RAISE EXCEPTION 'guarda: as áreas da atividade não estão no formato anterior (tabela "AtividadeArea" ou coluna "atividade_area_id" já presente, ou o UNIQUE (cliente_id, empresa_id, id) da atividade ausente)';
  END IF;
  -- Trava ANTES de conferir, na ordem do app e já no modo mais forte de cada tabela (sem subir de trava no meio): até o COMMIT ninguém grava área, atividade ou lançamento (o que a guarda conferiu é o que o backfill copia e a FK valida).
  LOCK TABLE public."AreaPastagem" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public."Atividade" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."Atividade" WHERE area_id IS NOT NULL AND status = 'CONCLUIDA' AND data_conclusao IS NULL) THEN
    RAISE EXCEPTION 'guarda: há atividade concluída com área e sem data de conclusão; a área concluída exige a data';
  END IF;
END $$;

-- AlterTable (a área do lançamento; anulável: a atividade sem área continua lançando sem área)
ALTER TABLE "AtividadeApontamento" ADD COLUMN "atividade_area_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "AtividadeArea" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "atividade_id" VARCHAR(64) NOT NULL,
    "area_id" VARCHAR(64) NOT NULL,
    "setor_id" VARCHAR(64),
    "setor_nome" VARCHAR(255),
    "area_planejada" DECIMAL(14,4),
    "status" VARCHAR(16) NOT NULL DEFAULT 'PLANEJADA',
    "data_inicio" DATE,
    "data_conclusao" DATE,
    "ordem" INTEGER NOT NULL,
    "criado_por_usuario_id" VARCHAR(64),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtividadeArea_cliente_id_area_id_idx" ON "AtividadeArea"("cliente_id", "area_id");

-- CreateIndex
CREATE INDEX "AtividadeArea_cliente_id_setor_id_idx" ON "AtividadeArea"("cliente_id", "setor_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeArea_cliente_id_id_key" ON "AtividadeArea"("cliente_id", "id");

-- CreateIndex (a mesma área não entra duas vezes na mesma atividade)
CREATE UNIQUE INDEX "AtividadeArea_atividade_area_key" ON "AtividadeArea"("cliente_id", "empresa_id", "atividade_id", "area_id");

-- CreateIndex (o alvo da FK composta do lançamento: o id já é único, então este também é)
CREATE UNIQUE INDEX "AtividadeArea_empresa_atividade_id_key" ON "AtividadeArea"("cliente_id", "empresa_id", "atividade_id", "id");

-- CreateIndex (os lançamentos de uma área; o lado que referencia da FK composta)
CREATE INDEX "AtividadeApontamento_atividade_area_idx" ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "atividade_area_id");

-- AddForeignKey
ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_atividade_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_area_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_setor_fkey" FOREIGN KEY ("cliente_id", "setor_id") REFERENCES "Setor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Forma: o serviço valida antes; o banco é a última barreira. Valores fechados.
-- O ciclo da área: PLANEJADA (sem datas) → EM_ANDAMENTO (com o início) → CONCLUIDA (com o início e a conclusão, nessa ordem).
ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_status_check" CHECK (("status" = 'PLANEJADA' AND "data_inicio" IS NULL AND "data_conclusao" IS NULL) OR ("status" = 'EM_ANDAMENTO' AND "data_inicio" IS NOT NULL AND "data_conclusao" IS NULL) OR ("status" = 'CONCLUIDA' AND "data_inicio" IS NOT NULL AND "data_conclusao" IS NOT NULL AND "data_conclusao" >= "data_inicio"));

ALTER TABLE "AtividadeArea" ADD CONSTRAINT "AtividadeArea_valores_check" CHECK (("area_planejada" IS NULL OR "area_planejada" >= 0) AND "ordem" >= 1 AND "versao" >= 1);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['AtividadeArea'];
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

-- Backfill (cauda pinada): cada atividade com área ganha a área nº 1, com a área planejada, o setor e o autor dela.
-- A área já começou: início = o da atividade, senão o dia do 1º lançamento, senão o dia da criação (nunca depois da
-- conclusão). CONCLUIDA (com a data de conclusão) se a atividade está concluída; senão EM_ANDAMENTO (a cancelada
-- também: ela é só leitura e não ganha uma data de conclusão inventada).
INSERT INTO "AtividadeArea" ("id", "cliente_id", "empresa_id", "atividade_id", "area_id", "setor_id", "setor_nome", "area_planejada", "status", "data_inicio", "data_conclusao", "ordem", "criado_por_usuario_id", "versao", "createdAt", "updatedAt") SELECT 'ara_' || a."id", a."cliente_id", a."empresa_id", a."id", a."area_id", a."setor_id", a."setor_nome", a."area_planejada", CASE WHEN a."status" = 'CONCLUIDA' THEN 'CONCLUIDA' ELSE 'EM_ANDAMENTO' END, CASE WHEN a."status" = 'CONCLUIDA' THEN LEAST(COALESCE(a."data_inicio", (SELECT MIN(p."data_operacional") FROM "AtividadeApontamento" AS p WHERE p."cliente_id" = a."cliente_id" AND p."empresa_id" = a."empresa_id" AND p."atividade_id" = a."id"), CAST(a."createdAt" AS DATE)), a."data_conclusao") ELSE COALESCE(a."data_inicio", (SELECT MIN(p."data_operacional") FROM "AtividadeApontamento" AS p WHERE p."cliente_id" = a."cliente_id" AND p."empresa_id" = a."empresa_id" AND p."atividade_id" = a."id"), CAST(a."createdAt" AS DATE)) END, CASE WHEN a."status" = 'CONCLUIDA' THEN a."data_conclusao" END, 1, a."criado_por_usuario_id", 1, a."createdAt", CURRENT_TIMESTAMP FROM "Atividade" AS a WHERE a."area_id" IS NOT NULL;

-- Os lançamentos dessas atividades passam a ser da área nº 1 (a única até aqui).
UPDATE "AtividadeApontamento" AS p SET "atividade_area_id" = aa."id" FROM "AtividadeArea" AS aa WHERE aa."cliente_id" = p."cliente_id" AND aa."empresa_id" = p."empresa_id" AND aa."atividade_id" = p."atividade_id";

-- AddForeignKey (por último: valida o que o backfill gravou; a área do lançamento é DESTA atividade)
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_atividade_area_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id", "atividade_area_id") REFERENCES "AtividadeArea"("cliente_id", "empresa_id", "atividade_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
