-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_lote" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "identificador_nome" VARCHAR(255),
    "identificador_sigla" VARCHAR(32),
    "identificador_cor" VARCHAR(32),
    "quantidade_cabecas" INTEGER NOT NULL,
    "quantidade_entrada" INTEGER NOT NULL,
    "categoria" VARCHAR(128),
    "categoria_entrada" VARCHAR(128),
    "categoria_manejo_id" VARCHAR(64),
    "categoria_manejo_nome" VARCHAR(255),
    "categoria_manejo_entrada_id" VARCHAR(64),
    "categoria_manejo_entrada_nome" VARCHAR(255),
    "sexo" VARCHAR(32),
    "peso_medio_kg" DECIMAL(14,4),
    "peso_entrada_kg" DECIMAL(14,4),
    "idade_media_meses" INTEGER,
    "setor_id" VARCHAR(64),
    "setor_nome" VARCHAR(255),
    "area_entrada_id" VARCHAR(64),
    "area_entrada_nome" VARCHAR(255),
    "area_atual_id" VARCHAR(64),
    "area_atual_nome" VARCHAR(255),
    "raca_predominante" VARCHAR(128),
    "sistema_produtivo" VARCHAR(128),
    "data_entrada" DATE,
    "motivo_entrada" VARCHAR(32) NOT NULL,
    "origem" VARCHAR(128),
    "fornecedor_id" VARCHAR(64),
    "fornecedor_nome" VARCHAR(255),
    "nota_fiscal" VARCHAR(64),
    "chave_nfe" VARCHAR(64),
    "numero_gta" VARCHAR(64),
    "cidade_origem" VARCHAR(128),
    "estado_origem" VARCHAR(8),
    "valor_total_compra" DECIMAL(14,4),
    "valor_por_cabeca" DECIMAL(14,4),
    "valor_frete" DECIMAL(14,4),
    "motivo_ajuste" VARCHAR(255),
    "motivo_outros" VARCHAR(255),
    "observacoes" VARCHAR(2000),
    "status" VARCHAR(32) NOT NULL DEFAULT 'Ativo',
    "campos_personalizados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lote_cliente_id_empresa_id_idx" ON "Lote"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "Lote_cliente_id_setor_id_idx" ON "Lote"("cliente_id", "setor_id");

-- CreateIndex
CREATE INDEX "Lote_cliente_id_area_atual_id_idx" ON "Lote"("cliente_id", "area_atual_id");

-- CreateIndex
CREATE INDEX "Lote_cliente_id_status_idx" ON "Lote"("cliente_id", "status");

-- CreateIndex
CREATE INDEX "Lote_cliente_id_nome_idx" ON "Lote"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_cliente_id_numero_lote_key" ON "Lote"("cliente_id", "numero_lote");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_cliente_id_id_key" ON "Lote"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_cliente_id_setor_id_fkey" FOREIGN KEY ("cliente_id", "setor_id") REFERENCES "Setor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_cliente_id_area_entrada_id_fkey" FOREIGN KEY ("cliente_id", "area_entrada_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lote" ADD CONSTRAINT "Lote_cliente_id_area_atual_id_fkey" FOREIGN KEY ("cliente_id", "area_atual_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
