-- MAIKE-ESTOQUE-AJUSTE-INVENTARIO — ajuste de inventário do Estoque ("Novo movimento" → Ajuste).
-- Três tabelas novas: "AjusteEstoque" (cabeçalho da contagem), "AjusteEstoqueItem" (uma linha por
-- produto e depósito: o contado, o saldo de antes, a diferença e, quando há diferença, o movimento do
-- motor — sobra = entrada com camada, falta = saída — e o estorno, quando excluído) e
-- "AjusteEstoqueEvento" (histórico append-only por convenção do serviço). Decisão e relatório em
-- docs/engineering/ (MAIKE-ESTOQUE-AJUSTE-INVENTARIO-REPORT.md). O número da decisão fica FORA deste
-- arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK nas tabelas NOVAS e o bloco RLS delas.
-- Nenhuma tabela existente é alterada e nenhum dado é migrado ou semeado.
--
-- Escopo garantido pelo banco: as FKs compostas pelo tenant (cliente_id + id) ligam fazenda, centros,
-- produto, depósito, camada e movimentos ao MESMO cliente. ON DELETE RESTRICT: nada que o ajuste cita
-- pode ser apagado.
--
-- Reversão operacional (não executada em produção): as tabelas são novas e nada fora delas as
-- referencia; removê-las não afeta dados existentes.

-- CreateTable
CREATE TABLE "AjusteEstoque" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "data_ajuste" DATE NOT NULL,
    "centro_custo_id" VARCHAR(64),
    "centro_resultado_id" VARCHAR(64),
    "observacao" VARCHAR(500),
    "confirmada_em" TIMESTAMP(3) NOT NULL,
    "confirmada_por_usuario_id" VARCHAR(64),
    "excluida_em" TIMESTAMP(3),
    "excluida_por_usuario_id" VARCHAR(64),
    "motivo_exclusao" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AjusteEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AjusteEstoqueItem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "ajuste_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "unidade" VARCHAR(8) NOT NULL,
    "quantidade_contada" DECIMAL(14,4) NOT NULL,
    "fator_kg" DECIMAL(14,4) NOT NULL,
    "contado_estoque" DECIMAL(14,4) NOT NULL,
    "saldo_anterior" DECIMAL(14,4) NOT NULL,
    "diferenca" DECIMAL(14,4) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "custo_informado" BOOLEAN NOT NULL DEFAULT false,
    "valor_total" DECIMAL(18,4) NOT NULL,
    "estoque_lote_nota_id" VARCHAR(64),
    "movimentacao_estoque_id" VARCHAR(64),
    "movimentacao_estorno_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AjusteEstoqueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AjusteEstoqueEvento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "ajuste_id" VARCHAR(64) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "versao_anterior" INTEGER NOT NULL,
    "versao_nova" INTEGER NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "usuario_id" VARCHAR(64),
    "snapshot_anterior" JSONB,
    "snapshot_novo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AjusteEstoqueEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AjusteEstoque_cliente_id_empresa_id_status_data_ajuste_idx" ON "AjusteEstoque"("cliente_id", "empresa_id", "status", "data_ajuste");

-- CreateIndex
CREATE INDEX "AjusteEstoque_cliente_id_empresa_id_centro_custo_id_idx" ON "AjusteEstoque"("cliente_id", "empresa_id", "centro_custo_id");

