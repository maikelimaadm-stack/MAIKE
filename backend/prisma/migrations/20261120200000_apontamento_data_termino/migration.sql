-- MAIKE-NOVA-REALIZACAO — data de término do registro de campo ("Nova realização de <Tipo>": Data
-- de início e Data de término). Coluna nova e anulável "AtividadeApontamento"."data_termino": o
-- último dia do serviço registrado; vazia = o serviço foi de um dia só (o de "data_operacional").
-- Decisão e relatório em docs/engineering/ (MAIKE-NOVA-REALIZACAO-REPORT.md). O número da decisão
-- fica FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS). A mudança é ADITIVA:
-- nenhuma linha muda de valor, nenhuma coluna existente é tocada, nenhuma tabela é criada ou
-- apagada, nenhum DROP. Só é CONTRACT porque a allowlist EXPAND recusa coluna DATE e CHECK em
-- tabela antiga (o mesmo caminho da D-PROD-197 e da D-PROD-216). Nesta ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma migrate
--      (72707369), o estado esperado (a tabela existe; a coluna e o CHECK novos não) e
--      "AtividadeApontamento" travada em ACCESS EXCLUSIVE até o COMMIT. A coluna nasce vazia em
--      todas as linhas, então nenhuma linha existente pode violar o CHECK: a guarda não precisa
--      conferir conteúdo;
--   2. as instruções pinadas em tabela antiga: a coluna anulável, sem DEFAULT, e o CHECK
--      (término vazio ou no mesmo dia do início ou depois).
-- Sem resto: nenhum índice, nenhuma FK, nenhum DML.
--
-- Reversão operacional (não executada em produção): DROP do CHECK e da coluna.

-- Guarda: falha fechada se o banco não estiver no estado que a fatia conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."AtividadeApontamento"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "AtividadeApontamento" tem de existir';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND table_name = 'AtividadeApontamento' AND column_name = 'data_termino')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."AtividadeApontamento"')
                  AND conname = 'AtividadeApontamento_data_termino_check') THEN
    RAISE EXCEPTION 'guarda: a data de término já está no apontamento (coluna ou CHECK novos já presentes)';
  END IF;
  -- Trava até o COMMIT: ninguém grava lançamento enquanto a coluna e o CHECK entram.
  LOCK TABLE public."AtividadeApontamento" IN ACCESS EXCLUSIVE MODE;
END $$;

-- AlterTable (anulável, sem DEFAULT: todas as linhas existentes ficam sem término)
ALTER TABLE "AtividadeApontamento" ADD COLUMN "data_termino" DATE;

-- AddCheck (o término nunca antes do início; vazio vale)
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_data_termino_check" CHECK ("data_termino" IS NULL OR "data_termino" >= "data_operacional");
