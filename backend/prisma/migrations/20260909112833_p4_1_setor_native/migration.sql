-- CreateTable
CREATE TABLE "Setor" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_setor" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "sigla" VARCHAR(32),
    "tipo" VARCHAR(32) NOT NULL,
    "responsavel" VARCHAR(255),
    "telefone" VARCHAR(64),
    "endereco" VARCHAR(255),
    "cidade" VARCHAR(255),
    "estado" VARCHAR(8),
    "area_total" DECIMAL(14,4),
    "capacidade_animais" INTEGER,
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Setor_cliente_id_empresa_id_idx" ON "Setor"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "Setor_cliente_id_ativo_idx" ON "Setor"("cliente_id", "ativo");

-- CreateIndex
CREATE INDEX "Setor_cliente_id_nome_idx" ON "Setor"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Setor_cliente_id_numero_setor_key" ON "Setor"("cliente_id", "numero_setor");

-- CreateIndex
CREATE UNIQUE INDEX "Setor_cliente_id_id_key" ON "Setor"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "Setor" ADD CONSTRAINT "Setor_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
