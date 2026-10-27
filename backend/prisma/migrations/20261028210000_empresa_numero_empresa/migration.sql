-- EMPRESA-NUM-01: número sequencial tenant-scoped (imutável, sem reuso após delete).

ALTER TABLE "Empresa" ADD COLUMN "numero_empresa" INTEGER;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "cliente_id"
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Empresa"
  WHERE "numero_empresa" IS NULL
)
UPDATE "Empresa" AS e
SET "numero_empresa" = ranked.rn
FROM ranked
WHERE e.id = ranked.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Empresa"
    GROUP BY "cliente_id", "numero_empresa"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Empresa.numero_empresa: duplicata detectada após backfill — reconciliar manualmente';
  END IF;
  IF EXISTS (SELECT 1 FROM "Empresa" WHERE "numero_empresa" IS NULL OR "numero_empresa" < 1) THEN
    RAISE EXCEPTION 'Empresa.numero_empresa: backfill incompleto ou valor inválido';
  END IF;
END $$;

ALTER TABLE "Empresa" ALTER COLUMN "numero_empresa" SET NOT NULL;

CREATE UNIQUE INDEX "Empresa_cliente_id_numero_empresa_key" ON "Empresa"("cliente_id", "numero_empresa");

ALTER TABLE "Empresa"
  ADD CONSTRAINT "Empresa_numero_empresa_positive" CHECK ("numero_empresa" > 0);
