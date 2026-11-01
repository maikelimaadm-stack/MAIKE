-- MAIKE-LOTES-R1 — exclusão LÓGICA (tombstone) do Lote de entrada cujo histórico
-- é só de movimentos do mapa cancelados com prova (ver DECISIONS.md).
--
-- Expand-only: duas colunas NULL, sem default, sem backfill, sem índice.
-- Lote existente fica com excluido_em NULL = continua exatamente como antes.
-- O código novo só filtra `excluido_em IS NULL`; o antigo ignora as colunas,
-- então a ordem "migration antes do código" (D-PROD-28) é compatível e o
-- código antigo continua funcionando com o banco migrado.
--
-- Rollback (só se nenhum lote tiver sido excluído logicamente — conferir antes):
--   SELECT count(*) FROM "Lote" WHERE "excluido_em" IS NOT NULL;  -- precisa ser 0
--   ALTER TABLE "Lote" DROP COLUMN "excluido_em", DROP COLUMN "excluido_por_usuario_id";

-- AlterTable
ALTER TABLE "Lote" ADD COLUMN "excluido_em" TIMESTAMP(3),
ADD COLUMN "excluido_por_usuario_id" VARCHAR(64);
