-- MAIKE-BASE-CONSUMO — a Formulação ganha a BASE DO CONSUMO: % do peso vivo
-- ("PV", como até aqui) OU gramas por cabeça por dia ("G_CAB_DIA": sal mineral,
-- proteinado em quantidade fixa). Uma base por formulação, sem mistura: na base
-- PV valem só os %PV (padrão e regras por categoria); na base G_CAB_DIA valem só
-- os gramas (padrão = "consumo_objetivo_g_cab_dia"; regras com "g_cab_dia").
-- Decisão, relatório e runbook em docs/engineering/ (MAIKE-BASE-CONSUMO-*.md).
-- O número da decisão fica FORA deste arquivo de propósito: renumerar a decisão
-- nunca muda o checksum aplicado.
--
-- O que muda (nenhum dado é migrado: a guarda exige as 3 tabelas de Formulações
-- VAZIAS — em produção estavam com 0 linhas, e o proprietário autorizou: "sobre
-- a tabela que já tem dados pode excluir, não tem problema, os dados eram só
-- teste"):
--  - "CADFORMULACAO"."base_consumo" VARCHAR(16) NOT NULL DEFAULT 'PV';
--  - "CADFORMULACAO"."percentual_pv_padrao" passa a aceitar NULL (na base
--    G_CAB_DIA não há %PV);
--  - o CHECK "CADFORMULACAO_percentual_pv_padrao_check" sai e entra o
--    "CADFORMULACAO_base_consumo_check": PV exige %PV em (0, 5]; G_CAB_DIA exige
--    %PV nulo e "consumo_objetivo_g_cab_dia" > 0;
--  - "CADFORMULACAOREGRA"."g_cab_dia" DECIMAL(10,2) anulável;
--  - o CHECK "CADFORMULACAOREGRA_forma_check" é recriado: não consome = sem %PV e
--    sem gramas; consome = EXATAMENTE um dos dois (%PV em (0, 5] ou gramas > 0).
--    Que a regra siga a base da formulação dela é conferido pelo serviço (o CHECK
--    não enxerga a outra tabela).
--
-- Por que é CONTRACT: a allowlist EXPAND (D-PROD-107 R7) recusa, em tabela
-- antiga, ALTER COLUMN, coluna NOT NULL DEFAULT, DROP CONSTRAINT e CHECK. Só passa
-- por uma entrada fechada de MIGRATIONS_CONTRACT_APROVADAS: guarda DO com hash
-- pinado como PRIMEIRA instrução e, depois, exatamente as 7 instruções abaixo,
-- nesta ordem e com texto pinado. Não há resto. Release isolada, com autorização
-- pela decisão exata.
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação;
--  - pg_advisory_xact_lock(72707369), a mesma trava do prisma migrate;
--  - as 3 tabelas existem e ficam travadas em ACCESS EXCLUSIVE antes de conferir;
--  - as 3 tabelas estão VAZIAS;
--  - nenhuma das 2 colunas novas e nenhuma das constraints novas existe;
--  - os 2 CHECKs que saem existem e o %PV padrão ainda é NOT NULL.
--
-- Reversão: não há reversão automática. Desfazer seria uma CONTRACT nova, com GO
-- próprio, nunca editando esta.

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  tabelas constant text[] := ARRAY['CADFORMULACAO','CADFORMULACAOINGREDIENTE','CADFORMULACAOREGRA'];
  t text;
  n bigint;
  f oid;
  r oid;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      RAISE EXCEPTION 'formulacao_base_consumo: a tabela public.% não existe: schema fora do esperado; nada foi alterado', t;
    END IF;
  END LOOP;
  LOCK TABLE public."CADFORMULACAO", public."CADFORMULACAOINGREDIENTE", public."CADFORMULACAOREGRA" IN ACCESS EXCLUSIVE MODE;
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n <> 0 THEN
      RAISE EXCEPTION 'formulacao_base_consumo: public.% tem % linha(s): esta CONTRACT só roda com as Formulações vazias; nada foi alterado', t, n;
    END IF;
  END LOOP;
  f := to_regclass('public."CADFORMULACAO"');
  r := to_regclass('public."CADFORMULACAOREGRA"');
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = f AND a.attname = 'base_consumo' AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = r AND a.attname = 'g_cab_dia' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'formulacao_base_consumo: coluna nova já existe: migration já aplicada ou schema fora do esperado; nada foi alterado';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = f AND k.conname = 'CADFORMULACAO_base_consumo_check') THEN
    RAISE EXCEPTION 'formulacao_base_consumo: constraint nova já existe: migration já aplicada ou schema fora do esperado; nada foi alterado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = f AND k.conname = 'CADFORMULACAO_percentual_pv_padrao_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = r AND k.conname = 'CADFORMULACAOREGRA_forma_check') THEN
    RAISE EXCEPTION 'formulacao_base_consumo: os CHECKs da D-PROD-203 não estão lá: schema fora do esperado; nada foi alterado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = f AND a.attname = 'percentual_pv_padrao' AND a.attnotnull AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'formulacao_base_consumo: percentual_pv_padrao já aceita nulo: schema fora do esperado; nada foi alterado';
  END IF;
END $$;

-- 2. A base do consumo na formulação (as que existirem leriam 'PV'; a guarda exige nenhuma).
ALTER TABLE "CADFORMULACAO" ADD COLUMN "base_consumo" VARCHAR(16) NOT NULL DEFAULT 'PV';
ALTER TABLE "CADFORMULACAO" ALTER COLUMN "percentual_pv_padrao" DROP NOT NULL;
ALTER TABLE "CADFORMULACAO" DROP CONSTRAINT "CADFORMULACAO_percentual_pv_padrao_check";
ALTER TABLE "CADFORMULACAO" ADD CONSTRAINT "CADFORMULACAO_base_consumo_check" CHECK (("base_consumo" = 'PV' AND "percentual_pv_padrao" IS NOT NULL AND "percentual_pv_padrao" > 0 AND "percentual_pv_padrao" <= 5) OR ("base_consumo" = 'G_CAB_DIA' AND "percentual_pv_padrao" IS NULL AND "consumo_objetivo_g_cab_dia" IS NOT NULL AND "consumo_objetivo_g_cab_dia" > 0));

-- 3. A regra por categoria em gramas, e a forma da regra: consome com UM valor (%PV ou gramas).
ALTER TABLE "CADFORMULACAOREGRA" ADD COLUMN "g_cab_dia" DECIMAL(10,2);
ALTER TABLE "CADFORMULACAOREGRA" DROP CONSTRAINT "CADFORMULACAOREGRA_forma_check";
ALTER TABLE "CADFORMULACAOREGRA" ADD CONSTRAINT "CADFORMULACAOREGRA_forma_check" CHECK (("consome" = false AND "percentual_pv" IS NULL AND "g_cab_dia" IS NULL) OR ("consome" = true AND "percentual_pv" IS NOT NULL AND "percentual_pv" > 0 AND "percentual_pv" <= 5 AND "g_cab_dia" IS NULL) OR ("consome" = true AND "percentual_pv" IS NULL AND "g_cab_dia" IS NOT NULL AND "g_cab_dia" > 0));
