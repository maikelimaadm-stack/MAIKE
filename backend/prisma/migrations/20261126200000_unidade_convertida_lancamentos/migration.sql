-- MAIKE-UNIDADE-CONVERTIDA — "na linha de produto da atividade, no cocho e na transferência, a quantidade pode ser
-- digitada numa unidade de conversão do cadastro do produto" (emenda da Constituição aprovada pelo proprietário). O
-- servidor converte para a unidade de estoque pelo fator cadastrado e grava a unidade, a quantidade digitada e o fator.
-- Decisão, relatório e runbook em docs/engineering/ (MAIKE-UNIDADE-CONVERTIDA-LANCAMENTOS-*.md). O número da decisão
-- fica FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: seis colunas ANULÁVEIS, sem DEFAULT, em duas tabelas antigas (nenhuma linha muda de valor; todas ficam
-- nulas = "sem conversão", o comportamento de sempre):
--   "MovimentacaoEstoque"          — "unidade_lancamento", "quantidade_lancamento" e "fator_lancamento";
--   "AtividadeApontamentoProduto"  — as mesmas três.
-- A quantidade do movimento e da linha continua na unidade de estoque (KG ou L). Sem CHECK: a allowlist EXPAND recusa
-- CHECK em tabela antiga, e a API confere a unidade (conversão ativa do próprio produto), a quantidade e o fator.
-- Nenhum DROP, RENAME, ALTER COLUMN, NOT NULL em coluna existente ou DML.
--
-- Reversão operacional (não executada em produção): DROP das seis colunas.

-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "unidade_lancamento" VARCHAR(8);

-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "quantidade_lancamento" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN     "fator_lancamento" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "AtividadeApontamentoProduto" ADD COLUMN     "unidade_lancamento" VARCHAR(8);

-- AlterTable
ALTER TABLE "AtividadeApontamentoProduto" ADD COLUMN     "quantidade_lancamento" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "AtividadeApontamentoProduto" ADD COLUMN     "fator_lancamento" DECIMAL(14,4);
