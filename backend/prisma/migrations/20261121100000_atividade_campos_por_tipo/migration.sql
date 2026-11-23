-- MAIKE-ENTREGA2 — campos próprios de cada tipo na "Nova realização de <Tipo>" (Plantio de pastagem,
-- Aplicação, Manutenção e Outros). Decisão, relatório e runbook em docs/engineering/
-- (MAIKE-ENTREGA2-CAMPOS-POR-TIPO-*.md). O número da decisão fica FORA deste arquivo de propósito:
-- renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY. Nesta ordem:
--   1. cinco colunas ANULÁVEIS, sem DEFAULT, em tabelas antigas (nenhuma linha muda de valor):
--      "Atividade"."local" (onde foi o serviço sem área), "AtividadeApontamento"."numero_receituario"
--      (nº do receituário da Aplicação), "AtividadeApontamentoProduto"."vc_percentual" (VC % do
--      saco de semente), "Produto"."carencia_dias" (carência da bula, em dias) e
--      "TipoAtividade"."alvo" (o alvo da Aplicação no cadastro da operação). Sem CHECK nelas: a
--      allowlist EXPAND recusa CHECK em tabela antiga, e a API confere forma e faixa;
--   2. a tabela NOVA "AtividadePlantio" (1 para 1 com a atividade de plantio): o capim plantado
--      (obrigatório) e o consórcio (opcional) do Cadastro de Culturas da MESMA fazenda (FKs compostas
--      cliente + fazenda + id, RESTRICT), a forma de plantio (CHECK), semente incrustada e plantio de
--      cobertura; índices e uniques começando por cliente_id; o bloco RLS dela.
-- Nenhum DROP, RENAME, ALTER COLUMN, NOT NULL em coluna existente ou DML. Nenhum dado é semeado: a
-- lista de referência de capins entra pelo serviço (comando idempotente "Incluir lista de
-- referência"), e as culturas que a fazenda já tem não são tocadas.
--
-- Reversão operacional (não executada em produção): DROP da tabela nova (nada a referencia) e das
-- cinco colunas.

-- AlterTable
ALTER TABLE "Atividade" ADD COLUMN     "local" VARCHAR(120);

-- AlterTable
ALTER TABLE "AtividadeApontamento" ADD COLUMN     "numero_receituario" VARCHAR(40);

-- AlterTable
ALTER TABLE "AtividadeApontamentoProduto" ADD COLUMN     "vc_percentual" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "carencia_dias" INTEGER;

-- AlterTable
ALTER TABLE "TipoAtividade" ADD COLUMN     "alvo" VARCHAR(60);

-- CreateTable
CREATE TABLE "AtividadePlantio" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "atividade_id" VARCHAR(64) NOT NULL,
    "cultura_id" VARCHAR(64) NOT NULL,
    "forma_plantio" VARCHAR(16),
    "semente_incrustada" BOOLEAN,
    "cobertura" BOOLEAN,
    "consorcio_cultura_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadePlantio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtividadePlantio_cultura_idx" ON "AtividadePlantio"("cliente_id", "empresa_id", "cultura_id");

-- CreateIndex
CREATE INDEX "AtividadePlantio_consorcio_idx" ON "AtividadePlantio"("cliente_id", "empresa_id", "consorcio_cultura_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadePlantio_cliente_id_id_key" ON "AtividadePlantio"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadePlantio_atividade_key" ON "AtividadePlantio"("cliente_id", "empresa_id", "atividade_id");

-- AddForeignKey
ALTER TABLE "AtividadePlantio" ADD CONSTRAINT "AtividadePlantio_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadePlantio" ADD CONSTRAINT "AtividadePlantio_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadePlantio" ADD CONSTRAINT "AtividadePlantio_atividade_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadePlantio" ADD CONSTRAINT "AtividadePlantio_cultura_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "cultura_id") REFERENCES "CADCULTURAS"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadePlantio" ADD CONSTRAINT "AtividadePlantio_consorcio_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "consorcio_cultura_id") REFERENCES "CADCULTURAS"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Forma: o serviço valida antes; o banco é a última barreira (só na tabela NOVA).
ALTER TABLE "AtividadePlantio" ADD CONSTRAINT "AtividadePlantio_forma_plantio_check" CHECK ("forma_plantio" IS NULL OR "forma_plantio" IN ('A_LANCO', 'EM_LINHA', 'AEREA', 'MUDA'));

ALTER TABLE "AtividadePlantio" ADD CONSTRAINT "AtividadePlantio_consorcio_check" CHECK ("consorcio_cultura_id" IS NULL OR "consorcio_cultura_id" <> "cultura_id");

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['AtividadePlantio'];
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
