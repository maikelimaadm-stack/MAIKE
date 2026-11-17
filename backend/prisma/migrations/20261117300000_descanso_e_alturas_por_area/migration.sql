-- MAIKE-DESCANSO-ESTIMADO — dias de descanso da cultura (o descanso normal do pasto
-- entre uma saída e a próxima entrada do gado) e os parâmetros próprios do pasto:
-- alturas de entrada e de saída e dias de descanso na Área, para pastos mais fracos
-- que a cultura em geral. Vazio na Área = usa o valor da cultura, campo a campo.
-- Com eles o farol de forragem estima a situação dos pastos sem medição recente e a
-- Medição de Forragem calcula a situação pelas alturas que valem para o pasto.
-- Decisão, relatório e runbook em docs/engineering/ (MAIKE-DESCANSO-ESTIMADO-*.md).
-- O número da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca
-- muda o checksum aplicado.
--
-- EXPAND-ONLY: quatro colunas anuláveis, sem DEFAULT, em tabelas existentes. Nenhuma
-- linha muda de valor. As faixas (alturas > 0 e até 1000 cm com 1 casa, saída menor que
-- a entrada; dias de 1 a 365) são conferidas pela API: a allowlist EXPAND recusa CHECK
-- em tabela antiga.
--
-- Reversão operacional (não executada em produção): DROP COLUMN das quatro colunas.

-- AlterTable
ALTER TABLE "CADCULTURAS" ADD COLUMN "dias_descanso" INTEGER;

-- AlterTable
ALTER TABLE "AreaPastagem" ADD COLUMN "altura_entrada_cm" DECIMAL(6,1);

-- AlterTable
ALTER TABLE "AreaPastagem" ADD COLUMN "altura_saida_cm" DECIMAL(6,1);

-- AlterTable
ALTER TABLE "AreaPastagem" ADD COLUMN "dias_descanso" INTEGER;
