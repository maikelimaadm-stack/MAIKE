-- MAIKE-ATIVIDADE-LINHAS (Fatia 3 do Lançamento de Atividades) — as linhas que geram
-- custo no apontamento do dia: PRODUTO (baixa física pelo motor único de estoque,
-- FIFO por lote, estorno exato) e MÁQUINA (bem, implemento e medidor). Decisão,
-- contrato, runbook e relatório em docs/engineering/ (MAIKE-ATIVIDADE-LINHAS-*.md).
-- O número da decisão fica FORA deste arquivo de propósito.
--
-- EXPAND-ONLY: só tabelas NOVAS (CREATE TABLE / INDEX / CHECK / FK nas novas, RLS
-- das novas) e duas colunas ANULÁVEIS sem DEFAULT em tabelas antigas:
-- "BemPatrimonial"."custo_uso_unitario" (custo por hora ou km, snapshot na linha de
-- máquina) e "TipoPatrimonial"."salto_maximo_medidor" (teto do salto do medidor por
-- lançamento). Nenhum dado é migrado; o código de hoje convive com as colunas.
--
-- A leitura do medidor vive na linha de máquina (como no abastecimento): nada é
-- gravado em "BemPatrimonial"."medidor_*". Escopo garantido pelo banco: toda FK é
-- composta e tenant-aware, RESTRICT; a linha aponta para o apontamento e o bem por
-- (cliente_id, empresa_id, id): mesma fazenda por construção.

