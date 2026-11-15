-- MAIKE-ATIVIDADE-MAO-OBRA (Fatia 4 do Lançamento de Atividades) — fecha o custo do
-- apontamento do dia com MÃO DE OBRA e SERVIÇO DE TERCEIRO, e os dois cadastros
-- mínimos que elas pedem: Funcionario (pessoa que não precisa entrar no sistema) e
-- Servico (com a unidade de medida do cadastro existente). Decisão, contrato,
-- runbook e relatório em docs/engineering/ (MAIKE-ATIVIDADE-MAO-OBRA-*.md).
-- O número da decisão fica FORA deste arquivo de propósito.
--
-- EXPAND-ONLY: só tabelas NOVAS (CREATE TABLE / INDEX / CHECK / FK nas novas, RLS
-- das novas). Nenhuma coluna em tabela antiga; nenhum dado migrado.
--
-- Escopo garantido pelo banco: toda FK é composta e tenant-aware, RESTRICT. As
-- linhas apontam para o apontamento, o funcionário e o serviço por
-- (cliente_id, empresa_id, id): mesma fazenda por construção. O parceiro (tabela
-- "Fornecedor") só tem chave (cliente_id, id); a mesma fazenda é conferida no código.

-- CreateTable
CREATE TABLE "Funcionario" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "cargo" VARCHAR(120),
    "tipo" VARCHAR(16) NOT NULL,
    "custo_hora" DECIMAL(14,4),
    "custo_diaria" DECIMAL(14,4),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funcionario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Servico" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "unidade_medida_id" VARCHAR(64) NOT NULL,
    "centro_custo_padrao_id" VARCHAR(64),
    "valor_referencia" DECIMAL(14,4),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Servico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeApontamentoMaoObra" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "apontamento_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "funcionario_id" VARCHAR(64) NOT NULL,
    "tipo_medida" VARCHAR(8) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4),
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

    CONSTRAINT "AtividadeApontamentoMaoObra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeApontamentoServico" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "apontamento_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "servico_id" VARCHAR(64) NOT NULL,
    "fornecedor_parceiro_id" VARCHAR(64),
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade" VARCHAR(32) NOT NULL,
    "valor_unitario" DECIMAL(14,4) NOT NULL,
    "valor_total" DECIMAL(14,4) NOT NULL,
    "documento_referencia" VARCHAR(120),
    "operation_id" VARCHAR(128) NOT NULL,
    "observacao" VARCHAR(500),
    "criado_por_usuario_id" VARCHAR(64),
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "cancelamento_origem" VARCHAR(12),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeApontamentoServico_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Funcionario_cliente_id_empresa_id_ativo_idx" ON "Funcionario"("cliente_id", "empresa_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Funcionario_cliente_id_id_key" ON "Funcionario"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Funcionario_cliente_id_empresa_id_id_key" ON "Funcionario"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Funcionario_cliente_id_numero_key" ON "Funcionario"("cliente_id", "numero");

-- CreateIndex
CREATE INDEX "Servico_cliente_id_empresa_id_ativo_idx" ON "Servico"("cliente_id", "empresa_id", "ativo");

-- CreateIndex
CREATE INDEX "Servico_cliente_id_unidade_medida_id_idx" ON "Servico"("cliente_id", "unidade_medida_id");

-- CreateIndex
CREATE INDEX "Servico_cliente_id_empresa_id_centro_custo_padrao_id_idx" ON "Servico"("cliente_id", "empresa_id", "centro_custo_padrao_id");

