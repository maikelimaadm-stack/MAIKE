-- MAIKE-TIPO-ATIVIDADE-DEFAULTS (Fatia 1 do Lançamento de Atividades) — o Tipo
-- de Atividade ganha os PADRÕES e as FLAGS. Decisão, contrato, runbook e
-- relatório em docs/engineering/ (MAIKE-TIPO-ATIVIDADE-DEFAULTS-*.md). O número
-- da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca
-- muda o checksum aplicado.
--
-- O que entra em "TipoAtividade" (tudo ADITIVO; nenhuma linha existente muda
-- de valor, nenhuma coluna existente é tocada, nenhuma tabela é criada ou
-- apagada):
--  - 5 colunas anuláveis: categoria, centro_custo_padrao_id,
--    centro_resultado_padrao_id, unidade_producao_id e coeficiente_padrao;
--  - 8 flags BOOLEAN NOT NULL DEFAULT false: exige_area, exige_safra,
--    exige_maquina, permite_implemento, permite_produto, permite_servico,
--    permite_mao_obra e exige_producao (DEFAULT constante: o PostgreSQL 11+ não
--    reescreve a tabela; as linhas que já existem leem false);
--  - 3 FKs compostas pelo tenant, ON DELETE RESTRICT: ("cliente_id", padrão) →
--    CentroCusto, CentroResultado e UnidadeMedida ("cliente_id", "id");
--  - 2 CHECKs: categoria na lista fechada de 9 valores; coeficiente > 0;
--  - 3 índices não-únicos começando por "cliente_id", um por FK.
--
-- Por que é CONTRACT, sendo aditiva: a allowlist EXPAND (D-PROD-107 R7) só
-- aceita, em tabela ANTIGA, ADD COLUMN anulável sem DEFAULT e FK para tabela
-- NOVA. Flag NOT NULL DEFAULT false, FK para tabela antiga e CHECK em tabela
-- antiga só passam por uma entrada fechada de MIGRATIONS_CONTRACT_APROVADAS,
-- como os alargamentos de CHECK da D-PROD-162: guarda DO com hash pinado como
-- PRIMEIRA instrução e, depois, exatamente as 18 instruções abaixo, nesta
-- ordem e com texto pinado. O resto (os 3 CREATE INDEX) passa pela allowlist
-- EXPAND. Release isolada, com autorização pela decisão exata.
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação;
--  - pg_advisory_xact_lock(72707369), a mesma trava do prisma migrate;
--  - TipoAtividade existe e está travada em ACCESS EXCLUSIVE antes de conferir;
--  - nenhuma das 13 colunas novas existe (se existir alguma, a migration já
--    rodou ou o schema está fora do esperado);
--  - nenhuma das 5 constraints e nenhum dos 3 índices novos existe;
--  - CentroCusto, CentroResultado e UnidadeMedida existem, cada uma com o
--    índice ÚNICO exatamente em ("cliente_id", "id") que as FKs referenciam.
--
-- Reversão: não há reversão automática. Desfazer seria uma CONTRACT nova
-- (DROP CONSTRAINT/DROP COLUMN com GO próprio), nunca editando esta.

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  colunas constant text[] := ARRAY['categoria','centro_custo_padrao_id','centro_resultado_padrao_id','unidade_producao_id','coeficiente_padrao','exige_area','exige_safra','exige_maquina','permite_implemento','permite_produto','permite_servico','permite_mao_obra','exige_producao'];
  constraints_novas constant text[] := ARRAY['TipoAtividade_cliente_id_centro_custo_padrao_id_fkey','TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey','TipoAtividade_cliente_id_unidade_producao_id_fkey','TipoAtividade_categoria_check','TipoAtividade_coeficiente_padrao_check'];
  indices_novos constant text[] := ARRAY['TipoAtividade_cliente_id_centro_custo_padrao_id_idx','TipoAtividade_cliente_id_centro_resultado_padrao_id_idx','TipoAtividade_cliente_id_unidade_producao_id_idx'];
  alvos constant text[] := ARRAY['CentroCusto','CentroResultado','UnidadeMedida'];
  tabela oid;
  alvo text;
  alvo_oid oid;
  achadas text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  tabela := to_regclass('public."TipoAtividade"');
  IF tabela IS NULL THEN
    RAISE EXCEPTION 'tipo_atividade_defaults: a tabela public.TipoAtividade não existe: schema fora do esperado; nada foi alterado';
  END IF;
  LOCK TABLE public."TipoAtividade" IN ACCESS EXCLUSIVE MODE;
  SELECT string_agg(a.attname, ', ' ORDER BY a.attname) INTO achadas
    FROM pg_attribute a
   WHERE a.attrelid = tabela AND a.attname = ANY (colunas) AND NOT a.attisdropped AND a.attnum > 0;
  IF achadas IS NOT NULL THEN
    RAISE EXCEPTION 'tipo_atividade_defaults: TipoAtividade já tem coluna nova (%): migration já aplicada ou schema fora do esperado; nada foi alterado', achadas;
  END IF;
  SELECT string_agg(k.conname, ', ' ORDER BY k.conname) INTO achadas
    FROM pg_constraint k
   WHERE k.conrelid = tabela AND k.conname = ANY (constraints_novas);
  IF achadas IS NOT NULL THEN
    RAISE EXCEPTION 'tipo_atividade_defaults: TipoAtividade já tem constraint nova (%): migration já aplicada ou schema fora do esperado; nada foi alterado', achadas;
  END IF;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO achadas
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = ANY (indices_novos);
  IF achadas IS NOT NULL THEN
    RAISE EXCEPTION 'tipo_atividade_defaults: índice novo já existe (%): migration já aplicada ou schema fora do esperado; nada foi alterado', achadas;
  END IF;
  FOREACH alvo IN ARRAY alvos LOOP
    alvo_oid := to_regclass(format('public.%I', alvo));
    IF alvo_oid IS NULL THEN
      RAISE EXCEPTION 'tipo_atividade_defaults: a tabela public.% não existe: a FK não teria alvo; nada foi alterado', alvo;
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM pg_index i
       WHERE i.indrelid = alvo_oid AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
         AND i.indnkeyatts = 2
         AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
                FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = alvo_oid AND a.attnum = k.attnum
               WHERE k.ord <= 2) = ARRAY['cliente_id','id']
    ) THEN
      RAISE EXCEPTION 'tipo_atividade_defaults: public.% sem índice único em (cliente_id, id): a FK composta não teria alvo; nada foi alterado', alvo;
    END IF;
  END LOOP;
