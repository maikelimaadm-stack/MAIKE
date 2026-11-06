-- MAIKE-SAAS-ADMIN-S04-P1 — revogação durável das sessões de fazenda.
--
-- Expand-only: duas colunas inteiras com DEFAULT 0, sem índice novo e sem
-- tocar ids, uniques ou chaves de tenancy. Linhas existentes ficam na época 0.
-- O runtime novo exige as épocas no JWT, então todo token emitido antes desta
-- versão é recusado uma única vez (novo login). A época só cresce; o CHECK
-- impede valor negativo gravado por fora do backend.

ALTER TABLE "Cliente" ADD COLUMN "sessao_epoca" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Usuario" ADD COLUMN "sessao_epoca" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_sessao_epoca_nao_negativa" CHECK ("sessao_epoca" >= 0);
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_sessao_epoca_nao_negativa" CHECK ("sessao_epoca" >= 0);
