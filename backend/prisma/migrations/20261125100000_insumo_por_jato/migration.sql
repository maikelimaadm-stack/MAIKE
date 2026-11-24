-- MAIKE-INSUMO-POR-JATO — "os jatos de hoje": o insumo aplicado com implemento de tanque é lançado por jato. Cada
-- produto de cada jato é uma linha de insumo de sempre (a baixa FIFO, o custo e o estorno não mudam); a linha só
-- ganha o NÚMERO do jato no dia (1, 2, 3…). Decisão, relatório e runbook em docs/engineering/
-- (MAIKE-INSUMO-POR-JATO-*.md). O número da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca
-- muda o checksum.
--
-- EXPAND-ONLY: uma coluna ANULÁVEL, sem DEFAULT, na tabela antiga "AtividadeApontamentoProduto" (nenhuma linha muda
-- de valor; todas ficam nulas = insumo sem jato). Sem CHECK: a allowlist EXPAND recusa CHECK em tabela antiga, e a
-- API confere a faixa (1 a 999). Nenhum DROP, RENAME, ALTER COLUMN, NOT NULL em coluna existente ou DML.
--
-- Reversão operacional (não executada em produção): DROP da coluna.

-- AlterTable
ALTER TABLE "AtividadeApontamentoProduto" ADD COLUMN     "jato" INTEGER;
