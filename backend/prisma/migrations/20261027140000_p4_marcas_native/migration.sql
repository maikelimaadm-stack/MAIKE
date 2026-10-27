-- CreateTable
CREATE TABLE "Marca" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_marca" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "descricao" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Marca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Marca_cliente_id_empresa_id_idx" ON "Marca"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "Marca_cliente_id_ativo_idx" ON "Marca"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "Marca_cliente_id_nome_idx" ON "Marca"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Marca_cliente_id_numero_marca_key" ON "Marca"("cliente_id", "numero_marca");

-- CreateIndex
CREATE UNIQUE INDEX "Marca_cliente_id_id_key" ON "Marca"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Marca_cliente_id_empresa_id_nome_key" ON "Marca"("cliente_id", "empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "Marca" ADD CONSTRAINT "Marca_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
