-- MAIKE-ESTOQUE-CONTROLE-LOTE — controle de lote (e de validade) por produto. O Produto ganha dois
-- Sim/Não, "controla_lote" e "controla_validade" (padrão Não: os produtos de hoje ficam como estão);
-- a camada de custo por entrada ("EstoqueLoteNota") ganha o lote do fabricante e a data de validade,
-- e um índice tenant-first para escolher o lote que vence primeiro (FEFO). Decisão, especificação e
-- relatório em docs/engineering/ (MAIKE-ESTOQUE-CONTROLE-LOTE-SPEC.md). O número da decisão fica FORA
-- deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS). A mudança é ADITIVA:
-- nenhuma linha muda de valor, nenhuma coluna existente é tocada, nenhuma tabela é criada ou
-- apagada, nenhum DROP, nenhum DML. Só é CONTRACT porque a allowlist EXPAND recusa, em tabela
-- antiga, coluna NOT NULL DEFAULT, coluna DATE e CHECK (o mesmo caminho da D-PROD-197, da
-- D-PROD-259 e da D-PROD-265). Nesta ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma migrate
--      (72707369), o estado esperado (as duas tabelas existem; as colunas, o CHECK e o índice
--      novos não) e "Produto" e "EstoqueLoteNota" travadas em ACCESS EXCLUSIVE até o COMMIT. As
--      colunas novas nascem false/vazias em todas as linhas, então nenhuma linha existente pode
--      violar o CHECK: a guarda não precisa conferir conteúdo;
--   2. as instruções pinadas em tabela antiga: os dois Sim/Não NOT NULL DEFAULT false (metadado
--      no Postgres 11+, sem reescrever a tabela), o CHECK "validade só com lote", e as duas
--      colunas anuláveis da camada;
--   3. o resto, pela allowlist EXPAND: o índice não-único tenant-first do FEFO.
--
-- Reversão operacional (não executada em produção): DROP do índice, do CHECK e das 4 colunas.

-- Guarda: falha fechada se o banco não estiver no estado que a fatia conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."Produto"') IS NULL OR to_regclass('public."EstoqueLoteNota"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "Produto" e "EstoqueLoteNota" têm de existir';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND ((table_name = 'Produto' AND column_name IN ('controla_lote', 'controla_validade'))
                 OR (table_name = 'EstoqueLoteNota' AND column_name IN ('lote_fabricante', 'data_validade'))))
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."Produto"')
                  AND conname = 'Produto_controla_validade_check')
     OR to_regclass('public."EstoqueLoteNota_fefo_idx"') IS NOT NULL THEN
    RAISE EXCEPTION 'guarda: o controle de lote já está no banco (coluna, CHECK ou índice novos já presentes)';
  END IF;
  -- Trava até o COMMIT: ninguém grava produto nem movimento de estoque enquanto as colunas entram.
  LOCK TABLE public."Produto" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."EstoqueLoteNota" IN ACCESS EXCLUSIVE MODE;
END $$;

-- AlterTable (NOT NULL DEFAULT false: todos os produtos existentes ficam "Não")
ALTER TABLE "Produto" ADD COLUMN "controla_lote" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Produto" ADD COLUMN "controla_validade" BOOLEAN NOT NULL DEFAULT false;

-- AddCheck (validade só com lote)
ALTER TABLE "Produto" ADD CONSTRAINT "Produto_controla_validade_check" CHECK ("controla_validade" = false OR "controla_lote" = true);

-- AlterTable (anuláveis, sem DEFAULT: as camadas existentes ficam sem lote e sem validade)
ALTER TABLE "EstoqueLoteNota" ADD COLUMN "lote_fabricante" VARCHAR(64);
ALTER TABLE "EstoqueLoteNota" ADD COLUMN "data_validade" DATE;

-- CreateIndex (FEFO, tenant-first: cliente → empresa → produto → depósito → validade)
CREATE INDEX "EstoqueLoteNota_fefo_idx" ON "EstoqueLoteNota"("cliente_id", "empresa_id", "produto_id", "local_estoque_id", "data_validade");
