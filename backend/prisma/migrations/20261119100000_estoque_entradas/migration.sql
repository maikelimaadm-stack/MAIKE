-- MAIKE-ESTOQUE-ENTRADAS — aba Entradas do Estoque: entrada manual documentada e saldo de
-- implantação. Três tabelas novas: "EntradaEstoque" (cabeçalho, com motivo, versão e revisão),
-- "EntradaEstoqueItem" (linha versionada por intervalo de revisão, ligada à camada e aos
-- movimentos do motor de estoque) e "EntradaEstoqueEvento" (histórico append-only por convenção
-- do serviço). Decisão e relatório em docs/engineering/ (MAIKE-ESTOQUE-ENTRADAS-REPORT.md). O número
-- da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK nas tabelas NOVAS e o bloco RLS delas.
-- Nenhuma tabela existente é alterada e nenhum dado é migrado ou semeado.
--
-- Escopo garantido pelo banco: as FKs compostas pelo tenant (cliente_id + id) ligam fazenda,
-- produto, depósito, camada e movimentos ao MESMO cliente. ON DELETE RESTRICT: nada que a
-- entrada cita (camada, movimento, produto, depósito) pode ser apagado. A unicidade por
-- camada, movimento e estorno é por cliente_id.
--
-- Reversão operacional (não executada em produção): as tabelas são novas e nada fora delas as
-- referencia; removê-las não afeta dados existentes.

-- CreateTable
CREATE TABLE "EntradaEstoque" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "motivo" VARCHAR(32) NOT NULL,
    "data_entrada" DATE NOT NULL,
    "documento_numero" VARCHAR(64),
    "observacao" VARCHAR(500),
    "justificativa" VARCHAR(500),
    "confirmada_em" TIMESTAMP(3),
    "confirmada_por_usuario_id" VARCHAR(64),
    "excluida_em" TIMESTAMP(3),
    "excluida_por_usuario_id" VARCHAR(64),
    "motivo_exclusao" VARCHAR(500),
    "excluida_de" VARCHAR(16),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntradaEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntradaEstoqueItem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "entrada_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "unidade" VARCHAR(8) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "fator_kg" DECIMAL(14,4) NOT NULL,
    "quantidade_estoque" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "custo_kg" DECIMAL(14,4) NOT NULL,
    "valor_total" DECIMAL(18,4) NOT NULL,
    "custo_zero" BOOLEAN NOT NULL DEFAULT false,
    "estoque_lote_nota_id" VARCHAR(64),
    "movimentacao_estoque_id" VARCHAR(64),
    "movimentacao_estorno_id" VARCHAR(64),
    "revisao_inicio" INTEGER NOT NULL,
    "revisao_fim" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntradaEstoqueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntradaEstoqueEvento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "entrada_id" VARCHAR(64) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "modo" VARCHAR(16),
    "revisao_anterior" INTEGER NOT NULL,
    "revisao_nova" INTEGER NOT NULL,
    "versao_anterior" INTEGER NOT NULL,
    "versao_nova" INTEGER NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "usuario_id" VARCHAR(64),
    "snapshot_anterior" JSONB,
    "snapshot_novo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntradaEstoqueEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntradaEstoque_cliente_id_empresa_id_status_data_entrada_idx" ON "EntradaEstoque"("cliente_id", "empresa_id", "status", "data_entrada");

-- CreateIndex
CREATE INDEX "EntradaEstoque_cliente_id_empresa_id_motivo_idx" ON "EntradaEstoque"("cliente_id", "empresa_id", "motivo");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoque_cliente_id_id_key" ON "EntradaEstoque"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoque_cliente_id_empresa_id_id_key" ON "EntradaEstoque"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoque_cliente_id_numero_key" ON "EntradaEstoque"("cliente_id", "numero");

-- CreateIndex
CREATE INDEX "EntradaEstoqueItem_cliente_id_empresa_id_entrada_id_idx" ON "EntradaEstoqueItem"("cliente_id", "empresa_id", "entrada_id");

-- CreateIndex
CREATE INDEX "EntradaEstoqueItem_cliente_id_produto_id_idx" ON "EntradaEstoqueItem"("cliente_id", "produto_id");

