-- MAIKE-SAAS-ADMIN-S04-P1 — revogação durável das sessões de fazenda.
--
-- EXPAND puro (allowlist do pré-merge, D-PROD-107): duas colunas INTEGER
-- anuláveis, sem DEFAULT, sem índice, sem UPDATE. O backend anterior ignora as
-- colunas. NULL vale época 0; o único escritor é
-- `sessao_epoca = COALESCE(sessao_epoca, 0) + 1`, então a época só cresce.
-- O runtime novo exige as épocas no JWT: todo token emitido antes desta versão
-- é recusado uma única vez (novo login).

ALTER TABLE "Cliente" ADD COLUMN "sessao_epoca" INTEGER;
ALTER TABLE "Usuario" ADD COLUMN "sessao_epoca" INTEGER;
