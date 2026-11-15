-- MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO (ajuste da Fatia 4 do Lançamento de Atividades) —
-- o funcionário deixa de ser cadastro próprio e vira PAPEL do parceiro ("Fornecedor",
-- tela Parceiros), com os seus dados (tipo, cargo, custo por hora e por diária) nas
-- colunas anuláveis novas; a linha de mão de obra passa a apontar para o parceiro
-- (funcionário ou terceiro). A tabela "Funcionario" sai. Decisão, contrato, runbook e
-- relatório em docs/engineering/ (MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-*.md). O número
-- da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca muda o
-- checksum aplicado.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS, com o DROP
-- no FIM do arquivo), nesta ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma
--      migrate (72707369), o estado esperado (as 3 tabelas existem, a coluna antiga
--      existe, nenhuma coluna nova existe) e "Funcionario" e
--      "AtividadeApontamentoMaoObra" travadas em ACCESS EXCLUSIVE ANTES de conferir
--      que as duas estão VAZIAS (nunca houve dado: a Fatia 4 entrou em produção
--      minutos antes). Qualquer linha aborta a transação inteira: nada é apagado;
--   2. as instruções pinadas em tabela antiga: sai o vínculo com o funcionário (FK,
--      índice e coluna) da linha de mão de obra; entram "parceiro_id" e "origem"
--      NOT NULL (a tabela está vazia), as 4 colunas anuláveis do papel funcionário
--      em "Fornecedor", os 2 CHECKs e a FK nova para o parceiro;
--   3. o resto pela allowlist EXPAND: o índice não-único da FK nova, pelo cliente;
--   4. por ÚLTIMO, o DROP TABLE pinado de "Funcionario" (vazia; as FKs dela saem
--      com ela, e a única que a referenciava saiu no passo 2).
--
-- Escopo garantido pelo banco: a FK nova é composta pelo tenant, RESTRICT.

-- Guarda: falha fechada se o banco não estiver no estado que o ajuste conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."Funcionario"') IS NULL
     OR to_regclass('public."AtividadeApontamentoMaoObra"') IS NULL
     OR to_regclass('public."Fornecedor"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "Funcionario", "AtividadeApontamentoMaoObra" e "Fornecedor" têm de existir';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'AtividadeApontamentoMaoObra' AND column_name = 'funcionario_id')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name IN ('AtividadeApontamentoMaoObra', 'Fornecedor')
                   AND column_name IN ('parceiro_id', 'origem', 'funcionario_tipo', 'funcionario_cargo', 'funcionario_custo_hora', 'funcionario_custo_diaria')) THEN
    RAISE EXCEPTION 'guarda: a mão de obra não está no formato da Fatia 4 (funcionario_id ausente ou coluna nova já presente)';
  END IF;
  -- Trava ANTES de conferir: até o COMMIT ninguém grava nas duas (o que a guarda conferiu vazio é o que o DROP apaga).
  LOCK TABLE public."Funcionario", public."AtividadeApontamentoMaoObra" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."Funcionario") THEN
    RAISE EXCEPTION 'guarda: "Funcionario" tem linhas; este ajuste só roda com a tabela vazia';
  END IF;
  IF EXISTS (SELECT 1 FROM public."AtividadeApontamentoMaoObra") THEN
    RAISE EXCEPTION 'guarda: "AtividadeApontamentoMaoObra" tem linhas; este ajuste só roda com a tabela vazia';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" DROP CONSTRAINT "AtividadeApontamentoMaoObra_funcionario_fkey";

-- DropIndex
DROP INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx";

-- AlterTable (a tabela está vazia: as 2 colunas NOT NULL entram sem DEFAULT)
ALTER TABLE "AtividadeApontamentoMaoObra" DROP COLUMN "funcionario_id";
ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "parceiro_id" VARCHAR(64) NOT NULL;
ALTER TABLE "AtividadeApontamentoMaoObra" ADD COLUMN "origem" VARCHAR(12) NOT NULL;

-- AlterTable (anuláveis, sem DEFAULT: só o parceiro com o papel funcionario as usa)
ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_tipo" VARCHAR(16);
ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_cargo" VARCHAR(120);
ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_custo_hora" DECIMAL(14,4);
ALTER TABLE "Fornecedor" ADD COLUMN "funcionario_custo_diaria" DECIMAL(14,4);

-- Listas fechadas e invariantes.
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_funcionario_check" CHECK (("funcionario_tipo" IS NULL OR "funcionario_tipo" IN ('MENSALISTA', 'DIARISTA', 'TAREFEIRO')) AND ("funcionario_custo_hora" IS NULL OR "funcionario_custo_hora" >= 0) AND ("funcionario_custo_diaria" IS NULL OR "funcionario_custo_diaria" >= 0));
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_origem_check" CHECK ("origem" IN ('FUNCIONARIO', 'TERCEIRO'));

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_parceiro_fkey" FOREIGN KEY ("cliente_id", "parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AtividadeApontamentoMaoObra_cliente_id_parceiro_id_idx" ON "AtividadeApontamentoMaoObra"("cliente_id", "parceiro_id");

-- DropTable (vazia, conferida pela guarda)
DROP TABLE "Funcionario";
