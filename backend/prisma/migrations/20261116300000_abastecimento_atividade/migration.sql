-- MAIKE-ATIVIDADE-ABASTECIMENTO (Fatia 5 do Lançamento de Atividades) — o abastecimento
-- do bem ("AbastecimentoBem") passa a poder pertencer a um lançamento do dia (o
-- apontamento, e por ele a atividade), guarda o snapshot do centro de custo, da leitura
-- anterior do medidor, do delta e de se o intervalo é confiável, e ganha a origem
-- EXTERNO (posto de estrada, sem estoque: sem local e sem movimento). Decisão, contrato,
-- runbook e relatório em docs/engineering/ (MAIKE-ATIVIDADE-ABASTECIMENTO-*.md). O
-- número da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca
-- muda o checksum aplicado.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS), nesta
-- ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma
--      migrate (72707369), o estado esperado (as 5 tabelas existem, nenhuma coluna
--      nova existe, local_estoque_id e movimentacao_estoque_id ainda NOT NULL, o CHECK
--      de status ainda o antigo, sem origem, e o CHECK de origem ausente) e
--      "AbastecimentoBem" travada em ACCESS EXCLUSIVE até o COMMIT. Nenhuma linha
--      existente viola as regras novas (origem ESTOQUE pelo DEFAULT, com local e
--      movimento, que eram NOT NULL): a guarda não precisa conferir conteúdo;
--   2. as instruções pinadas em tabela antiga: as 7 colunas novas (origem NOT NULL
--      DEFAULT 'ESTOQUE' e intervalo_confiavel NOT NULL DEFAULT false; as outras
--      anuláveis, sem DEFAULT), local_estoque_id e movimentacao_estoque_id passam a
--      anuláveis, o centro de custo das linhas existentes vem do bem (o snapshot que
--      faltava; leitura anterior, delta e intervalo ficam desconhecidos, sem inventar),
--      o CHECK de status volta com o estorno exigido só na origem ESTOQUE, os 3 CHECKs
--      novos e as 3 FKs compostas pelo tenant e pela empresa, RESTRICT;
--   3. o resto pela allowlist EXPAND: os 3 índices não-únicos das FKs novas, pelo
--      cliente.
--
-- Nenhuma tabela é criada ou apagada; nenhuma linha some.

-- Guarda: falha fechada se o banco não estiver no estado que a fatia conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."AbastecimentoBem"') IS NULL
     OR to_regclass('public."Atividade"') IS NULL
     OR to_regclass('public."AtividadeApontamento"') IS NULL
     OR to_regclass('public."CentroCusto"') IS NULL
     OR to_regclass('public."BemPatrimonial"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "AbastecimentoBem", "Atividade", "AtividadeApontamento", "CentroCusto" e "BemPatrimonial" têm de existir';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND table_name = 'AbastecimentoBem'
               AND column_name IN ('origem', 'atividade_id', 'apontamento_id', 'centro_custo_id', 'medidor_leitura_anterior', 'medidor_delta', 'intervalo_confiavel'))
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public."AbastecimentoBem"')
           AND attname IN ('local_estoque_id', 'movimentacao_estoque_id') AND attnotnull AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'guarda: o abastecimento não está no formato anterior (coluna nova já presente, ou local/movimento já anuláveis)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."AbastecimentoBem"')
                   AND conname = 'AbastecimentoBem_status_check' AND contype = 'c'
                   AND pg_get_constraintdef(oid) NOT LIKE '%origem%')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."AbastecimentoBem"')
                  AND conname IN ('AbastecimentoBem_origem_check', 'AbastecimentoBem_atividade_check', 'AbastecimentoBem_intervalo_check')) THEN
    RAISE EXCEPTION 'guarda: os CHECKs do abastecimento não estão no formato anterior (status ausente ou já com origem, ou CHECK novo já presente)';
  END IF;
  -- Trava até o COMMIT: ninguém grava em "AbastecimentoBem" enquanto as colunas, o centro de custo e os CHECKs mudam.
  LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;