-- AlterTable
ALTER TABLE "BemPatrimonial" ADD COLUMN     "custo_uso_unitario" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "TipoPatrimonial" ADD COLUMN     "salto_maximo_medidor" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "AtividadeApontamentoProduto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "apontamento_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade" VARCHAR(8) NOT NULL,
    "dose_ha" DECIMAL(14,4),
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "custo_total" DECIMAL(14,4) NOT NULL,
    "operation_id" VARCHAR(128) NOT NULL,
    "movimentacao_estoque_id" VARCHAR(64) NOT NULL,
    "movimentacao_estorno_id" VARCHAR(64),
    "observacao" VARCHAR(500),
    "criado_por_usuario_id" VARCHAR(64),
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "cancelamento_origem" VARCHAR(12),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeApontamentoProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeApontamentoProdutoConsumoLote" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "linha_id" VARCHAR(64) NOT NULL,
    "estoque_lote_nota_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeApontamentoProdutoConsumoLote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeApontamentoMaquina" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "apontamento_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "bem_id" VARCHAR(64) NOT NULL,
    "implemento_bem_id" VARCHAR(64),
    "medidor_tipo" VARCHAR(16) NOT NULL,
    "medidor_unidade" VARCHAR(8),
    "leitura_inicial" DECIMAL(14,4),
    "leitura_final" DECIMAL(14,4),
    "quantidade_uso" DECIMAL(14,4) NOT NULL,
    "sem_medidor" BOOLEAN NOT NULL DEFAULT false,
    "justificativa_salto" VARCHAR(500),
    "custo_unitario_uso" DECIMAL(14,4),
    "custo_total" DECIMAL(14,4),
    "operation_id" VARCHAR(128) NOT NULL,
    "observacao" VARCHAR(500),
    "criado_por_usuario_id" VARCHAR(64),
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "cancelamento_origem" VARCHAR(12),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeApontamentoMaquina_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AtividadeApontamentoProduto_cliente_id_empresa_id_apontamen_idx" ON "AtividadeApontamentoProduto"("cliente_id", "empresa_id", "apontamento_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoProduto_cliente_id_produto_id_idx" ON "AtividadeApontamentoProduto"("cliente_id", "produto_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoProduto_cliente_id_local_estoque_id_idx" ON "AtividadeApontamentoProduto"("cliente_id", "local_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProduto_cliente_id_id_key" ON "AtividadeApontamentoProduto"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProduto_cliente_id_empresa_id_id_key" ON "AtividadeApontamentoProduto"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProduto_cliente_id_operation_id_key" ON "AtividadeApontamentoProduto"("cliente_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProduto_apontamento_ordem_key" ON "AtividadeApontamentoProduto"("cliente_id", "apontamento_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProduto_movimentacao_key" ON "AtividadeApontamentoProduto"("cliente_id", "movimentacao_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProduto_estorno_key" ON "AtividadeApontamentoProduto"("cliente_id", "movimentacao_estorno_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoProdutoConsumoLote_lote_idx" ON "AtividadeApontamentoProdutoConsumoLote"("cliente_id", "estoque_lote_nota_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProdutoConsumoLote_cliente_id_id_key" ON "AtividadeApontamentoProdutoConsumoLote"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProdutoConsumoLote_linha_lote_key" ON "AtividadeApontamentoProdutoConsumoLote"("cliente_id", "linha_id", "estoque_lote_nota_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoProdutoConsumoLote_linha_ordem_key" ON "AtividadeApontamentoProdutoConsumoLote"("cliente_id", "linha_id", "ordem");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoMaquina_cliente_id_empresa_id_apontamen_idx" ON "AtividadeApontamentoMaquina"("cliente_id", "empresa_id", "apontamento_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoMaquina_cliente_id_empresa_id_bem_id_idx" ON "AtividadeApontamentoMaquina"("cliente_id", "empresa_id", "bem_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoMaquina_cliente_id_empresa_id_implement_idx" ON "AtividadeApontamentoMaquina"("cliente_id", "empresa_id", "implemento_bem_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaquina_cliente_id_id_key" ON "AtividadeApontamentoMaquina"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaquina_cliente_id_empresa_id_id_key" ON "AtividadeApontamentoMaquina"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaquina_cliente_id_operation_id_key" ON "AtividadeApontamentoMaquina"("cliente_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaquina_apontamento_ordem_key" ON "AtividadeApontamentoMaquina"("cliente_id", "apontamento_id", "ordem");

-- Listas fechadas e invariantes (CHECK nas tabelas NOVAS).
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_status_check" CHECK (("status" = 'CONFIRMADO' AND "movimentacao_estorno_id" IS NULL AND "cancelado_em" IS NULL AND "motivo_cancelamento" IS NULL AND "cancelamento_origem" IS NULL) OR ("status" = 'CANCELADO' AND "movimentacao_estorno_id" IS NOT NULL AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND "cancelamento_origem" IN ('LINHA', 'EDICAO', 'APONTAMENTO', 'ATIVIDADE')));
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_valores_check" CHECK ("quantidade" > 0 AND "custo_unitario" >= 0 AND "custo_total" >= 0 AND ("dose_ha" IS NULL OR "dose_ha" >= 0) AND "ordem" >= 1 AND "unidade" IN ('L', 'KG'));
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_textos_check" CHECK ("operation_id" ~ '^[A-Za-z0-9_.:-]{8,128}$');
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_movimentos_check" CHECK ("movimentacao_estorno_id" IS NULL OR "movimentacao_estorno_id" <> "movimentacao_estoque_id");
ALTER TABLE "AtividadeApontamentoProdutoConsumoLote" ADD CONSTRAINT "AtividadeApontamentoProdutoConsumoLote_valores_check" CHECK ("quantidade" > 0 AND "custo_unitario" >= 0 AND "ordem" >= 1);
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_status_check" CHECK (("status" = 'CONFIRMADO' AND "cancelado_em" IS NULL AND "motivo_cancelamento" IS NULL AND "cancelamento_origem" IS NULL) OR ("status" = 'CANCELADO' AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND "cancelamento_origem" IN ('LINHA', 'EDICAO', 'APONTAMENTO', 'ATIVIDADE')));
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_medidor_check" CHECK ("medidor_tipo" IN ('SEM_MEDIDOR', 'HORIMETRO', 'ODOMETRO', 'CICLOS') AND (("sem_medidor" AND "leitura_inicial" IS NULL AND "leitura_final" IS NULL) OR (NOT "sem_medidor" AND "leitura_inicial" IS NOT NULL AND "leitura_final" IS NOT NULL AND "leitura_final" >= "leitura_inicial" AND "quantidade_uso" = "leitura_final" - "leitura_inicial")));
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_valores_check" CHECK ("quantidade_uso" >= 0 AND ("custo_unitario_uso" IS NULL OR "custo_unitario_uso" >= 0) AND ("custo_total" IS NULL OR "custo_total" >= 0) AND "ordem" >= 1 AND ("implemento_bem_id" IS NULL OR "implemento_bem_id" <> "bem_id"));
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_textos_check" CHECK ("operation_id" ~ '^[A-Za-z0-9_.:-]{8,128}$');

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_cliente_id_local_estoque_id_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_movimentacao_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProdutoConsumoLote" ADD CONSTRAINT "AtividadeApontamentoProdutoConsumoLote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProdutoConsumoLote" ADD CONSTRAINT "AtividadeApontamentoProdutoConsumoLote_linha_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "linha_id") REFERENCES "AtividadeApontamentoProduto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoProdutoConsumoLote" ADD CONSTRAINT "AtividadeApontamentoProdutoConsumoLote_lote_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_bem_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_implemento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "implemento_bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaquina" ADD CONSTRAINT "AtividadeApontamentoMaquina_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['AtividadeApontamentoProduto','AtividadeApontamentoProdutoConsumoLote','AtividadeApontamentoMaquina'];
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
