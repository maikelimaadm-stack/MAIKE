-- CreateTable
CREATE TABLE "ConfiguracaoIcone" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64),
    "tipo_entidade" VARCHAR(64) NOT NULL,
    "categoria" VARCHAR(255) NOT NULL,
    "icone_url" VARCHAR(1024),
    "sub_icone_url" VARCHAR(1024),
    "cor_padrao" VARCHAR(32),
    "descricao" VARCHAR(2000),
    "categorias_misto" JSONB,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfiguracaoIcone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PontoReferencia" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_ponto" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "sigla" VARCHAR(32),
    "tipo" VARCHAR(128) NOT NULL,
    "configuracao_icone_id" VARCHAR(64),
    "icone_url" VARCHAR(1024),
    "sub_icone_url" VARCHAR(1024),
    "coordenadas" JSONB,
    "cor" VARCHAR(32),
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PontoReferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinhaGeografica" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_linha" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "sigla" VARCHAR(32),
    "tipo" VARCHAR(64) NOT NULL,
    "coordenadas" JSONB,
    "comprimento_metros" DECIMAL(14,4),
    "cor" VARCHAR(32),
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinhaGeografica_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConfiguracaoIcone_cliente_id_tipo_entidade_idx" ON "ConfiguracaoIcone"("cliente_id", "tipo_entidade");

-- CreateIndex
CREATE INDEX "ConfiguracaoIcone_cliente_id_ativo_idx" ON "ConfiguracaoIcone"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "ConfiguracaoIcone_cliente_id_categoria_idx" ON "ConfiguracaoIcone"("cliente_id", "categoria");

-- CreateIndex
CREATE UNIQUE INDEX "ConfiguracaoIcone_cliente_id_id_key" ON "ConfiguracaoIcone"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "PontoReferencia_cliente_id_empresa_id_idx" ON "PontoReferencia"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "PontoReferencia_cliente_id_ativo_idx" ON "PontoReferencia"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "PontoReferencia_cliente_id_nome_idx" ON "PontoReferencia"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "PontoReferencia_cliente_id_numero_ponto_key" ON "PontoReferencia"("cliente_id", "numero_ponto");

-- CreateIndex
CREATE UNIQUE INDEX "PontoReferencia_cliente_id_id_key" ON "PontoReferencia"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "LinhaGeografica_cliente_id_empresa_id_idx" ON "LinhaGeografica"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "LinhaGeografica_cliente_id_ativo_idx" ON "LinhaGeografica"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "LinhaGeografica_cliente_id_nome_idx" ON "LinhaGeografica"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "LinhaGeografica_cliente_id_numero_linha_key" ON "LinhaGeografica"("cliente_id", "numero_linha");

-- CreateIndex
CREATE UNIQUE INDEX "LinhaGeografica_cliente_id_id_key" ON "LinhaGeografica"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "ConfiguracaoIcone" ADD CONSTRAINT "ConfiguracaoIcone_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PontoReferencia" ADD CONSTRAINT "PontoReferencia_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinhaGeografica" ADD CONSTRAINT "LinhaGeografica_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
