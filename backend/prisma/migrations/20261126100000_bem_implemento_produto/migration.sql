-- MAIKE-BEM-IMPLEMENTO-PRODUTO — "isso tinha que ficar dentro do cadastro mesmo": o produto do implemento (usa produto?
-- por jato, a capacidade do tanque e a unidade) passa a ser marcado no cadastro do PRÓPRIO bem (o pulverizador), não
-- mais no tipo. Decisão, relatório e runbook em docs/engineering/ (MAIKE-BEM-IMPLEMENTO-PRODUTO-*.md). O número da
-- decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: quatro colunas ANULÁVEIS, sem DEFAULT, na tabela antiga "BemPatrimonial" (nenhuma linha muda de valor;
-- todas ficam nulas): "usa_produto", "forma_produto" (hoje só JATO), "capacidade" e "capacidade_unidade" (L ou KG).
-- Sem CHECK: a allowlist EXPAND recusa CHECK em tabela antiga, e a API confere a natureza (só IMPLEMENTO), a forma, a
-- faixa e a unidade. As colunas do tipo (D-PROD-279) ficam como estão. Nenhum DROP, RENAME, ALTER COLUMN, NOT NULL em
-- coluna existente ou DML.
--
-- Reversão operacional (não executada em produção): DROP das quatro colunas.

-- AlterTable
ALTER TABLE "BemPatrimonial" ADD COLUMN     "usa_produto" BOOLEAN;

-- AlterTable
ALTER TABLE "BemPatrimonial" ADD COLUMN     "forma_produto" VARCHAR(16);

-- AlterTable
ALTER TABLE "BemPatrimonial" ADD COLUMN     "capacidade" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "BemPatrimonial" ADD COLUMN     "capacidade_unidade" VARCHAR(8);
