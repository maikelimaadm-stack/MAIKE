-- MAIKE-ESTOQUE-SAIDA-MANUAL — saída manual do Estoque ("Novo movimento" → Saída). Quatro tabelas
-- novas: "MotivoSaidaEstoque" (cadastro de motivos de saída, por cliente), "SaidaEstoque"
-- (cabeçalho), "SaidaEstoqueItem" (uma linha por produto e depósito, ligada ao movimento de saída
-- do motor e, quando excluída, ao movimento de estorno) e "SaidaEstoqueEvento" (histórico
-- append-only por convenção do serviço). Decisão e relatório em docs/engineering/
-- (MAIKE-ESTOQUE-SAIDA-MANUAL-REPORT.md). O número da decisão fica FORA deste arquivo de
-- propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK nas tabelas NOVAS e o bloco RLS delas.
-- Nenhuma tabela existente é alterada e nenhum dado é migrado ou semeado (os motivos padrão
-- nascem pelo backend na primeira leitura).
--
-- Escopo garantido pelo banco: as FKs compostas pelo tenant (cliente_id + id) ligam fazenda,
-- motivo, produto, depósito, centros e movimentos ao MESMO cliente. ON DELETE RESTRICT: nada que a
-- saída cita pode ser apagado. As fatias consumidas ficam no próprio movimento (lotes_consumidos),
-- como na suplementação e na transferência.
--
-- Reversão operacional (não executada em produção): as tabelas são novas e nada fora delas as
-- referencia; removê-las não afeta dados existentes.

-- CreateTable
CREATE TABLE "MotivoSaidaEstoque" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "chave" VARCHAR(80) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivoSaidaEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaidaEstoque" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "motivo_id" VARCHAR(64) NOT NULL,
    "data_saida" DATE NOT NULL,
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

    CONSTRAINT "SaidaEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaidaEstoqueItem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "saida_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "unidade" VARCHAR(8) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "fator_kg" DECIMAL(14,4) NOT NULL,
    "quantidade_estoque" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "valor_total" DECIMAL(18,4) NOT NULL,
    "movimentacao_estoque_id" VARCHAR(64) NOT NULL,
    "movimentacao_estorno_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaidaEstoqueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaidaEstoqueEvento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "saida_id" VARCHAR(64) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "versao_anterior" INTEGER NOT NULL,
    "versao_nova" INTEGER NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "usuario_id" VARCHAR(64),
    "snapshot_anterior" JSONB,
    "snapshot_novo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaidaEstoqueEvento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotivoSaidaEstoque_cliente_id_id_key" ON "MotivoSaidaEstoque"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MotivoSaidaEstoque_cliente_id_chave_key" ON "MotivoSaidaEstoque"("cliente_id", "chave");

-- CreateIndex
CREATE INDEX "MotivoSaidaEstoque_cliente_id_ativo_idx" ON "MotivoSaidaEstoque"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "SaidaEstoque_cliente_id_empresa_id_status_data_saida_idx" ON "SaidaEstoque"("cliente_id", "empresa_id", "status", "data_saida");

-- CreateIndex
CREATE INDEX "SaidaEstoque_cliente_id_motivo_id_idx" ON "SaidaEstoque"("cliente_id", "motivo_id");

-- CreateIndex
CREATE INDEX "SaidaEstoque_cliente_id_empresa_id_centro_custo_id_idx" ON "SaidaEstoque"("cliente_id", "empresa_id", "centro_custo_id");

-- CreateIndex
CREATE INDEX "SaidaEstoque_cliente_id_empresa_id_centro_resultado_id_idx" ON "SaidaEstoque"("cliente_id", "empresa_id", "centro_resultado_id");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoque_cliente_id_id_key" ON "SaidaEstoque"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoque_cliente_id_empresa_id_id_key" ON "SaidaEstoque"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoque_cliente_id_numero_key" ON "SaidaEstoque"("cliente_id", "numero");

-- CreateIndex
CREATE INDEX "SaidaEstoqueItem_cliente_id_produto_id_idx" ON "SaidaEstoqueItem"("cliente_id", "produto_id");

-- CreateIndex
CREATE INDEX "SaidaEstoqueItem_cliente_id_local_estoque_id_idx" ON "SaidaEstoqueItem"("cliente_id", "local_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoqueItem_cliente_id_id_key" ON "SaidaEstoqueItem"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoqueItem_linha_key" ON "SaidaEstoqueItem"("cliente_id", "saida_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoqueItem_par_key" ON "SaidaEstoqueItem"("cliente_id", "saida_id", "produto_id", "local_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoqueItem_cliente_id_movimentacao_estoque_id_key" ON "SaidaEstoqueItem"("cliente_id", "movimentacao_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoqueItem_cliente_id_movimentacao_estorno_id_key" ON "SaidaEstoqueItem"("cliente_id", "movimentacao_estorno_id");

-- CreateIndex
CREATE INDEX "SaidaEstoqueEvento_saida_idx" ON "SaidaEstoqueEvento"("cliente_id", "empresa_id", "saida_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SaidaEstoqueEvento_cliente_id_id_key" ON "SaidaEstoqueEvento"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "MotivoSaidaEstoque" ADD CONSTRAINT "MotivoSaidaEstoque_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoque" ADD CONSTRAINT "SaidaEstoque_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoque" ADD CONSTRAINT "SaidaEstoque_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoque" ADD CONSTRAINT "SaidaEstoque_motivo_id_fkey" FOREIGN KEY ("cliente_id", "motivo_id") REFERENCES "MotivoSaidaEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoque" ADD CONSTRAINT "SaidaEstoque_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoque" ADD CONSTRAINT "SaidaEstoque_centro_resultado_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_saida_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "saida_id") REFERENCES "SaidaEstoque"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_produto_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_local_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_movimento_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueEvento" ADD CONSTRAINT "SaidaEstoqueEvento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaidaEstoqueEvento" ADD CONSTRAINT "SaidaEstoqueEvento_saida_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "saida_id") REFERENCES "SaidaEstoque"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs (tabelas novas): valores fechados; o serviço valida antes, o banco é a última barreira.
ALTER TABLE "MotivoSaidaEstoque" ADD CONSTRAINT "MotivoSaidaEstoque_nome_check" CHECK (char_length(btrim("nome")) >= 2 AND char_length(btrim("chave")) >= 2);

ALTER TABLE "SaidaEstoque" ADD CONSTRAINT "SaidaEstoque_status_check" CHECK ("status" IN ('CONFIRMADA', 'EXCLUIDA') AND "versao" >= 1);

ALTER TABLE "SaidaEstoque" ADD CONSTRAINT "SaidaEstoque_exclusao_check" CHECK (("status" = 'EXCLUIDA') = ("excluida_em" IS NOT NULL));

ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_unidade_check" CHECK ("unidade" IN ('KG', 'SACO', 'L'));

ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_valores_check" CHECK ("ordem" >= 1 AND "quantidade" > 0 AND "fator_kg" > 0 AND "quantidade_estoque" > 0 AND "custo_unitario" >= 0 AND "valor_total" >= 0);

ALTER TABLE "SaidaEstoqueEvento" ADD CONSTRAINT "SaidaEstoqueEvento_tipo_check" CHECK ("tipo" IN ('CONFIRMACAO', 'EDICAO', 'EXCLUSAO') AND char_length(btrim("motivo")) >= 3);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['MotivoSaidaEstoque', 'SaidaEstoque', 'SaidaEstoqueItem', 'SaidaEstoqueEvento'];
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
