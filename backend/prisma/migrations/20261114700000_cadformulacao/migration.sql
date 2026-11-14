-- MAIKE-FORMULACOES — cadastro de Formulações de suplemento da fazenda (etapa 2a
-- da suplementação). Decisão, relatório e runbook em docs/engineering/
-- (MAIKE-FORMULACOES-*.md). O número da decisão fica FORA deste arquivo de
-- propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- Três tabelas NOVAS, com nomes físicos no padrão dos cadastros (CAD…):
--  - "CADFORMULACAO": a formulação (PRONTO ou BATELADA), o produto que vai ao
--    cocho, o %PV padrão do consumo e o consumo objetivo opcional (g/cab/dia);
--  - "CADFORMULACAOINGREDIENTE": os ingredientes da BATELADA, em kg por batida;
--  - "CADFORMULACAOREGRA": a exceção de consumo por Categoria de Manejo (não
--    consome, ou consome com %PV próprio).
-- A produção da batelada (movimento de estoque) não existe aqui.
--
-- EXPAND-ONLY (classificador `premergeMigrateLib.classificarMigrations`): só
-- CREATE TABLE / INDEX / FK / CHECK nas 3 tabelas NOVAS e o bloco RLS delas.
-- Nenhuma tabela existente é alterada (zero DDL em Produto, CADCATEGORIA,
-- Empresa, Cliente ou SuplementacaoEvento) e nenhum dado é migrado ou semeado.
-- As relações inversas do schema são só do Prisma.
--
-- Escopo garantido pelo banco: toda FK é composta pelo tenant. A formulação
-- aponta para Empresa(cliente_id, id) e para Produto(cliente_id, id), Restrict.
-- Ingrediente e regra apontam para a formulação por (cliente_id, empresa_id,
-- id) — MESMO tenant e MESMA fazenda por construção — com ON DELETE CASCADE
-- (saem junto com a formulação); ingrediente → Produto e regra → CADCATEGORIA
-- pelo tenant, Restrict: excluir produto, categoria ou fazenda em uso é barrado.
--
-- Reversão operacional (não executada em produção): as 3 tabelas são novas e
-- nenhuma tabela antiga as referencia; removê-las (filhas antes da formulação)
-- não afeta dados anteriores a esta migration.

-- CreateTable
CREATE TABLE "CADFORMULACAO" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "percentual_pv_padrao" DECIMAL(8,4) NOT NULL,
    "consumo_objetivo_g_cab_dia" DECIMAL(10,2),
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CADFORMULACAO_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CADFORMULACAOINGREDIENTE" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "formulacao_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "quantidade_kg" DECIMAL(12,3) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CADFORMULACAOINGREDIENTE_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CADFORMULACAOREGRA" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "formulacao_id" VARCHAR(64) NOT NULL,
    "categoria_manejo_id" VARCHAR(64) NOT NULL,
    "consome" BOOLEAN NOT NULL,
    "percentual_pv" DECIMAL(8,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CADFORMULACAOREGRA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CADFORMULACAO_cliente_id_empresa_id_ativo_idx" ON "CADFORMULACAO"("cliente_id", "empresa_id", "ativo");

-- CreateIndex
CREATE INDEX "CADFORMULACAO_cliente_id_produto_id_idx" ON "CADFORMULACAO"("cliente_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "CADFORMULACAO_cliente_id_id_key" ON "CADFORMULACAO"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADFORMULACAO_cliente_id_empresa_id_id_key" ON "CADFORMULACAO"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADFORMULACAO_cliente_id_empresa_id_nome_key" ON "CADFORMULACAO"("cliente_id", "empresa_id", "nome");

-- CreateIndex
CREATE INDEX "CADFORMULACAOINGREDIENTE_cliente_id_produto_id_idx" ON "CADFORMULACAOINGREDIENTE"("cliente_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "CADFORMULACAOINGREDIENTE_cliente_id_id_key" ON "CADFORMULACAOINGREDIENTE"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADFORMULACAOINGREDIENTE_cliente_id_formulacao_id_produto_i_key" ON "CADFORMULACAOINGREDIENTE"("cliente_id", "formulacao_id", "produto_id");

-- CreateIndex
CREATE INDEX "CADFORMULACAOREGRA_cliente_id_categoria_manejo_id_idx" ON "CADFORMULACAOREGRA"("cliente_id", "categoria_manejo_id");

-- CreateIndex
CREATE UNIQUE INDEX "CADFORMULACAOREGRA_cliente_id_id_key" ON "CADFORMULACAOREGRA"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADFORMULACAOREGRA_cliente_id_formulacao_id_categoria_manej_key" ON "CADFORMULACAOREGRA"("cliente_id", "formulacao_id", "categoria_manejo_id");

-- AddForeignKey
ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAOINGREDIENTE" ADD CONSTRAINT "CADFORMULACAOINGREDIENTE_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAOINGREDIENTE" ADD CONSTRAINT "CADFORMULACAOINGREDIENTE_cliente_id_empresa_id_formulacao__fkey" FOREIGN KEY ("cliente_id", "empresa_id", "formulacao_id") REFERENCES "CADFORMULACAO"("cliente_id", "empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAOINGREDIENTE" ADD CONSTRAINT "CADFORMULACAOINGREDIENTE_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAOREGRA" ADD CONSTRAINT "CADFORMULACAOREGRA_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAOREGRA" ADD CONSTRAINT "CADFORMULACAOREGRA_cliente_id_empresa_id_formulacao_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "formulacao_id") REFERENCES "CADFORMULACAO"("cliente_id", "empresa_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADFORMULACAOREGRA" ADD CONSTRAINT "CADFORMULACAOREGRA_cliente_id_categoria_manejo_id_fkey" FOREIGN KEY ("cliente_id", "categoria_manejo_id") REFERENCES "CADCATEGORIA"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Forma e faixas: o serviço valida antes; o banco é a última barreira.
-- Tipo fechado; %PV padrão de (0, 5]; consumo objetivo positivo quando informado.
ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_tipo_check" CHECK ("tipo" IN ('PRONTO', 'BATELADA'));

ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_percentual_pv_padrao_check" CHECK ("percentual_pv_padrao" > 0 AND "percentual_pv_padrao" <= 5);

ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_consumo_objetivo_check" CHECK ("consumo_objetivo_g_cab_dia" IS NULL OR "consumo_objetivo_g_cab_dia" > 0);

-- Ingrediente: quantidade positiva (kg por batida).
ALTER TABLE "CADFORMULACAOINGREDIENTE" ADD CONSTRAINT "CADFORMULACAOINGREDIENTE_quantidade_kg_check" CHECK ("quantidade_kg" > 0);

-- Regra: não consome → sem %PV; consome → %PV próprio de (0, 5].
ALTER TABLE "CADFORMULACAOREGRA" ADD CONSTRAINT "CADFORMULACAOREGRA_forma_check" CHECK (("consome" = false AND "percentual_pv" IS NULL) OR ("consome" = true AND "percentual_pv" IS NOT NULL AND "percentual_pv" > 0 AND "percentual_pv" <= 5));

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA'];
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
