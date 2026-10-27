-- CreateTable
CREATE TABLE "UnidadeMedida" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "numero_unidade" VARCHAR(32) NOT NULL,
    "sigla" VARCHAR(32) NOT NULL,
    "descricao" VARCHAR(255) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnidadeMedida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UnidadeMedida_cliente_id_ativo_idx" ON "UnidadeMedida"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "UnidadeMedida_cliente_id_sigla_idx" ON "UnidadeMedida"("cliente_id", "sigla");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadeMedida_cliente_id_numero_unidade_key" ON "UnidadeMedida"("cliente_id", "numero_unidade");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadeMedida_cliente_id_id_key" ON "UnidadeMedida"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadeMedida_cliente_id_sigla_key" ON "UnidadeMedida"("cliente_id", "sigla");

-- AddForeignKey
ALTER TABLE "UnidadeMedida" ADD CONSTRAINT "UnidadeMedida_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
