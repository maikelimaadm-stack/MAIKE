-- MAIKE-MEDICAO-FORRAGEM — Medição de Forragem do pasto. Uma linha por medição: pela
-- régua (as leituras em cm, a média e a situação calculada pelas alturas de entrada e
-- de saída da cultura da área) ou no olho (a situação escolhida, sem número). A amostra
-- de corte (opcional, só na régua) grava matéria verde, % de matéria seca e massa seca
-- por hectare. Tabela física "MEDICAOFORRAGEM" (model Prisma MedicaoForragem com
-- @@map). Decisão, relatório e runbook em docs/engineering/ (MAIKE-MEDICAO-FORRAGEM-*.md).
-- O número da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca
-- muda o checksum aplicado.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK na tabela NOVA e o bloco RLS
-- dela. Nenhuma tabela existente é alterada e nenhum dado é migrado ou semeado.
--
-- Escopo garantido pelo banco: as FKs compostas pelo tenant fazem a fazenda (Empresa),
-- o pasto (AreaPastagem) e a cultura (CADCULTURAS, pela fazenda também) serem do MESMO
-- cliente. ON DELETE RESTRICT: pasto ou cultura com medição não saem.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nada a
-- referencia; removê-la não afeta dados existentes.

-- CreateTable
CREATE TABLE "MEDICAOFORRAGEM" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "area_id" VARCHAR(64) NOT NULL,
    "cultura_id" VARCHAR(64),
    "data_medicao" DATE NOT NULL,
    "metodo" VARCHAR(8) NOT NULL,
    "leituras_cm" JSONB,
    "qtd_leituras" INTEGER,
    "altura_media_cm" DECIMAL(6,1),
    "situacao" VARCHAR(16),
    "altura_entrada_cm" DECIMAL(6,1),
    "altura_saida_cm" DECIMAL(6,1),
    "quadro_m2" DECIMAL(6,3),
    "qtd_amostras" INTEGER,
    "peso_verde_g" DECIMAL(10,1),
    "peso_seco_g" DECIMAL(10,1),
    "materia_seca_pct" DECIMAL(5,2),
    "massa_verde_kg_ha" DECIMAL(12,1),
    "massa_seca_kg_ha" DECIMAL(12,1),
    "observacoes" VARCHAR(2000),
    "registrado_por_nome" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MEDICAOFORRAGEM_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MEDICAOFORRAGEM_cliente_id_empresa_id_data_medicao_idx" ON "MEDICAOFORRAGEM"("cliente_id", "empresa_id", "data_medicao");

-- CreateIndex
CREATE INDEX "MEDICAOFORRAGEM_cliente_id_area_id_data_medicao_idx" ON "MEDICAOFORRAGEM"("cliente_id", "area_id", "data_medicao");

-- CreateIndex
CREATE INDEX "MEDICAOFORRAGEM_cliente_id_empresa_id_cultura_id_idx" ON "MEDICAOFORRAGEM"("cliente_id", "empresa_id", "cultura_id");

-- CreateIndex
CREATE UNIQUE INDEX "MEDICAOFORRAGEM_cliente_id_id_key" ON "MEDICAOFORRAGEM"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_cliente_id_area_id_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_cliente_id_empresa_id_cultura_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "cultura_id") REFERENCES "CADCULTURAS"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Forma: o serviço valida e calcula antes; o banco é a última barreira. Valores fechados.
ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_metodo_check" CHECK ("metodo" IN ('REGUA', 'OLHO'));

ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_situacao_check" CHECK ("situacao" IS NULL OR "situacao" IN ('RAPADO', 'DESCANSO', 'PRONTO', 'PASSOU'));

-- Régua: média e quantidade de leituras obrigatórias. No olho: situação obrigatória, sem leitura nem amostra.
ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_metodo_campos_check" CHECK (("metodo" = 'REGUA' AND "altura_media_cm" IS NOT NULL AND "qtd_leituras" IS NOT NULL AND "qtd_leituras" > 0) OR ("metodo" = 'OLHO' AND "situacao" IS NOT NULL AND "altura_media_cm" IS NULL AND "qtd_leituras" IS NULL AND "massa_verde_kg_ha" IS NULL AND "massa_seca_kg_ha" IS NULL));

ALTER TABLE "MEDICAOFORRAGEM" ADD CONSTRAINT "MEDICAOFORRAGEM_valores_check" CHECK (("altura_media_cm" IS NULL OR "altura_media_cm" >= 0) AND ("quadro_m2" IS NULL OR "quadro_m2" > 0) AND ("qtd_amostras" IS NULL OR "qtd_amostras" > 0) AND ("peso_verde_g" IS NULL OR "peso_verde_g" > 0) AND ("peso_seco_g" IS NULL OR "peso_seco_g" > 0) AND ("materia_seca_pct" IS NULL OR ("materia_seca_pct" > 0 AND "materia_seca_pct" <= 100)) AND ("massa_verde_kg_ha" IS NULL OR "massa_verde_kg_ha" >= 0) AND ("massa_seca_kg_ha" IS NULL OR "massa_seca_kg_ha" >= 0));

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['MEDICAOFORRAGEM'];
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
