-- MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO (ajuste da Fatia 4 do Lançamento de Atividades) —
-- o funcionário deixa de ser cadastro próprio e vira PAPEL do parceiro ("Fornecedor",
-- tela Parceiros), com os seus dados (tipo, cargo, custo por hora e por diária) nas
-- colunas anuláveis novas; a linha de mão de obra passa a apontar para o parceiro
-- (funcionário ou terceiro). A tabela "Funcionario" sai. Decisão, contrato, runbook e
-- relatório em docs/engineering/ (MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-*.md). O número
-- da decisão fica FORA deste arquivo de propósito.
--
-- CONTRACT condicionado: só roda com "Funcionario" e "AtividadeApontamentoMaoObra"
-- VAZIAS (nunca houve dado: a Fatia 4 entrou em produção minutos antes). A guarda
-- abaixo aborta a transação inteira se houver qualquer linha.

DO $guarda$
BEGIN
  IF EXISTS (SELECT 1 FROM "Funcionario") THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: "Funcionario" tem linhas; esta migration só roda com a tabela vazia';
  END IF;
  IF EXISTS (SELECT 1 FROM "AtividadeApontamentoMaoObra") THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: "AtividadeApontamentoMaoObra" tem linhas; esta migration só roda com a tabela vazia';
  END IF;
END $guarda$;

-- DropForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" DROP CONSTRAINT "AtividadeApontamentoMaoObra_funcionario_fkey";

-- DropForeignKey
ALTER TABLE "Funcionario" DROP CONSTRAINT "Funcionario_cliente_id_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "Funcionario" DROP CONSTRAINT "Funcionario_cliente_id_fkey";

-- DropIndex
DROP INDEX "AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx";

-- AlterTable
ALTER TABLE "AtividadeApontamentoMaoObra" DROP COLUMN "funcionario_id",
ADD COLUMN     "origem" VARCHAR(12) NOT NULL,
ADD COLUMN     "parceiro_id" VARCHAR(64) NOT NULL;

-- AlterTable
ALTER TABLE "Fornecedor" ADD COLUMN     "funcionario_cargo" VARCHAR(120),
ADD COLUMN     "funcionario_custo_diaria" DECIMAL(14,4),
ADD COLUMN     "funcionario_custo_hora" DECIMAL(14,4),
ADD COLUMN     "funcionario_tipo" VARCHAR(16);

-- DropTable
DROP TABLE "Funcionario";

-- CreateIndex
CREATE INDEX "AtividadeApontamentoMaoObra_cliente_id_parceiro_id_idx" ON "AtividadeApontamentoMaoObra"("cliente_id", "parceiro_id");

-- AddForeignKey
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_parceiro_fkey" FOREIGN KEY ("cliente_id", "parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Listas fechadas e invariantes.
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_funcionario_check" CHECK (("funcionario_tipo" IS NULL OR "funcionario_tipo" IN ('MENSALISTA', 'DIARISTA', 'TAREFEIRO')) AND ("funcionario_custo_hora" IS NULL OR "funcionario_custo_hora" >= 0) AND ("funcionario_custo_diaria" IS NULL OR "funcionario_custo_diaria" >= 0));
ALTER TABLE "AtividadeApontamentoMaoObra" ADD CONSTRAINT "AtividadeApontamentoMaoObra_origem_check" CHECK ("origem" IN ('FUNCIONARIO', 'TERCEIRO'));