END $$;

-- 2. As 13 colunas (5 anuláveis, 8 flags NOT NULL DEFAULT false), nesta ordem.
ALTER TABLE "TipoAtividade" ADD COLUMN "categoria" VARCHAR(24);
ALTER TABLE "TipoAtividade" ADD COLUMN "centro_custo_padrao_id" VARCHAR(64);
ALTER TABLE "TipoAtividade" ADD COLUMN "centro_resultado_padrao_id" VARCHAR(64);
ALTER TABLE "TipoAtividade" ADD COLUMN "unidade_producao_id" VARCHAR(64);
ALTER TABLE "TipoAtividade" ADD COLUMN "coeficiente_padrao" DECIMAL(14,4);
ALTER TABLE "TipoAtividade" ADD COLUMN "exige_area" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipoAtividade" ADD COLUMN "exige_safra" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipoAtividade" ADD COLUMN "exige_maquina" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipoAtividade" ADD COLUMN "permite_implemento" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipoAtividade" ADD COLUMN "permite_produto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipoAtividade" ADD COLUMN "permite_servico" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipoAtividade" ADD COLUMN "permite_mao_obra" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TipoAtividade" ADD COLUMN "exige_producao" BOOLEAN NOT NULL DEFAULT false;

-- 3. As 3 FKs compostas pelo tenant (RESTRICT: o cadastro usado como padrão não é apagado).
ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_centro_custo_padrao_id_fkey" FOREIGN KEY ("cliente_id", "centro_custo_padrao_id") REFERENCES "CentroCusto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey" FOREIGN KEY ("cliente_id", "centro_resultado_padrao_id") REFERENCES "CentroResultado"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_unidade_producao_id_fkey" FOREIGN KEY ("cliente_id", "unidade_producao_id") REFERENCES "UnidadeMedida"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Os 2 CHECKs (NULL passa: os padrões são opcionais).
ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_categoria_check" CHECK ("categoria" IN ('PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO', 'COLHEITA', 'PASTAGEM', 'BENFEITORIA', 'MANEJO_ANIMAL', 'OUTROS'));
ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_coeficiente_padrao_check" CHECK ("coeficiente_padrao" > 0);

-- 5. Resto (allowlist EXPAND): um índice não-único por FK, começando por "cliente_id" (R10).
CREATE INDEX "TipoAtividade_cliente_id_centro_custo_padrao_id_idx" ON "TipoAtividade"("cliente_id", "centro_custo_padrao_id");
CREATE INDEX "TipoAtividade_cliente_id_centro_resultado_padrao_id_idx" ON "TipoAtividade"("cliente_id", "centro_resultado_padrao_id");
CREATE INDEX "TipoAtividade_cliente_id_unidade_producao_id_idx" ON "TipoAtividade"("cliente_id", "unidade_producao_id");
