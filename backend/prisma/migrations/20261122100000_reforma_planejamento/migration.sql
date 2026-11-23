-- MAIKE-ENTREGA3 — a REFORMA DE PASTAGEM como agrupador ("Reforma · PASTO DA AROEIRA · 2026/27"): o "Planejar"
-- cria a reforma com as áreas, o tipo, o capim que vai ficar e o início previsto, e cada realização da área entra
-- nela ("Faz parte de"). Decisão, relatório e runbook em docs/engineering/ (MAIKE-ENTREGA3-REFORMA-*.md). O número
-- da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY. Nesta ordem:
--   1. uma coluna ANULÁVEL, sem DEFAULT, em tabela antiga: "Atividade"."planejamento_id" (a reforma de que a
--      realização faz parte). Nenhuma linha muda de valor (todas ficam nulas);
--   2. as tabelas NOVAS "Planejamento" (a reforma: número, nome, tipo REFORMA | FORMACAO | OUTRO, safra, o capim
--      que vai ficar — do Cadastro de Culturas da MESMA fazenda, FK composta —, início previsto, status ABERTO |
--      CONCLUIDO | CANCELADO e a data de conclusão) e "PlanejamentoArea" (as áreas da reforma e os hectares de
--      cada uma, o divisor do R$/ha). CHECKs só nelas; índices e uniques começando por cliente_id;
--   3. o índice não-único (cliente_id, planejamento_id) em "Atividade" e a FK composta pelo tenant
--      ("cliente_id", "planejamento_id") → "Planejamento"("cliente_id", "id"), RESTRICT (a mesma fazenda é
--      conferida pela API: a allowlist EXPAND só aceita essa forma de FK em tabela antiga);
--   4. o bloco RLS das duas tabelas novas.
-- Nenhum DROP, RENAME, ALTER COLUMN, NOT NULL em coluna existente ou DML. Nenhum dado é semeado. O custo da
-- reforma (total, R$/ha, por tipo) é calculado na leitura: nada de custo é gravado.
--
-- Reversão operacional (não executada em produção): DROP da FK e do índice em "Atividade", DROP da coluna
-- "planejamento_id" e DROP das duas tabelas novas ("PlanejamentoArea" antes de "Planejamento").

-- AlterTable
ALTER TABLE "Atividade" ADD COLUMN     "planejamento_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "Planejamento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "safra_ciclo" VARCHAR(32),
    "cultura_alvo_id" VARCHAR(64),
    "data_inicio" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ABERTO',
    "data_conclusao" DATE,
    "criado_por_usuario_id" VARCHAR(64),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Planejamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanejamentoArea" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "planejamento_id" VARCHAR(64) NOT NULL,
    "area_id" VARCHAR(64) NOT NULL,
    "hectares" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanejamentoArea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Planejamento_cliente_id_empresa_id_status_idx" ON "Planejamento"("cliente_id", "empresa_id", "status");

-- CreateIndex
CREATE INDEX "Planejamento_cultura_alvo_idx" ON "Planejamento"("cliente_id", "empresa_id", "cultura_alvo_id");

-- CreateIndex
CREATE INDEX "Planejamento_cliente_id_criado_por_usuario_id_idx" ON "Planejamento"("cliente_id", "criado_por_usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "Planejamento_cliente_id_id_key" ON "Planejamento"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Planejamento_cliente_id_empresa_id_id_key" ON "Planejamento"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Planejamento_cliente_id_numero_key" ON "Planejamento"("cliente_id", "numero");

-- CreateIndex
CREATE INDEX "PlanejamentoArea_cliente_id_area_id_idx" ON "PlanejamentoArea"("cliente_id", "area_id");

-- CreateIndex
CREATE UNIQUE INDEX "PlanejamentoArea_cliente_id_id_key" ON "PlanejamentoArea"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PlanejamentoArea_planejamento_area_key" ON "PlanejamentoArea"("cliente_id", "empresa_id", "planejamento_id", "area_id");

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_planejamento_id_idx" ON "Atividade"("cliente_id", "planejamento_id");

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_planejamento_id_fkey" FOREIGN KEY ("cliente_id", "planejamento_id") REFERENCES "Planejamento"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planejamento" ADD CONSTRAINT "Planejamento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planejamento" ADD CONSTRAINT "Planejamento_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planejamento" ADD CONSTRAINT "Planejamento_cultura_alvo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "cultura_alvo_id") REFERENCES "CADCULTURAS"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planejamento" ADD CONSTRAINT "Planejamento_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanejamentoArea" ADD CONSTRAINT "PlanejamentoArea_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanejamentoArea" ADD CONSTRAINT "PlanejamentoArea_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanejamentoArea" ADD CONSTRAINT "PlanejamentoArea_planejamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "planejamento_id") REFERENCES "Planejamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanejamentoArea" ADD CONSTRAINT "PlanejamentoArea_area_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tipo, status e datas: o serviço valida antes; o banco é a última barreira (só nas tabelas NOVAS).
ALTER TABLE "Planejamento" ADD CONSTRAINT "Planejamento_tipo_check" CHECK ("tipo" IN ('REFORMA', 'FORMACAO', 'OUTRO'));

ALTER TABLE "Planejamento" ADD CONSTRAINT "Planejamento_status_check" CHECK ("status" IN ('ABERTO', 'CONCLUIDO', 'CANCELADO') AND (("status" = 'CONCLUIDO') = ("data_conclusao" IS NOT NULL)));

ALTER TABLE "Planejamento" ADD CONSTRAINT "Planejamento_datas_check" CHECK ("data_conclusao" IS NULL OR "data_conclusao" >= "data_inicio");

ALTER TABLE "PlanejamentoArea" ADD CONSTRAINT "PlanejamentoArea_hectares_check" CHECK ("hectares" > 0);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['Planejamento', 'PlanejamentoArea'];
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