END $$;

-- AlterTable (origem e intervalo_confiavel NOT NULL com DEFAULT: as linhas existentes ficam ESTOQUE e false)
ALTER TABLE "AbastecimentoBem" ADD COLUMN "origem" VARCHAR(8) NOT NULL DEFAULT 'ESTOQUE';
ALTER TABLE "AbastecimentoBem" ADD COLUMN "atividade_id" VARCHAR(64);
ALTER TABLE "AbastecimentoBem" ADD COLUMN "apontamento_id" VARCHAR(64);
ALTER TABLE "AbastecimentoBem" ADD COLUMN "centro_custo_id" VARCHAR(64);
ALTER TABLE "AbastecimentoBem" ADD COLUMN "medidor_leitura_anterior" DECIMAL(14,4);
ALTER TABLE "AbastecimentoBem" ADD COLUMN "medidor_delta" DECIMAL(14,4);
ALTER TABLE "AbastecimentoBem" ADD COLUMN "intervalo_confiavel" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable (o posto externo não tem local nem movimento de estoque)
ALTER TABLE "AbastecimentoBem" ALTER COLUMN "local_estoque_id" DROP NOT NULL;
ALTER TABLE "AbastecimentoBem" ALTER COLUMN "movimentacao_estoque_id" DROP NOT NULL;

-- Backfill: o snapshot do centro de custo das linhas existentes é o do bem (mesma empresa por construção).
UPDATE "AbastecimentoBem" AS a SET "centro_custo_id" = b."centro_custo_id" FROM "BemPatrimonial" AS b WHERE b."cliente_id" = a."cliente_id" AND b."empresa_id" = a."empresa_id" AND b."id" = a."bem_id" AND b."centro_custo_id" IS NOT NULL;

-- CHECK de status: o cancelado exige o estorno só quando a origem é ESTOQUE (o externo não tem movimento).
ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_status_check";
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_status_check" CHECK (("status" = 'CONFIRMADO' AND "movimentacao_estorno_id" IS NULL AND "cancelado_em" IS NULL AND "cancelado_por_usuario_id" IS NULL AND "motivo_cancelamento" IS NULL) OR ("status" = 'CANCELADO' AND ("origem" = 'EXTERNO' OR "movimentacao_estorno_id" IS NOT NULL) AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND char_length(btrim("motivo_cancelamento")) >= 3));

-- Listas fechadas e invariantes novas.
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_origem_check" CHECK (("origem" = 'ESTOQUE' AND "local_estoque_id" IS NOT NULL AND "movimentacao_estoque_id" IS NOT NULL) OR ("origem" = 'EXTERNO' AND "local_estoque_id" IS NULL AND "movimentacao_estoque_id" IS NULL AND "movimentacao_estorno_id" IS NULL));
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_atividade_check" CHECK ("apontamento_id" IS NULL OR "atividade_id" IS NOT NULL);
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_intervalo_check" CHECK ((("medidor_leitura_anterior" IS NULL AND "medidor_delta" IS NULL) OR ("medidor_leitura_anterior" IS NOT NULL AND "medidor_delta" IS NOT NULL AND "medidor_tipo" IN ('HORIMETRO', 'ODOMETRO', 'CICLOS') AND "medidor_leitura_anterior" >= 0 AND "medidor_delta" = "medidor_leitura" - "medidor_leitura_anterior")) AND ("intervalo_confiavel" = false OR ("medidor_leitura_anterior" IS NOT NULL AND "medidor_delta" IS NOT NULL AND "medidor_delta" > 0)));

-- AddForeignKey (compostas pelo tenant e pela empresa: mesma empresa por construção)
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_atividade_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AbastecimentoBem_atividade_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "atividade_id");
CREATE INDEX "AbastecimentoBem_apontamento_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "apontamento_id");
CREATE INDEX "AbastecimentoBem_centro_custo_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "centro_custo_id");
