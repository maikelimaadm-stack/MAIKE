-- D-PROD-184 — Apontamento de Atividade (Fatia C): a EXECUÇÃO de uma atividade
-- (TipoAtividade, D-PROD-182). A tarefa (LancamentoTarefa) é a demanda; o
-- apontamento é a operação executada (máquina, implemento, operador, área,
-- produção e horas). Base enxuta, SEM itens de custo; o abastecimento se
-- pendura aqui nas fatias seguintes.
--
-- EXPAND-ONLY (classificador `premergeMigrateLib.classificarMigrations`): só
-- CREATE TABLE / INDEX / FK na tabela NOVA "ApontamentoAtividade". Nenhuma
-- tabela existente é alterada (zero DDL em TipoAtividade, GrupoAtividade,
-- BemPatrimonial, AreaPastagem, CentroCusto, CentroResultado, LancamentoTarefa,
-- Usuario, Empresa ou Cliente) e nenhum dado é migrado ou semeado. As relações
-- inversas do schema são só do Prisma: nada muda no banco das tabelas antigas.
--
-- Escopo garantido pelo banco: toda FK é composta por (cliente_id, …) e ON
-- DELETE RESTRICT. Empresa, tipo, grupo, área, lançamento de tarefa e os três
-- usuários (operador, criado_por, cancelado_por) são do MESMO tenant; bem,
-- implemento, centro de custo e centro de resultado apontam para
-- (cliente_id, empresa_id, id) e são da MESMA empresa do apontamento por
-- construção. AreaPastagem e LancamentoTarefa não têm unique por empresa e não
-- são alterados aqui: a empresa deles é invariante do serviço. Excluir um
-- tipo, grupo, bem, área, centro ou tarefa com apontamento é barrado pela FK
-- (P2003). Sem DELETE físico: o cancelamento muda `status` e incrementa `versao`.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nenhuma
-- tabela antiga a referencia; removê-la não afeta dados existentes.

-- CreateTable
CREATE TABLE "ApontamentoAtividade" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "tipo_atividade_id" VARCHAR(64) NOT NULL,
    "tipo_atividade_nome" VARCHAR(255) NOT NULL,
    "grupo_atividade_id" VARCHAR(64) NOT NULL,
    "grupo_atividade_nome" VARCHAR(255) NOT NULL,
    "data_operacional" DATE NOT NULL,
    "hora_inicio" TIMESTAMP(3),
    "hora_fim" TIMESTAMP(3),
    "bem_id" VARCHAR(64),
    "implemento_bem_id" VARCHAR(64),
    "operador_usuario_id" VARCHAR(64),
    "area_id" VARCHAR(64),
    "centro_custo_id" VARCHAR(64),
    "centro_resultado_id" VARCHAR(64),
    "safra_ciclo" VARCHAR(32),
    "quantidade_produzida" DECIMAL(14,4),
    "unidade_producao" VARCHAR(8),
    "horas_trabalhadas" DECIMAL(14,4),
    "lancamento_tarefa_id" VARCHAR(64),
    "observacao" VARCHAR(2000),
    "status" VARCHAR(16) NOT NULL DEFAULT 'CONFIRMADO',
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "criado_por_usuario_id" VARCHAR(64),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApontamentoAtividade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApontamentoAtividade_cliente_id_empresa_id_createdAt_id_idx" ON "ApontamentoAtividade"("cliente_id", "empresa_id", "createdAt", "id");

-- CreateIndex
CREATE INDEX "ApontamentoAtividade_empresa_bem_data_idx" ON "ApontamentoAtividade"("cliente_id", "empresa_id", "bem_id", "data_operacional");

-- CreateIndex
CREATE INDEX "ApontamentoAtividade_empresa_tipo_data_idx" ON "ApontamentoAtividade"("cliente_id", "empresa_id", "tipo_atividade_id", "data_operacional");

-- CreateIndex
CREATE INDEX "ApontamentoAtividade_cliente_id_area_id_idx" ON "ApontamentoAtividade"("cliente_id", "area_id");

-- CreateIndex
CREATE INDEX "ApontamentoAtividade_cliente_id_lancamento_tarefa_id_idx" ON "ApontamentoAtividade"("cliente_id", "lancamento_tarefa_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividade_cliente_id_id_key" ON "ApontamentoAtividade"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividade_cliente_id_empresa_id_id_key" ON "ApontamentoAtividade"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ApontamentoAtividade_cliente_id_numero_key" ON "ApontamentoAtividade"("cliente_id", "numero");

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_cliente_id_tipo_atividade_id_fkey" FOREIGN KEY ("cliente_id", "tipo_atividade_id") REFERENCES "TipoAtividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_cliente_id_grupo_atividade_id_fkey" FOREIGN KEY ("cliente_id", "grupo_atividade_id") REFERENCES "GrupoAtividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_bem_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_implemento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "implemento_bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_operador_fkey" FOREIGN KEY ("cliente_id", "operador_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_cliente_id_area_id_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_centro_resultado_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_cliente_id_lancamento_tarefa_id_fkey" FOREIGN KEY ("cliente_id", "lancamento_tarefa_id") REFERENCES "LancamentoTarefa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApontamentoAtividade" ADD CONSTRAINT "ApontamentoAtividade_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['ApontamentoAtividade'];
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
