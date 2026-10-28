-- D-PROD-57 / D-PROD-60 — catálogo global slice 1 (backend)
-- Tabelas globais sem cliente_id + hardening P8 para objetos novos pós-migration P8.

-- CreateTable
CREATE TABLE "CatalogoMeta" (
    "id" TEXT NOT NULL,
    "chave" VARCHAR(32) NOT NULL DEFAULT 'global',
    "revisao" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoTipoEntidade" (
    "id" TEXT NOT NULL,
    "codigo" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoTipoEntidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoCategoriaVisual" (
    "id" TEXT NOT NULL,
    "tipo_id" VARCHAR(64) NOT NULL,
    "codigo" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoCategoriaVisual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoAsset" (
    "id" TEXT NOT NULL,
    "bucket" VARCHAR(128) NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "mime" VARCHAR(128) NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "largura" INTEGER,
    "altura" INTEGER,
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "estado" VARCHAR(32) NOT NULL DEFAULT 'pendente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoIcone" (
    "id" TEXT NOT NULL,
    "tipo_id" VARCHAR(64) NOT NULL,
    "categoria_id" VARCHAR(64) NOT NULL,
    "asset_principal_id" VARCHAR(64),
    "asset_subicone_id" VARCHAR(64),
    "cor_fallback" VARCHAR(32),
    "estado" VARCHAR(32) NOT NULL DEFAULT 'rascunho',
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoIcone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoRegraMisto" (
    "id" TEXT NOT NULL,
    "tipo_id" VARCHAR(64) NOT NULL,
    "icone_id" VARCHAR(64) NOT NULL,
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "especificidade" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "estado" VARCHAR(32) NOT NULL DEFAULT 'rascunho',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoRegraMisto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoRegraMistoCategoria" (
    "id" TEXT NOT NULL,
    "regra_id" VARCHAR(64) NOT NULL,
    "categoria_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogoRegraMistoCategoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperadorProdutoMaike" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "usuario_id" VARCHAR(64) NOT NULL,
    "papel" VARCHAR(32) NOT NULL DEFAULT 'editor',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperadorProdutoMaike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditoriaCatalogoGlobal" (
    "id" TEXT NOT NULL,
    "operador_id" VARCHAR(64),
    "acao" VARCHAR(64) NOT NULL,
    "entidade" VARCHAR(64) NOT NULL,
    "entidade_id" VARCHAR(64),
    "dados" JSONB,
    "request_id" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditoriaCatalogoGlobal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoMeta_chave_key" ON "CatalogoMeta"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoTipoEntidade_codigo_key" ON "CatalogoTipoEntidade"("codigo");

-- CreateIndex
CREATE INDEX "CatalogoTipoEntidade_ativo_ordem_idx" ON "CatalogoTipoEntidade"("ativo", "ordem");

-- CreateIndex
CREATE INDEX "CatalogoCategoriaVisual_tipo_id_ativo_ordem_idx" ON "CatalogoCategoriaVisual"("tipo_id", "ativo", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoCategoriaVisual_tipo_id_codigo_key" ON "CatalogoCategoriaVisual"("tipo_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoAsset_storage_path_key" ON "CatalogoAsset"("storage_path");

-- CreateIndex
CREATE INDEX "CatalogoAsset_estado_idx" ON "CatalogoAsset"("estado");

-- CreateIndex
CREATE INDEX "CatalogoIcone_tipo_id_categoria_id_estado_idx" ON "CatalogoIcone"("tipo_id", "categoria_id", "estado");

-- CreateIndex
CREATE INDEX "CatalogoIcone_estado_ativo_idx" ON "CatalogoIcone"("estado", "ativo");

-- CreateIndex
CREATE INDEX "CatalogoRegraMisto_tipo_id_estado_prioridade_especificidade_idx" ON "CatalogoRegraMisto"("tipo_id", "estado", "prioridade", "especificidade");

-- CreateIndex
CREATE INDEX "CatalogoRegraMistoCategoria_regra_id_ordem_idx" ON "CatalogoRegraMistoCategoria"("regra_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoRegraMistoCategoria_regra_id_categoria_id_key" ON "CatalogoRegraMistoCategoria"("regra_id", "categoria_id");

-- CreateIndex
CREATE INDEX "OperadorProdutoMaike_ativo_idx" ON "OperadorProdutoMaike"("ativo");

-- CreateIndex
CREATE UNIQUE INDEX "OperadorProdutoMaike_cliente_id_usuario_id_key" ON "OperadorProdutoMaike"("cliente_id", "usuario_id");

-- CreateIndex
CREATE INDEX "AuditoriaCatalogoGlobal_createdAt_idx" ON "AuditoriaCatalogoGlobal"("createdAt");

-- CreateIndex
CREATE INDEX "AuditoriaCatalogoGlobal_entidade_entidade_id_idx" ON "AuditoriaCatalogoGlobal"("entidade", "entidade_id");

-- AddForeignKey
ALTER TABLE "CatalogoCategoriaVisual" ADD CONSTRAINT "CatalogoCategoriaVisual_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "CatalogoTipoEntidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoIcone" ADD CONSTRAINT "CatalogoIcone_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "CatalogoTipoEntidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoIcone" ADD CONSTRAINT "CatalogoIcone_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "CatalogoCategoriaVisual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoIcone" ADD CONSTRAINT "CatalogoIcone_asset_principal_id_fkey" FOREIGN KEY ("asset_principal_id") REFERENCES "CatalogoAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoIcone" ADD CONSTRAINT "CatalogoIcone_asset_subicone_id_fkey" FOREIGN KEY ("asset_subicone_id") REFERENCES "CatalogoAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoRegraMisto" ADD CONSTRAINT "CatalogoRegraMisto_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "CatalogoTipoEntidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoRegraMisto" ADD CONSTRAINT "CatalogoRegraMisto_icone_id_fkey" FOREIGN KEY ("icone_id") REFERENCES "CatalogoIcone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoRegraMistoCategoria" ADD CONSTRAINT "CatalogoRegraMistoCategoria_regra_id_fkey" FOREIGN KEY ("regra_id") REFERENCES "CatalogoRegraMisto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogoRegraMistoCategoria" ADD CONSTRAINT "CatalogoRegraMistoCategoria_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "CatalogoCategoriaVisual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperadorProdutoMaike" ADD CONSTRAINT "OperadorProdutoMaike_cliente_id_usuario_id_fkey" FOREIGN KEY ("cliente_id", "usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditoriaCatalogoGlobal" ADD CONSTRAINT "AuditoriaCatalogoGlobal_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "OperadorProdutoMaike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "CatalogoMeta" ("id", "chave", "revisao", "updatedAt")
VALUES ('cmcatalogoglobalmeta000000000001', 'global', 0, CURRENT_TIMESTAMP)
ON CONFLICT ("chave") DO NOTHING;

-- P8 hardening — novas tabelas do catálogo global
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY[
    'CatalogoMeta',
    'CatalogoTipoEntidade',
    'CatalogoCategoriaVisual',
    'CatalogoAsset',
    'CatalogoIcone',
    'CatalogoRegraMisto',
    'CatalogoRegraMistoCategoria',
    'OperadorProdutoMaike',
    'AuditoriaCatalogoGlobal'
  ];
BEGIN
  FOREACH tbl IN ARRAY tabelas
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO maike_vercel USING (true) WITH CHECK (true)',
        pol_name,
        tbl
      );
    END IF;
  END LOOP;
END $$;
