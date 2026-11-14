-- MAIKE-APONTAMENTO-ITENS (Fatia D do apontamento) — ITENS de custo de um
-- Apontamento de Atividade CONFIRMADO. Decisão, contrato e relatório em
-- docs/engineering/ (MAIKE-APONTAMENTO-ITENS-*.md). O número da decisão fica
-- FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum
-- aplicado. PRODUTO baixa estoque pelo motor único (FIFO por lote) e guarda
-- as fatias consumidas de cada lote para o estorno exato; SERVICO e OUTRO têm
-- descrição livre, quantidade e valor unitário, com total calculado no
-- servidor, sem efeito de estoque nem financeiro. Sem centro próprio: vale o
-- centro de custo (snapshot) do cabeçalho do apontamento.
--
-- EXPAND-ONLY (classificador `premergeMigrateLib.classificarMigrations`): só
-- CREATE TABLE / INDEX / FK / CHECK nas 2 tabelas NOVAS
-- "ApontamentoAtividadeItem" e "ApontamentoAtividadeItemConsumoLote". Nenhuma
-- tabela existente é alterada (zero DDL em ApontamentoAtividade, Produto,
-- LocalEstoque, EstoqueLoteNota, MovimentacaoEstoque, Usuario ou Cliente) e
-- nenhum dado é migrado ou semeado. A origem nova do movimento de estoque é só
-- código: nenhuma tabela antiga tem CHECK ou enum de origem. A chave de
-- idempotência (`operation_id`) e todo dado novo ficam nas tabelas novas. As
-- relações inversas do schema são só do Prisma: nada muda no banco das
-- tabelas antigas.
--
-- Escopo garantido pelo banco: toda FK é composta por (cliente_id, …) e ON
-- DELETE RESTRICT. O item aponta para ApontamentoAtividade(cliente_id,
-- empresa_id, id): é do MESMO tenant e da MESMA empresa do apontamento por
-- construção (sem FK direta para Empresa: o apontamento já a tem). A fatia
-- aponta para o item por (cliente_id, empresa_id, id) e para o lote do mesmo
-- tenant. Produto, local, movimento de saída, movimento de estorno e os dois
-- usuários (criado_por, cancelado_por) são do MESMO tenant. Excluir
-- apontamento, produto, local, lote, movimento ou usuário citado por item ou
-- fatia é barrado pela FK (P2003). Sem DELETE físico: o item é imutável;
-- cancelar muda `status` (com estorno exato do PRODUTO) e as fatias ficam
-- como histórico.
--
-- Reversão operacional (não executada em produção): as 2 tabelas são novas e
-- nenhuma tabela antiga as referencia; removê-las (a fatia antes do item) não
-- afeta dados anteriores a esta migration.

-- CreateTable
CREATE TABLE "ApontamentoAtividadeItem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "apontamento_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo" VARCHAR(8) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "descricao" VARCHAR(255),
    "produto_id" VARCHAR(64),
    "local_estoque_id" VARCHAR(64),
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade" VARCHAR(4),
    "valor_unitario" DECIMAL(18,6) NOT NULL,
    "valor_total" DECIMAL(18,4) NOT NULL,
    "operation_id" VARCHAR(128) NOT NULL,
    "movimentacao_estoque_id" VARCHAR(64),
    "movimentacao_estorno_id" VARCHAR(64),
    "criado_por_usuario_id" VARCHAR(64),
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "cancelamento_origem" VARCHAR(12),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApontamentoAtividadeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApontamentoAtividadeItemConsumoLote" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "item_id" VARCHAR(64) NOT NULL,
    "estoque_lote_nota_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApontamentoAtividadeItemConsumoLote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApontamentoAtividadeItem_cliente_id_produto_id_idx" ON "ApontamentoAtividadeItem"("cliente_id", "produto_id");

