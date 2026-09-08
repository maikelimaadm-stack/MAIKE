-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "codigo" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "login" VARCHAR(120) NOT NULL,
    "senha_hash" VARCHAR(255) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "usuario_id" VARCHAR(64),
    "acao" VARCHAR(64) NOT NULL,
    "entidade" VARCHAR(128) NOT NULL,
    "entidade_id" VARCHAR(128),
    "dados_anteriores" JSONB,
    "dados_novos" JSONB,
    "request_id" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntidadeCodigoSequencia" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "entidade" VARCHAR(128) NOT NULL,
    "escopo_tipo" VARCHAR(32) NOT NULL,
    "escopo_id" VARCHAR(64) NOT NULL,
    "proximo_valor" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntidadeCodigoSequencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistroAnexo" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "entidade" VARCHAR(128) NOT NULL,
    "entidade_id" VARCHAR(128) NOT NULL,
    "nome_original" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "checksum" VARCHAR(128),
    "criado_por" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegistroAnexo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_codigo_key" ON "Cliente"("codigo");

-- CreateIndex
CREATE INDEX "Cliente_nome_idx" ON "Cliente"("nome");

-- CreateIndex
CREATE INDEX "Cliente_ativo_idx" ON "Cliente"("ativo");

-- CreateIndex
CREATE INDEX "Usuario_cliente_id_ativo_idx" ON "Usuario"("cliente_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_cliente_id_login_key" ON "Usuario"("cliente_id", "login");

-- CreateIndex
CREATE INDEX "AuditLog_cliente_id_createdAt_idx" ON "AuditLog"("cliente_id", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_cliente_id_entidade_entidade_id_idx" ON "AuditLog"("cliente_id", "entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "AuditLog_cliente_id_usuario_id_idx" ON "AuditLog"("cliente_id", "usuario_id");

-- CreateIndex
CREATE INDEX "AuditLog_cliente_id_request_id_idx" ON "AuditLog"("cliente_id", "request_id");

-- CreateIndex
CREATE INDEX "EntidadeCodigoSequencia_cliente_id_entidade_idx" ON "EntidadeCodigoSequencia"("cliente_id", "entidade");

-- CreateIndex
CREATE UNIQUE INDEX "EntidadeCodigoSequencia_cliente_id_entidade_escopo_tipo_esc_key" ON "EntidadeCodigoSequencia"("cliente_id", "entidade", "escopo_tipo", "escopo_id");

-- CreateIndex
CREATE INDEX "RegistroAnexo_cliente_id_entidade_entidade_id_idx" ON "RegistroAnexo"("cliente_id", "entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "RegistroAnexo_cliente_id_createdAt_idx" ON "RegistroAnexo"("cliente_id", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RegistroAnexo_cliente_id_storage_key_key" ON "RegistroAnexo"("cliente_id", "storage_key");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntidadeCodigoSequencia" ADD CONSTRAINT "EntidadeCodigoSequencia_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistroAnexo" ADD CONSTRAINT "RegistroAnexo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
