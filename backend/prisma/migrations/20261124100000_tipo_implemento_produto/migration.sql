-- MAIKE-TIPO-IMPLEMENTO-PRODUTO — "a máquina sozinha não leva produto; quem leva é o implemento": o tipo de
-- implemento diz se usa produto, como o produto é contado (por jato do tanque) e a capacidade do jato. Decisão,
-- relatório e runbook em docs/engineering/ (MAIKE-TIPO-IMPLEMENTO-PRODUTO-*.md). O número da decisão fica FORA
-- deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: quatro colunas ANULÁVEIS, sem DEFAULT, na tabela antiga "TipoPatrimonial" (nenhuma linha muda
-- de valor; todas ficam nulas): "usa_produto", "forma_produto" (hoje só JATO; texto para SACO/CARGA no futuro),
-- "capacidade" e "capacidade_unidade" (L ou KG). Sem CHECK: a allowlist EXPAND recusa CHECK em tabela antiga, e
-- a API confere a natureza (só IMPLEMENTO), a forma, a faixa e a unidade.
-- Nenhum DROP, RENAME, ALTER COLUMN, NOT NULL em coluna existente ou DML.
--
-- Reversão operacional (não executada em produção): DROP das quatro colunas.

-- AlterTable
ALTER TABLE "TipoPatrimonial" ADD COLUMN     "usa_produto" BOOLEAN;

-- AlterTable
ALTER TABLE "TipoPatrimonial" ADD COLUMN     "forma_produto" VARCHAR(16);

-- AlterTable
ALTER TABLE "TipoPatrimonial" ADD COLUMN     "capacidade" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "TipoPatrimonial" ADD COLUMN     "capacidade_unidade" VARCHAR(8);
