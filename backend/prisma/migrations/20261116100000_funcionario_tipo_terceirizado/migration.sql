-- MAIKE-FUNCIONARIO-TIPO — a escolha do tipo do funcionário (papel do parceiro,
-- "Fornecedor") passa a ser Mensalista, Diarista ou Terceirizado: o valor
-- TERCEIRIZADO entra no lugar de TAREFEIRO no CHECK "Fornecedor_funcionario_check".
-- Decisão, runbook e relatório em docs/engineering/ (MAIKE-FUNCIONARIO-TIPO-*.md).
-- O número da decisão fica FORA deste arquivo de propósito: renumerar a decisão
-- nunca muda o checksum aplicado.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS), nesta
-- ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma
--      migrate (72707369), o estado esperado ("Fornecedor" existe e o CHECK ainda é
--      o do ajuste anterior, com TAREFEIRO) e "Fornecedor" travada em ACCESS
--      EXCLUSIVE ANTES de conferir que NENHUM parceiro tem funcionario_tipo =
--      TAREFEIRO (em produção, nenhum parceiro tem o tipo preenchido). Qualquer
--      linha com TAREFEIRO aborta a transação inteira: nada muda;
--   2. as 2 instruções pinadas em tabela antiga: sai o CHECK e volta igual, com
--      TERCEIRIZADO no lugar de TAREFEIRO (o resto do CHECK não muda).
--
-- Nenhuma coluna, índice, tabela ou dado muda.

-- Guarda: falha fechada se o banco não estiver no estado que o ajuste conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."Fornecedor"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "Fornecedor" tem de existir';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."Fornecedor"')
                   AND conname = 'Fornecedor_funcionario_check' AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%''TAREFEIRO''%') THEN
    RAISE EXCEPTION 'guarda: o CHECK "Fornecedor_funcionario_check" não está no formato do ajuste anterior (ausente ou já sem TAREFEIRO)';
  END IF;
  -- Trava ANTES de conferir: até o COMMIT ninguém grava em "Fornecedor" (o que a guarda conferiu é o que o CHECK novo valida).
  LOCK TABLE public."Fornecedor" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."Fornecedor" WHERE "funcionario_tipo" = 'TAREFEIRO') THEN
    RAISE EXCEPTION 'guarda: há parceiro com funcionario_tipo = TAREFEIRO; este ajuste só roda sem nenhum';
  END IF;
END $$;

-- AlterTable (o CHECK volta igual, com TERCEIRIZADO no lugar de TAREFEIRO)
ALTER TABLE "Fornecedor" DROP CONSTRAINT "Fornecedor_funcionario_check";
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_funcionario_check" CHECK (("funcionario_tipo" IS NULL OR "funcionario_tipo" IN ('MENSALISTA', 'DIARISTA', 'TERCEIRIZADO')) AND ("funcionario_custo_hora" IS NULL OR "funcionario_custo_hora" >= 0) AND ("funcionario_custo_diaria" IS NULL OR "funcionario_custo_diaria" >= 0));
