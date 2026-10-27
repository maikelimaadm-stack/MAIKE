-- CreateTable
CREATE TABLE "GrupoAtividade" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "nome_grupo" VARCHAR(255) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "descricao" VARCHAR(2000),
    "cor_icone" VARCHAR(64),
    "observacoes" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrupoAtividade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoTarefa" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "nome_tipo" VARCHAR(255) NOT NULL,
    "grupo_atividade_id" VARCHAR(64) NOT NULL,
    "grupo_atividade_nome" VARCHAR(255) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "descricao" VARCHAR(2000),
    "exige_area" BOOLEAN NOT NULL DEFAULT false,
    "pode_ter_produto" BOOLEAN NOT NULL DEFAULT false,
    "pode_ter_maquina" BOOLEAN NOT NULL DEFAULT false,
    "pode_ter_implemento" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoTarefa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GrupoAtividade_cliente_id_ativo_idx" ON "GrupoAtividade"("cliente_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "GrupoAtividade_cliente_id_nome_grupo_key" ON "GrupoAtividade"("cliente_id", "nome_grupo");

-- CreateIndex
CREATE UNIQUE INDEX "GrupoAtividade_cliente_id_id_key" ON "GrupoAtividade"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "TipoTarefa_cliente_id_grupo_atividade_id_idx" ON "TipoTarefa"("cliente_id", "grupo_atividade_id");

-- CreateIndex
CREATE INDEX "TipoTarefa_cliente_id_ativo_idx" ON "TipoTarefa"("cliente_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoTarefa_cliente_id_grupo_atividade_id_nome_tipo_key" ON "TipoTarefa"("cliente_id", "grupo_atividade_id", "nome_tipo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoTarefa_cliente_id_id_key" ON "TipoTarefa"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "GrupoAtividade" ADD CONSTRAINT "GrupoAtividade_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoTarefa" ADD CONSTRAINT "TipoTarefa_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoTarefa" ADD CONSTRAINT "TipoTarefa_cliente_id_grupo_atividade_id_fkey" FOREIGN KEY ("cliente_id", "grupo_atividade_id") REFERENCES "GrupoAtividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
