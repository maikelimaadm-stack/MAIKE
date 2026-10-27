-- CreateTable
CREATE TABLE "LancamentoTarefa" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descricao" VARCHAR(2000),
    "tipo" VARCHAR(64) NOT NULL,
    "tipo_tarefa_id" VARCHAR(64) NOT NULL,
    "tipo_tarefa_nome" VARCHAR(255) NOT NULL,
    "grupo_atividade_id" VARCHAR(64),
    "grupo_atividade_nome" VARCHAR(255),
    "solicitante" VARCHAR(255),
    "data_pedido" DATE,
    "setor_nome" VARCHAR(255),
    "prioridade" VARCHAR(32) NOT NULL DEFAULT 'Média',
    "status" VARCHAR(32) NOT NULL DEFAULT 'Pendente',
    "data_prevista" DATE,
    "data_inicio" TIMESTAMP(3),
    "data_conclusao" DATE,
    "area_id" VARCHAR(64),
    "area_nome" VARCHAR(255),
    "lote_id" VARCHAR(64),
    "lote_nome" VARCHAR(255),
    "ponto_suplementacao_id" VARCHAR(64),
    "coordenadas" JSONB,
    "responsavel_id" VARCHAR(64),
    "responsavel" VARCHAR(255),
    "responsavel_geral" VARCHAR(255),
    "observacoes" VARCHAR(2000),
    "observacoes_conclusao" VARCHAR(2000),
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "anexos_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LancamentoTarefa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricoLancamentoTarefa" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "tarefa_id" VARCHAR(64) NOT NULL,
    "titulo_tarefa" VARCHAR(255),
    "evento" VARCHAR(64) NOT NULL,
    "data_evento" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(32),
    "responsavel" VARCHAR(255),
    "descricao" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricoLancamentoTarefa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_empresa_id_idx" ON "LancamentoTarefa"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_tipo_tarefa_id_idx" ON "LancamentoTarefa"("cliente_id", "tipo_tarefa_id");

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_grupo_atividade_id_idx" ON "LancamentoTarefa"("cliente_id", "grupo_atividade_id");

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_lote_id_idx" ON "LancamentoTarefa"("cliente_id", "lote_id");

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_area_id_idx" ON "LancamentoTarefa"("cliente_id", "area_id");

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_status_idx" ON "LancamentoTarefa"("cliente_id", "status");

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_updatedAt_idx" ON "LancamentoTarefa"("cliente_id", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LancamentoTarefa_cliente_id_id_key" ON "LancamentoTarefa"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "HistoricoLancamentoTarefa_cliente_id_tarefa_id_idx" ON "HistoricoLancamentoTarefa"("cliente_id", "tarefa_id");

-- CreateIndex
CREATE INDEX "HistoricoLancamentoTarefa_cliente_id_empresa_id_idx" ON "HistoricoLancamentoTarefa"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "HistoricoLancamentoTarefa_cliente_id_data_evento_idx" ON "HistoricoLancamentoTarefa"("cliente_id", "data_evento");

-- CreateIndex
CREATE UNIQUE INDEX "HistoricoLancamentoTarefa_cliente_id_id_key" ON "HistoricoLancamentoTarefa"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "LancamentoTarefa" ADD CONSTRAINT "LancamentoTarefa_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoTarefa" ADD CONSTRAINT "LancamentoTarefa_cliente_id_tipo_tarefa_id_fkey" FOREIGN KEY ("cliente_id", "tipo_tarefa_id") REFERENCES "TipoTarefa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoTarefa" ADD CONSTRAINT "LancamentoTarefa_cliente_id_grupo_atividade_id_fkey" FOREIGN KEY ("cliente_id", "grupo_atividade_id") REFERENCES "GrupoAtividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoTarefa" ADD CONSTRAINT "LancamentoTarefa_cliente_id_lote_id_fkey" FOREIGN KEY ("cliente_id", "lote_id") REFERENCES "Lote"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LancamentoTarefa" ADD CONSTRAINT "LancamentoTarefa_cliente_id_area_id_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoLancamentoTarefa" ADD CONSTRAINT "HistoricoLancamentoTarefa_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoLancamentoTarefa" ADD CONSTRAINT "HistoricoLancamentoTarefa_cliente_id_tarefa_id_fkey" FOREIGN KEY ("cliente_id", "tarefa_id") REFERENCES "LancamentoTarefa"("cliente_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
