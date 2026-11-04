-- D-PROD-122 (S1/H1) — fuso IANA da fazenda para o "hoje" do ledger do rebanho.
--
-- EXPAND puro, compatível com o backend publicado (que não lê a coluna):
--   - Empresa.fuso_horario VARCHAR(64) NULL, sem DEFAULT (nenhum fuso é
--     presumido; nulo = não configurado e a escrita nova do ledger falha fechada).
-- Nenhum dado é alterado ou preenchido por esta migration.
--
-- Rollback (só antes de qualquer empresa configurada — conferir antes):
--   SELECT count(*) FROM "Empresa" WHERE fuso_horario IS NOT NULL;  -- 0
--   ALTER TABLE "Empresa" DROP COLUMN "fuso_horario";

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN     "fuso_horario" VARCHAR(64);