-- CreateIndex
CREATE INDEX "ApontamentoAtividadeItem_cliente_id_local_estoque_id_idx" ON "ApontamentoAtividadeItem"("cliente_id", "local_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_cliente_id_id_key" ON "ApontamentoAtividadeItem"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_cliente_id_empresa_id_id_key" ON "ApontamentoAtividadeItem"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_cliente_id_operation_id_key" ON "ApontamentoAtividadeItem"("cliente_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_apontamento_ordem_key" ON "ApontamentoAtividadeItem"("cliente_id", "apontamento_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_movimentacao_key" ON "ApontamentoAtividadeItem"("cliente_id", "movimentacao_estoque_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItem_estorno_key" ON "ApontamentoAtividadeItem"("cliente_id", "movimentacao_estorno_id");

-- CreateIndex
CREATE INDEX "ApontamentoAtividadeItemConsumoLote_lote_idx" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "estoque_lote_nota_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItemConsumoLote_cliente_id_id_key" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItemConsumoLote_item_lote_key" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "item_id", "estoque_lote_nota_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividadeItemConsumoLote_item_ordem_key" ON "ApontamentoAtividadeItemConsumoLote"("cliente_id", "item_id", "ordem");

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "ApontamentoAtividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cliente_id_local_estoque_id_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_movimentacao_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_item_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "item_id") REFERENCES "ApontamentoAtividadeItem"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_lote_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domínios fechados e invariantes (CHECK escrito à mão; NULL-safe; nomes ≤ 63 bytes; nenhum ponto e vírgula dentro).
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_tipo_check" CHECK ("tipo" IN ('PRODUTO', 'SERVICO', 'OUTRO'));
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_forma_check" CHECK (("tipo" = 'PRODUTO' AND "produto_id" IS NOT NULL AND "local_estoque_id" IS NOT NULL AND "unidade" IS NOT NULL AND "unidade" IN ('L', 'KG') AND "descricao" IS NULL AND "movimentacao_estoque_id" IS NOT NULL) OR ("tipo" IN ('SERVICO', 'OUTRO') AND "produto_id" IS NULL AND "local_estoque_id" IS NULL AND "unidade" IS NULL AND "descricao" IS NOT NULL AND char_length(btrim("descricao")) > 0 AND "movimentacao_estoque_id" IS NULL AND "movimentacao_estorno_id" IS NULL));
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_status_check" CHECK (("status" = 'CONFIRMADO' AND "movimentacao_estorno_id" IS NULL AND "cancelado_em" IS NULL AND "cancelado_por_usuario_id" IS NULL AND "motivo_cancelamento" IS NULL AND "cancelamento_origem" IS NULL) OR ("status" = 'CANCELADO' AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND char_length(btrim("motivo_cancelamento")) >= 3 AND "cancelamento_origem" IS NOT NULL AND "cancelamento_origem" IN ('ITEM', 'APONTAMENTO') AND ("tipo" <> 'PRODUTO' OR "movimentacao_estorno_id" IS NOT NULL)));
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_valores_check" CHECK ("quantidade" > 0 AND "valor_unitario" >= 0 AND "valor_total" >= 0 AND ("tipo" = 'PRODUTO' OR "valor_total" > 0) AND "ordem" >= 1);
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_textos_check" CHECK ("operation_id" ~ '^[A-Za-z0-9_.:-]{8,128}$');
ALTER TABLE "ApontamentoAtividadeItem" ADD CONSTRAINT "ApontamentoAtividadeItem_movimentos_check" CHECK ("movimentacao_estorno_id" IS NULL OR "movimentacao_estorno_id" <> "movimentacao_estoque_id");
ALTER TABLE "ApontamentoAtividadeItemConsumoLote" ADD CONSTRAINT "ApontamentoAtividadeItemConsumoLote_valores_check" CHECK ("quantidade" > 0 AND "custo_unitario" >= 0 AND "ordem" >= 1);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['ApontamentoAtividadeItem','ApontamentoAtividadeItemConsumoLote'];
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
