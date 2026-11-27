-- MAIKE-ESTOQUE-UNIDADE-CADASTRO — a unidade de estoque do produto passa a ser a sua Unidade de Medida, uma sigla ativa
-- do cadastro de Unidades (KG, L, SC, UN, CX...), e não mais só KG ou L (emenda da Constituição aprovada pelo
-- proprietário). Saldo, custo e lotes ficam nessa unidade; as unidades de conversão valem a partir dela; KG, L e UN
-- podem ser conversão (só KG <-> L continua proibido, e quem confere é a API). Os 6 CHECKs que só aceitavam KG/L, ou
-- recusavam UN, são recriados mais largos, com o mesmo nome. Decisão, especificação e runbook em docs/engineering/
-- (MAIKE-ESTOQUE-UNIDADE-CADASTRO-*.md). O número da decisão fica FORA deste arquivo de propósito.
--
-- CONTRACT condicionado, formato de sempre (sem DROP TABLE e sem resto). Nenhuma coluna, índice, tabela ou dado muda.
-- Nesta ordem:
--   1. guarda (falha fechada): lock_timeout 5s e statement_timeout 120s locais, a trava consultiva do prisma migrate
--      (72707369), o estado esperado (as 6 tabelas existem; os 6 CHECKs existem no formato anterior: com UN ou com KG)
--      e as 6 tabelas travadas em ACCESS EXCLUSIVE até o COMMIT;
--   2. as 12 instruções pinadas em tabela antiga: cada CHECK apagado e recriado mais largo (a unidade é texto não vazio;
--      o resto de cada CHECK não muda; o serviço do financeiro continua só em UN).
--
-- Reversão operacional (não executada em produção): os 6 CHECKs de volta ao texto anterior (só se nenhuma linha usar
-- unidade nova).

-- Guarda: falha fechada se o banco não estiver no estado que a fatia conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."ProdutoUnidadeConversao"') IS NULL OR to_regclass('public."EntradaEstoqueItem"') IS NULL
     OR to_regclass('public."SaidaEstoqueItem"') IS NULL OR to_regclass('public."AjusteEstoqueItem"') IS NULL
     OR to_regclass('public."OperacaoFinanceiraItem"') IS NULL OR to_regclass('public."AtividadeApontamentoProduto"') IS NULL THEN
    RAISE EXCEPTION 'guarda: as 6 tabelas (conversão do produto, entrada, saída, ajuste, item do financeiro e linha de produto da atividade) têm de existir';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname IN (
        'ProdutoUnidadeConversao_sigla_check', 'EntradaEstoqueItem_unidade_check', 'SaidaEstoqueItem_unidade_check',
        'AjusteEstoqueItem_unidade_check') AND pg_get_constraintdef(oid) LIKE '%''UN''%') <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'c' AND conname = 'OperacaoFinanceiraItem_forma_check'
                      AND pg_get_constraintdef(oid) LIKE '%<> ''UN''%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'c' AND conname = 'AtividadeApontamentoProduto_valores_check'
                      AND pg_get_constraintdef(oid) LIKE '%''KG''%') THEN
    RAISE EXCEPTION 'guarda: os 6 CHECKs de unidade não estão no formato anterior (ausentes ou já alargados)';
  END IF;
  -- Trava até o COMMIT: ninguém grava conversão nem lançamento enquanto os CHECKs são trocados.
  LOCK TABLE public."ProdutoUnidadeConversao" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."EntradaEstoqueItem" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."SaidaEstoqueItem" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."AjusteEstoqueItem" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."OperacaoFinanceiraItem" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."AtividadeApontamentoProduto" IN ACCESS EXCLUSIVE MODE;
END $$;

-- Os CHECKs de unidade, mais largos (qualquer sigla não vazia; KG, L e UN também)
ALTER TABLE "ProdutoUnidadeConversao" DROP CONSTRAINT "ProdutoUnidadeConversao_sigla_check";
ALTER TABLE "ProdutoUnidadeConversao" ADD CONSTRAINT "ProdutoUnidadeConversao_sigla_check" CHECK (char_length("sigla") > 0 AND "sigla" = upper(btrim("sigla")));
ALTER TABLE "EntradaEstoqueItem" DROP CONSTRAINT "EntradaEstoqueItem_unidade_check";
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_unidade_check" CHECK (char_length(btrim("unidade")) > 0);
ALTER TABLE "SaidaEstoqueItem" DROP CONSTRAINT "SaidaEstoqueItem_unidade_check";
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_unidade_check" CHECK (char_length(btrim("unidade")) > 0);
ALTER TABLE "AjusteEstoqueItem" DROP CONSTRAINT "AjusteEstoqueItem_unidade_check";
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_unidade_check" CHECK (char_length(btrim("unidade")) > 0);
ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_forma_check";
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_forma_check" CHECK (("tipo_item" = 'MERCADORIA' AND "produto_id" IS NOT NULL AND "local_estoque_id" IS NOT NULL AND "fator_kg" IS NOT NULL AND "fator_kg" > 0 AND "quantidade_estoque" IS NOT NULL AND "quantidade_estoque" > 0) OR ("tipo_item" = 'SERVICO' AND "produto_id" IS NULL AND "local_estoque_id" IS NULL AND "descricao" IS NOT NULL AND "unidade" = 'UN' AND "fator_kg" IS NULL AND "quantidade_estoque" IS NULL AND "movimentacao_estoque_id" IS NULL AND "estoque_lote_nota_id" IS NULL AND "movimentacao_estorno_id" IS NULL));
ALTER TABLE "AtividadeApontamentoProduto" DROP CONSTRAINT "AtividadeApontamentoProduto_valores_check";
ALTER TABLE "AtividadeApontamentoProduto" ADD CONSTRAINT "AtividadeApontamentoProduto_valores_check" CHECK ("quantidade" > 0 AND "custo_unitario" >= 0 AND "custo_total" >= 0 AND ("dose_ha" IS NULL OR "dose_ha" >= 0) AND "ordem" >= 1 AND char_length(btrim("unidade")) > 0);