-- CreateIndex
CREATE INDEX "AjusteEstoque_cliente_id_empresa_id_centro_resultado_id_idx" ON "AjusteEstoque"("cliente_id", "empresa_id", "centro_resultado_id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoque_cliente_id_id_key" ON "AjusteEstoque"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoque_cliente_id_empresa_id_id_key" ON "AjusteEstoque"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoque_cliente_id_numero_key" ON "AjusteEstoque"("cliente_id", "numero");

-- CreateIndex
CREATE INDEX "AjusteEstoqueItem_cliente_id_produto_id_idx" ON "AjusteEstoqueItem"("cliente_id", "produto_id");

-- CreateIndex
CREATE INDEX "AjusteEstoqueItem_cliente_id_local_estoque_id_idx" ON "AjusteEstoqueItem"("cliente_id", "local_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoqueItem_cliente_id_id_key" ON "AjusteEstoqueItem"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoqueItem_linha_key" ON "AjusteEstoqueItem"("cliente_id", "ajuste_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoqueItem_par_key" ON "AjusteEstoqueItem"("cliente_id", "ajuste_id", "produto_id", "local_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoqueItem_cliente_id_estoque_lote_nota_id_key" ON "AjusteEstoqueItem"("cliente_id", "estoque_lote_nota_id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoqueItem_cliente_id_movimentacao_estoque_id_key" ON "AjusteEstoqueItem"("cliente_id", "movimentacao_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoqueItem_cliente_id_movimentacao_estorno_id_key" ON "AjusteEstoqueItem"("cliente_id", "movimentacao_estorno_id");

-- CreateIndex
CREATE INDEX "AjusteEstoqueEvento_ajuste_idx" ON "AjusteEstoqueEvento"("cliente_id", "empresa_id", "ajuste_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AjusteEstoqueEvento_cliente_id_id_key" ON "AjusteEstoqueEvento"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "AjusteEstoque" ADD CONSTRAINT "AjusteEstoque_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoque" ADD CONSTRAINT "AjusteEstoque_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoque" ADD CONSTRAINT "AjusteEstoque_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoque" ADD CONSTRAINT "AjusteEstoque_centro_resultado_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_ajuste_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "ajuste_id") REFERENCES "AjusteEstoque"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_produto_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_local_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_lote_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_movimento_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueEvento" ADD CONSTRAINT "AjusteEstoqueEvento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AjusteEstoqueEvento" ADD CONSTRAINT "AjusteEstoqueEvento_ajuste_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "ajuste_id") REFERENCES "AjusteEstoque"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs (tabelas novas): valores fechados; o serviço valida antes, o banco é a última barreira.
ALTER TABLE "AjusteEstoque" ADD CONSTRAINT "AjusteEstoque_status_check" CHECK ("status" IN ('CONFIRMADA', 'EXCLUIDA') AND "versao" >= 1);

ALTER TABLE "AjusteEstoque" ADD CONSTRAINT "AjusteEstoque_exclusao_check" CHECK (("status" = 'EXCLUIDA') = ("excluida_em" IS NOT NULL));

ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_unidade_check" CHECK ("unidade" IN ('KG', 'SACO', 'L'));

ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_valores_check" CHECK ("ordem" >= 1 AND "quantidade_contada" >= 0 AND "fator_kg" > 0 AND "contado_estoque" >= 0 AND "saldo_anterior" >= 0 AND "custo_unitario" >= 0 AND "valor_total" >= 0 AND "diferenca" = "contado_estoque" - "saldo_anterior");

ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_tipo_check" CHECK (("tipo" = 'SOBRA' AND "diferenca" > 0 AND "estoque_lote_nota_id" IS NOT NULL AND "movimentacao_estoque_id" IS NOT NULL) OR ("tipo" = 'FALTA' AND "diferenca" < 0 AND "estoque_lote_nota_id" IS NULL AND "movimentacao_estoque_id" IS NOT NULL) OR ("tipo" = 'SEM_DIFERENCA' AND "diferenca" = 0 AND "estoque_lote_nota_id" IS NULL AND "movimentacao_estoque_id" IS NULL AND "movimentacao_estorno_id" IS NULL));

ALTER TABLE "AjusteEstoqueEvento" ADD CONSTRAINT "AjusteEstoqueEvento_tipo_check" CHECK ("tipo" IN ('CONFIRMACAO', 'EDICAO', 'EXCLUSAO') AND char_length(btrim("motivo")) >= 3);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['AjusteEstoque', 'AjusteEstoqueItem', 'AjusteEstoqueEvento'];
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