-- CreateIndex
CREATE UNIQUE INDEX "Servico_cliente_id_id_key" ON "Servico"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Servico_cliente_id_empresa_id_id_key" ON "Servico"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Servico_cliente_id_numero_key" ON "Servico"("cliente_id", "numero");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_apontamen_idx" ON "AtividadeApontamentoMaoObra"("cliente_id", "empresa_id", "apontamento_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx" ON "AtividadeApontamentoMaoObra"("cliente_id", "empresa_id", "funcionario_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaoObra_cliente_id_id_key" ON "AtividadeApontamentoMaoObra"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_id_key" ON "AtividadeApontamentoMaoObra"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaoObra_cliente_id_operation_id_key" ON "AtividadeApontamentoMaoObra"("cliente_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoMaoObra_apontamento_ordem_key" ON "AtividadeApontamentoMaoObra"("cliente_id", "apontamento_id", "ordem");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoServico_cliente_id_empresa_id_apontamen_idx" ON "AtividadeApontamentoServico"("cliente_id", "empresa_id", "apontamento_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoServico_cliente_id_empresa_id_servico_i_idx" ON "AtividadeApontamentoServico"("cliente_id", "empresa_id", "servico_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamentoServico_cliente_id_fornecedor_parceiro__idx" ON "AtividadeApontamentoServico"("cliente_id", "fornecedor_parceiro_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoServico_cliente_id_id_key" ON "AtividadeApontamentoServico"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoServico_cliente_id_empresa_id_id_key" ON "AtividadeApontamentoServico"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoServico_cliente_id_operation_id_key" ON "AtividadeApontamentoServico"("cliente_id", "operation_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamentoServico_apontamento_ordem_key" ON "AtividadeApontamentoServico"("cliente_id", "apontamento_id", "ordem");

-- Listas fechadas e invariantes (CHECK nas tabelas NOVAS).
ALTER TABLE "Funcionario" ADD CONSTRAINT "Funcionario_valores_check" CHECK ("tipo" IN ('MENSALISTA', 'DIARISTA', 'TAREFEIRO') AND ("custo_hora" IS NULL OR "custo_hora" >= 0) AND ("custo_diaria" IS NULL OR "custo_diaria" >= 0) AND length(btrim("nome")) > 0);
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_valores_check" CHECK (("valor_referencia" IS NULL OR "valor_referencia" >= 0) AND length(btrim("nome")) > 0);
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_status_check" CHECK (("status" = 'CONFIRMADO' AND "cancelado_em" IS NULL AND "motivo_cancelamento" IS NULL AND "cancelamento_origem" IS NULL) OR ("status" = 'CANCELADO' AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND "cancelamento_origem" IN ('LINHA', 'EDICAO', 'APONTAMENTO', 'ATIVIDADE')));
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_valores_check" CHECK ("tipo_medida" IN ('HORA', 'DIARIA', 'TAREFA') AND "quantidade" > 0 AND "ordem" >= 1 AND ("custo_unitario" IS NULL OR "custo_unitario" >= 0) AND (("custo_unitario" IS NULL AND "custo_total" IS NULL) OR ("custo_unitario" IS NOT NULL AND "custo_total" IS NOT NULL AND "custo_total" >= 0)));
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_textos_check" CHECK ("operation_id" ~ '^[A-Za-z0-9_.:-]{8,128}$');
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_status_check" CHECK (("status" = 'CONFIRMADO' AND "cancelado_em" IS NULL AND "motivo_cancelamento" IS NULL AND "cancelamento_origem" IS NULL) OR ("status" = 'CANCELADO' AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND "cancelamento_origem" IN ('LINHA', 'EDICAO', 'APONTAMENTO', 'ATIVIDADE')));
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_valores_check" CHECK ("quantidade" > 0 AND "valor_unitario" >= 0 AND "valor_total" >= 0 AND "ordem" >= 1 AND length(btrim("unidade")) > 0);
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_textos_check" CHECK ("operation_id" ~ '^[A-Za-z0-9_.:-]{8,128}$');

-- AddForeignKey
ALTER TABLE "Funcionario" ADD CONSTRAINT "Funcionario_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Funcionario" ADD CONSTRAINT "Funcionario_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_cliente_id_unidade_medida_id_fkey" FOREIGN KEY ("cliente_id", "unidade_medida_id") REFERENCES "UnidadeMedida"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Servico" ADD CONSTRAINT "Servico_centro_custo_padrao_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_padrao_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_funcionario_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "funcionario_id") REFERENCES "Funcionario"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_servico_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "servico_id") REFERENCES "Servico"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_parceiro_fkey" FOREIGN KEY ("cliente_id", "fornecedor_parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoServico" ADD CONSTRAINT "AtividadeApontamentoServico_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['Funcionario','Servico','AtividadeApontamentoMaoObra','AtividadeApontamentoServico'];
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
