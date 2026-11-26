-- MAIKE-DIARIO-MAQUINA — o diário da máquina: a mistura no implemento (o que foi colocado no tanque/caixa, com a
-- capacidade e o saldo), a aplicação no pasto (a linha de produto ganha a mistura e o volume aplicado), a sobra
-- (transferência para outro pasto, devolução ao depósito ou perda) e a quantidade padrão por implemento cheio no
-- cadastro do produto. Decisão, contrato, runbook e relatório em docs/engineering/ (MAIKE-DIARIO-MAQUINA-*.md). O
-- número da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: nenhuma tabela antiga perde ou muda coluna; nenhuma linha muda de valor.
--   "Produto"                      — "quantidade_padrao" (DECIMAL(14,4)) e "quantidade_padrao_unidade" (VARCHAR(8)),
--                                    ambas ANULÁVEIS, sem DEFAULT (nulo = sem quantidade padrão);
--   "AtividadeApontamentoProduto"  — "mistura_id" (VARCHAR(64)) e "volume_aplicado" (DECIMAL(14,4)), ambas ANULÁVEIS,
--                                    sem DEFAULT (nulo = linha de produto como sempre, sem mistura).
-- Tabelas novas, todas com tenant primeiro (cliente_id) e com RLS como as demais tabelas novas:
--   "AtividadeMistura"            — a mistura no implemento (Passo 1): capacidade, unidade L|KG, saldo, status
--                                    ABERTA|ACABOU|DEVOLVIDA|PERDA, área onde está e número 1..n na atividade;
--   "AtividadeMisturaItem"        — os produtos da mistura, com a quantidade por implemento cheio;
--   "AtividadeMisturaMovimento"   — o histórico: APLICACAO, TRANSFERENCIA, DEVOLUCAO e PERDA.
-- A baixa de estoque NÃO está nesta migration: o Passo 2 (aplicar) passa pelo serviço de linha de produto, que chama o
-- estoqueFisicoMotor. A devolução da sobra não gera movimento de estoque (o não aplicado nunca saiu do depósito).
-- Os CHECKs das tabelas novas são da migration (tabela nova aceita CHECK); a API também confere.
-- Nenhum DROP, RENAME, ALTER COLUMN, NOT NULL em coluna existente ou DML.
--
-- Reversão operacional (não executada em produção): DROP das três tabelas novas e das quatro colunas.

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "quantidade_padrao" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN     "quantidade_padrao_unidade" VARCHAR(8);

-- AlterTable
ALTER TABLE "AtividadeApontamentoProduto" ADD COLUMN     "mistura_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "AtividadeApontamentoProduto" ADD COLUMN     "volume_aplicado" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "AtividadeMistura" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "atividade_id" VARCHAR(64) NOT NULL,
    "implemento_bem_id" VARCHAR(64) NOT NULL,
    "area_id" VARCHAR(64) NOT NULL,
    "numero" INTEGER NOT NULL,
    "capacidade" DECIMAL(14,4) NOT NULL,
    "unidade" VARCHAR(8) NOT NULL,
    "saldo" DECIMAL(14,4) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "operation_id" VARCHAR(128) NOT NULL,
    "criado_por_usuario_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeMistura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeMisturaItem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "mistura_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeMisturaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeMisturaMovimento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "mistura_id" VARCHAR(64) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "apontamento_id" VARCHAR(64),
    "de_area_id" VARCHAR(64),
    "para_area_id" VARCHAR(64),
    "volume" DECIMAL(14,4) NOT NULL,
    "motivo" VARCHAR(500),
    "horimetro_saida" DECIMAL(14,4),
    "horimetro_chegada" DECIMAL(14,4),
    "operation_id" VARCHAR(128) NOT NULL,
    "criado_por_usuario_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeMisturaMovimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeMistura_cliente_id_id_key" ON "AtividadeMistura"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeMistura_cliente_id_operation_id_key" ON "AtividadeMistura"("cliente_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeMistura_cliente_id_atividade_id_numero_key" ON "AtividadeMistura"("cliente_id", "atividade_id", "numero");

-- CreateIndex
CREATE INDEX "AtividadeMistura_cliente_id_atividade_id_status_idx" ON "AtividadeMistura"("cliente_id", "atividade_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeMisturaItem_cliente_id_id_key" ON "AtividadeMisturaItem"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "AtividadeMisturaItem_cliente_id_mistura_id_idx" ON "AtividadeMisturaItem"("cliente_id", "mistura_id");

-- CreateIndex
CREATE INDEX "AtividadeMisturaItem_cliente_id_produto_id_idx" ON "AtividadeMisturaItem"("cliente_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeMisturaMovimento_cliente_id_id_key" ON "AtividadeMisturaMovimento"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeMisturaMovimento_cliente_id_operation_id_key" ON "AtividadeMisturaMovimento"("cliente_id", "operation_id");

-- CreateIndex
CREATE INDEX "AtividadeMisturaMovimento_cliente_id_mistura_id_idx" ON "AtividadeMisturaMovimento"("cliente_id", "mistura_id");

-- Checks (tabelas novas)
ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_unidade_check" CHECK ("unidade" IN ('L', 'KG'));

ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_status_check" CHECK ("status" IN ('ABERTA', 'ACABOU', 'DEVOLVIDA', 'PERDA'));

ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_valores_check" CHECK ("capacidade" > 0 AND "saldo" >= 0 AND "saldo" <= "capacidade" AND "numero" >= 1);

ALTER TABLE "AtividadeMisturaItem" ADD CONSTRAINT "AtividadeMisturaItem_quantidade_check" CHECK ("quantidade" > 0);

ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_tipo_check" CHECK ("tipo" IN ('APLICACAO', 'TRANSFERENCIA', 'DEVOLUCAO', 'PERDA'));

ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_forma_check" CHECK ("volume" >= 0 AND ("horimetro_saida" IS NULL OR "horimetro_saida" >= 0) AND ("horimetro_chegada" IS NULL OR "horimetro_chegada" >= 0) AND ("tipo" <> 'APLICACAO' OR "apontamento_id" IS NOT NULL) AND ("tipo" <> 'TRANSFERENCIA' OR "para_area_id" IS NOT NULL) AND ("tipo" <> 'PERDA' OR ("apontamento_id" IS NOT NULL AND "motivo" IS NOT NULL)));

-- AddForeignKey
ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_empresa_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_atividade_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_implemento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "implemento_bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_area_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMistura" ADD CONSTRAINT "AtividadeMistura_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaItem" ADD CONSTRAINT "AtividadeMisturaItem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaItem" ADD CONSTRAINT "AtividadeMisturaItem_mistura_fkey" FOREIGN KEY ("cliente_id", "mistura_id") REFERENCES "AtividadeMistura"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaItem" ADD CONSTRAINT "AtividadeMisturaItem_produto_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaItem" ADD CONSTRAINT "AtividadeMisturaItem_local_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_mistura_fkey" FOREIGN KEY ("cliente_id", "mistura_id") REFERENCES "AtividadeMistura"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_apontamento_fkey" FOREIGN KEY ("cliente_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_de_area_fkey" FOREIGN KEY ("cliente_id", "de_area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_para_area_fkey" FOREIGN KEY ("cliente_id", "para_area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeMisturaMovimento" ADD CONSTRAINT "AtividadeMisturaMovimento_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS das tabelas novas (mesmo formato das EXPANDs anteriores: sem acesso para anon/authenticated; o backend, maike_vercel).
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['AtividadeMistura', 'AtividadeMisturaItem', 'AtividadeMisturaMovimento'];
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
