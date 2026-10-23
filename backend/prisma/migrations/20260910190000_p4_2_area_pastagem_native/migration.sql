-- CreateTable
CREATE TABLE "AreaPastagem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "setor_id" VARCHAR(64) NOT NULL,
    "setor_nome" VARCHAR(255) NOT NULL,
    "numero_area" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "sigla" VARCHAR(32),
    "tamanho_hectares" DECIMAL(14,4) NOT NULL,
    "area_pastejada" DECIMAL(14,4),
    "capacidade_maxima" DECIMAL(14,4),
    "tipo_pastagem" VARCHAR(128),
    "aproveitamento_classificacao" VARCHAR(32) NOT NULL DEFAULT 'Média',
    "tipo_cultura" VARCHAR(32) NOT NULL DEFAULT 'Pastagem',
    "cor" VARCHAR(32),
    "quantidade_atual" INTEGER NOT NULL DEFAULT 0,
    "status_ocupacao" VARCHAR(32) NOT NULL DEFAULT 'Disponível',
    "forragem_kg_ha" DECIMAL(14,4),
    "taxa_crescimento_kg_ha_dia" DECIMAL(14,4),
    "taxa_aproveitamento" DECIMAL(7,4),
    "periodo_estacao" VARCHAR(32),
    "coordenadas" JSONB,
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaPastagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AreaPastagem_cliente_id_empresa_id_idx" ON "AreaPastagem"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "AreaPastagem_cliente_id_setor_id_idx" ON "AreaPastagem"("cliente_id", "setor_id");

-- CreateIndex
CREATE INDEX "AreaPastagem_cliente_id_ativo_idx" ON "AreaPastagem"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "AreaPastagem_cliente_id_nome_idx" ON "AreaPastagem"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "AreaPastagem_cliente_id_numero_area_key" ON "AreaPastagem"("cliente_id", "numero_area");

-- CreateIndex
CREATE UNIQUE INDEX "AreaPastagem_cliente_id_id_key" ON "AreaPastagem"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "AreaPastagem" ADD CONSTRAINT "AreaPastagem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaPastagem" ADD CONSTRAINT "AreaPastagem_cliente_id_setor_id_fkey" FOREIGN KEY ("cliente_id", "setor_id") REFERENCES "Setor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

