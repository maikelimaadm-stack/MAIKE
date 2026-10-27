-- CreateTable
CREATE TABLE "Categoria" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "numero_categoria" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "categoria_pai_id" VARCHAR(64),
    "categoria_pai_nome" VARCHAR(255),
    "descricao" VARCHAR(2000),
    "ordem" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalEstoque" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "numero_local" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "descricao" VARCHAR(2000),
    "capacidade" VARCHAR(255),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_produto" VARCHAR(32) NOT NULL,
    "nome_produto" VARCHAR(255) NOT NULL,
    "tipo_uso" VARCHAR(64),
    "codigo_interno" VARCHAR(64),
    "codigo_barras" VARCHAR(64),
    "categoria" VARCHAR(255),
    "marca" VARCHAR(255),
    "descricao" VARCHAR(2000),
    "unidade_medida" VARCHAR(32),
    "preco_custo" DECIMAL(14,4),
    "preco_venda" DECIMAL(14,4),
    "estoque_atual" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "estoque_minimo" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "local_estoque" VARCHAR(255),
    "tipo_consumo" VARCHAR(32),
    "percentual_consumo_pv" DECIMAL(14,6),
    "consumo_minimo_pv" DECIMAL(14,6),
    "consumo_maximo_pv" DECIMAL(14,6),
    "unidade_principal_estoque" VARCHAR(16) NOT NULL DEFAULT 'KG',
    "peso_por_saco_kg" DECIMAL(14,4),
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Categoria_cliente_id_ativo_idx" ON "Categoria"("cliente_id", "ativo");
CREATE INDEX "Categoria_cliente_id_nome_idx" ON "Categoria"("cliente_id", "nome");
CREATE INDEX "Categoria_cliente_id_categoria_pai_id_idx" ON "Categoria"("cliente_id", "categoria_pai_id");
CREATE UNIQUE INDEX "Categoria_cliente_id_numero_categoria_key" ON "Categoria"("cliente_id", "numero_categoria");
CREATE UNIQUE INDEX "Categoria_cliente_id_id_key" ON "Categoria"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "LocalEstoque_cliente_id_ativo_idx" ON "LocalEstoque"("cliente_id", "ativo");
CREATE INDEX "LocalEstoque_cliente_id_nome_idx" ON "LocalEstoque"("cliente_id", "nome");
CREATE UNIQUE INDEX "LocalEstoque_cliente_id_numero_local_key" ON "LocalEstoque"("cliente_id", "numero_local");
CREATE UNIQUE INDEX "LocalEstoque_cliente_id_id_key" ON "LocalEstoque"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "Produto_cliente_id_empresa_id_idx" ON "Produto"("cliente_id", "empresa_id");
CREATE INDEX "Produto_cliente_id_ativo_idx" ON "Produto"("cliente_id", "ativo");
CREATE INDEX "Produto_cliente_id_nome_produto_idx" ON "Produto"("cliente_id", "nome_produto");
CREATE UNIQUE INDEX "Produto_cliente_id_numero_produto_key" ON "Produto"("cliente_id", "numero_produto");
CREATE UNIQUE INDEX "Produto_cliente_id_id_key" ON "Produto"("cliente_id", "id");
CREATE UNIQUE INDEX "Produto_cliente_id_empresa_id_nome_produto_key" ON "Produto"("cliente_id", "empresa_id", "nome_produto");

-- AddForeignKey
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Categoria" ADD CONSTRAINT "Categoria_cliente_id_categoria_pai_id_fkey" FOREIGN KEY ("cliente_id", "categoria_pai_id") REFERENCES "Categoria"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LocalEstoque" ADD CONSTRAINT "LocalEstoque_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Produto" ADD CONSTRAINT "Produto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
