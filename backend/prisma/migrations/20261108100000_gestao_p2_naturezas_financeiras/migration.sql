-- D-PROD-152 — MAIKE Gestão P2: naturezas financeiras GERENCIAIS (catálogo que
-- classifica futuras receitas e despesas). Não é plano de contas contábil: sem
-- valor, saldo, lançamento, conta bancária ou tributo.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK na tabela NOVA. Nenhuma
-- tabela existente é alterada e nenhum dado é migrado.
--
-- Escopo garantido pelo banco: a FK composta (cliente_id, empresa_id, tipo,
-- pai_id) → (cliente_id, empresa_id, tipo, id) faz o pai ser do MESMO tenant,
-- da MESMA empresa e do MESMO tipo (RECEITA/DESPESA). ON DELETE/UPDATE RESTRICT:
-- nada some em cascata e o tipo de um nó com filhos não muda.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nada a
-- referencia; removê-la não afeta dados existentes.

CREATE TABLE "NaturezaFinanceira" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "tipo" VARCHAR(10) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "pai_id" VARCHAR(64),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaturezaFinanceira_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NaturezaFinanceira_cliente_id_empresa_id_tipo_ativo_idx" ON "NaturezaFinanceira"("cliente_id", "empresa_id", "tipo", "ativo");

CREATE INDEX "NaturezaFinanceira_cliente_id_empresa_id_pai_id_idx" ON "NaturezaFinanceira"("cliente_id", "empresa_id", "pai_id");

CREATE INDEX "NaturezaFinanceira_cliente_id_empresa_id_tipo_createdAt_id_idx" ON "NaturezaFinanceira"("cliente_id", "empresa_id", "tipo", "createdAt", "id");

CREATE UNIQUE INDEX "NaturezaFinanceira_cliente_id_id_key" ON "NaturezaFinanceira"("cliente_id", "id");

CREATE UNIQUE INDEX "NaturezaFinanceira_cliente_id_empresa_id_id_key" ON "NaturezaFinanceira"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "NaturezaFinanceira_cliente_id_empresa_id_tipo_id_key" ON "NaturezaFinanceira"("cliente_id", "empresa_id", "tipo", "id");

CREATE UNIQUE INDEX "NaturezaFinanceira_cliente_id_numero_key" ON "NaturezaFinanceira"("cliente_id", "numero");

CREATE UNIQUE INDEX "NaturezaFinanceira_cliente_id_empresa_id_tipo_nome_key" ON "NaturezaFinanceira"("cliente_id", "empresa_id", "tipo", "nome");

ALTER TABLE "NaturezaFinanceira" ADD CONSTRAINT "NaturezaFinanceira_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NaturezaFinanceira" ADD CONSTRAINT "NaturezaFinanceira_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NaturezaFinanceira" ADD CONSTRAINT "NaturezaFinanceira_cliente_id_empresa_id_tipo_pai_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "tipo", "pai_id") REFERENCES "NaturezaFinanceira"("cliente_id", "empresa_id", "tipo", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Domínio fechado do tipo e sem autorreferência direta (ciclos maiores e
-- profundidade são barrados no serviço, sob trava por empresa+tipo).
ALTER TABLE "NaturezaFinanceira" ADD CONSTRAINT "NaturezaFinanceira_tipo_check" CHECK ("tipo" IN ('RECEITA', 'DESPESA'));
ALTER TABLE "NaturezaFinanceira" ADD CONSTRAINT "NaturezaFinanceira_pai_diferente_check" CHECK ("pai_id" IS NULL OR "pai_id" <> "id");

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['NaturezaFinanceira'];
BEGIN
  FOREACH tbl IN ARRAY tabelas
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO maike_vercel USING (true) WITH CHECK (true)', pol_name, tbl);
    END IF;
  END LOOP;
END $$;
