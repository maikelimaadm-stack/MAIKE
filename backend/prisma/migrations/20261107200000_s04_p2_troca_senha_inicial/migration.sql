-- MAIKE-SAAS-ADMIN-S04-P2 — troca obrigatória da senha temporária no primeiro acesso.
--
-- EXPAND puro (allowlist do pré-merge, D-PROD-107): uma coluna BOOLEAN anulável,
-- sem DEFAULT, sem índice, sem UPDATE. Nenhuma conta existente muda: NULL vale
-- false e o runtime anterior ignora a coluna. Só a criação de fazenda pelo MAIKE
-- Admin grava true; só a conclusão da troca grava false.

ALTER TABLE "Usuario" ADD COLUMN "troca_senha_pendente" BOOLEAN;
