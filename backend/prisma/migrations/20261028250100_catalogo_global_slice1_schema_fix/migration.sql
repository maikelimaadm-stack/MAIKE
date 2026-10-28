-- Ajuste pós-revisão gate:tenancy (timestamps + CatalogoMeta.chave).

ALTER TABLE "AuditoriaCatalogoGlobal" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "AuditoriaCatalogoGlobal" SET "updatedAt" = COALESCE("createdAt", CURRENT_TIMESTAMP) WHERE "updatedAt" IS NULL;
ALTER TABLE "AuditoriaCatalogoGlobal" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "CatalogoRegraMistoCategoria" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CatalogoRegraMistoCategoria" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "CatalogoRegraMistoCategoria" SET "createdAt" = CURRENT_TIMESTAMP WHERE "createdAt" IS NULL;
UPDATE "CatalogoRegraMistoCategoria" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
ALTER TABLE "CatalogoRegraMistoCategoria" ALTER COLUMN "createdAt" SET NOT NULL;
ALTER TABLE "CatalogoRegraMistoCategoria" ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "CatalogoMeta" ADD COLUMN IF NOT EXISTS "chave" VARCHAR(32) DEFAULT 'global';
UPDATE "CatalogoMeta" SET "chave" = 'global' WHERE "chave" IS NULL;
ALTER TABLE "CatalogoMeta" ALTER COLUMN "chave" SET NOT NULL;
ALTER TABLE "CatalogoMeta" ALTER COLUMN "id" DROP DEFAULT;

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogoMeta_chave_key" ON "CatalogoMeta"("chave");