-- CreateIndex
CREATE INDEX "EntradaEstoqueItem_cliente_id_local_estoque_id_idx" ON "EntradaEstoqueItem"("cliente_id", "local_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoqueItem_cliente_id_id_key" ON "EntradaEstoqueItem"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoqueItem_linha_key" ON "EntradaEstoqueItem"("cliente_id", "entrada_id", "ordem", "revisao_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoqueItem_cliente_id_estoque_lote_nota_id_key" ON "EntradaEstoqueItem"("cliente_id", "estoque_lote_nota_id");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoqueItem_cliente_id_movimentacao_estoque_id_key" ON "EntradaEstoqueItem"("cliente_id", "movimentacao_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoqueItem_cliente_id_movimentacao_estorno_id_key" ON "EntradaEstoqueItem"("cliente_id", "movimentacao_estorno_id");

-- CreateIndex
CREATE INDEX "EntradaEstoqueEvento_entrada_idx" ON "EntradaEstoqueEvento"("cliente_id", "empresa_id", "entrada_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntradaEstoqueEvento_cliente_id_id_key" ON "EntradaEstoqueEvento"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_entrada_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "entrada_id") REFERENCES "EntradaEstoque"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_produto_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_local_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_lote_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_movimento_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueEvento" ADD CONSTRAINT "EntradaEstoqueEvento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntradaEstoqueEvento" ADD CONSTRAINT "EntradaEstoqueEvento_entrada_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "entrada_id") REFERENCES "EntradaEstoque"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs (tabelas novas): valores fechados; o serviço valida antes, o banco é a última barreira.
ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_status_check" CHECK ("status" IN ('RASCUNHO', 'CONFIRMADA', 'EXCLUIDA'));

ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_motivo_check" CHECK ("motivo" IN ('SALDO_IMPLANTACAO', 'DOACAO', 'OUTRA_COM_JUSTIFICATIVA'));

ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_versao_revisao_check" CHECK ("versao" >= 1 AND "revisao" >= 0 AND ("status" = 'RASCUNHO' OR "revisao" >= 1));

ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_justificativa_check" CHECK ("motivo" <> 'OUTRA_COM_JUSTIFICATIVA' OR char_length(btrim("justificativa")) >= 20);

ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_exclusao_check" CHECK (("status" = 'EXCLUIDA') = ("excluida_em" IS NOT NULL) AND ("excluida_de" IS NULL OR "excluida_de" IN ('RASCUNHO', 'CONFIRMADA')) AND (("status" = 'EXCLUIDA') = ("excluida_de" IS NOT NULL)));

ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_unidade_check" CHECK ("unidade" IN ('KG', 'SACO', 'L'));

ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_valores_check" CHECK ("quantidade" > 0 AND "fator_kg" > 0 AND "quantidade_estoque" > 0 AND "custo_unitario" >= 0 AND "custo_kg" >= 0 AND "valor_total" >= 0 AND ("custo_zero" = ("custo_unitario" = 0)));

ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_revisao_check" CHECK ("revisao_inicio" >= 0 AND ("revisao_inicio" = 0) = ("estoque_lote_nota_id" IS NULL) AND ("revisao_fim" IS NULL OR "revisao_fim" >= "revisao_inicio") AND ("movimentacao_estorno_id" IS NULL OR "revisao_fim" IS NOT NULL));

ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_fatos_check" CHECK (("estoque_lote_nota_id" IS NULL) = ("movimentacao_estoque_id" IS NULL));

ALTER TABLE "EntradaEstoqueEvento" ADD CONSTRAINT "EntradaEstoqueEvento_tipo_check" CHECK ("tipo" IN ('CONFIRMACAO', 'EDICAO', 'EXCLUSAO') AND ("modo" IS NULL OR "modo" IN ('METADADOS', 'SUBSTITUICAO')) AND char_length(btrim("motivo")) >= 3);

-- Backstop do banco: um par (produto, depósito) vigente por entrada. NULL <> NULL, então uma
-- unique comum não bastaria; o índice é parcial e começa por cliente_id (R10).
CREATE UNIQUE INDEX "EntradaEstoqueItem_par_vigente_key" ON "EntradaEstoqueItem"("cliente_id", "entrada_id", "produto_id", "local_estoque_id") WHERE "revisao_fim" IS NULL;

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['EntradaEstoque', 'EntradaEstoqueItem', 'EntradaEstoqueEvento'];
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
