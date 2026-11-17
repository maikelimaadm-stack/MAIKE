-- MAIKE-DESCANSO-ESTIMADO — dias de descanso da cultura (o descanso normal do pasto
-- entre uma saída e a próxima entrada do gado). Com ele o farol de forragem estima a
-- situação dos pastos sem medição recente pelos dias desde que o último lote saiu.
-- Decisão, relatório e runbook em docs/engineering/ (MAIKE-DESCANSO-ESTIMADO-*.md).
-- O número da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca
-- muda o checksum aplicado.
--
-- EXPAND-ONLY: uma coluna anulável, sem DEFAULT, em tabela existente. Nenhuma linha
-- muda de valor (todas ficam sem dias de descanso até o cadastro ou o passo de dados
-- do runbook). A faixa 1..365 é conferida pela API (a allowlist EXPAND recusa CHECK
-- em tabela antiga).
--
-- Reversão operacional (não executada em produção): DROP COLUMN "dias_descanso".

-- AlterTable
ALTER TABLE "CADCULTURAS" ADD COLUMN "dias_descanso" INTEGER;
