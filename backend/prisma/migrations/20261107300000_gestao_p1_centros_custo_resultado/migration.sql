-- D-PROD-145 — MAIKE Gestão P1: centros de custo, centros de resultado e o
-- vínculo N:N entre eles (catálogo de combinações; sem financeiro transacional).
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK nas tabelas NOVAS.
-- Nenhuma tabela existente é alterada (Fornecedor, Lote, EstoqueLoteNota,
-- MovimentacaoEstoque, Produto e o ledger do rebanho ficam intactos).
--
-- Escopo garantido pelo banco: as FKs compostas (cliente_id, empresa_id, …)
-- fazem o pai da árvore e os dois lados do vínculo pertencerem ao MESMO tenant
-- e à MESMA empresa. ON DELETE RESTRICT em todas: nada some em cascata.
--
-- Reversão operacional (não executada em produção): as três tabelas são novas e
-- nada as referencia; removê-las não afeta dados existentes.

CREATE TABLE "CentroCusto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "pai_id" VARCHAR(64),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentroCusto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CentroResultado" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "pai_id" VARCHAR(64),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentroResultado_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CentroCustoResultado" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "centro_custo_id" VARCHAR(64) NOT NULL,
    "centro_resultado_id" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentroCustoResultado_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CentroCusto_cliente_id_empresa_id_ativo_idx" ON "CentroCusto"("cliente_id", "empresa_id", "ativo");

CREATE INDEX "CentroCusto_cliente_id_empresa_id_pai_id_idx" ON "CentroCusto"("cliente_id", "empresa_id", "pai_id");

CREATE INDEX "CentroCusto_cliente_id_empresa_id_createdAt_id_idx" ON "CentroCusto"("cliente_id", "empresa_id", "createdAt", "id");

CREATE UNIQUE INDEX "CentroCusto_cliente_id_id_key" ON "CentroCusto"("cliente_id", "id");

CREATE UNIQUE INDEX "CentroCusto_cliente_id_empresa_id_id_key" ON "CentroCusto"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "CentroCusto_cliente_id_numero_key" ON "CentroCusto"("cliente_id", "numero");

CREATE UNIQUE INDEX "CentroCusto_cliente_id_empresa_id_nome_key" ON "CentroCusto"("cliente_id", "empresa_id", "nome");

CREATE INDEX "CentroResultado_cliente_id_empresa_id_ativo_idx" ON "CentroResultado"("cliente_id", "empresa_id", "ativo");

CREATE INDEX "CentroResultado_cliente_id_empresa_id_pai_id_idx" ON "CentroResultado"("cliente_id", "empresa_id", "pai_id");

CREATE INDEX "CentroResultado_cliente_id_empresa_id_createdAt_id_idx" ON "CentroResultado"("cliente_id", "empresa_id", "createdAt", "id");

CREATE UNIQUE INDEX "CentroResultado_cliente_id_id_key" ON "CentroResultado"("cliente_id", "id");

CREATE UNIQUE INDEX "CentroResultado_cliente_id_empresa_id_id_key" ON "CentroResultado"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "CentroResultado_cliente_id_numero_key" ON "CentroResultado"("cliente_id", "numero");

CREATE UNIQUE INDEX "CentroResultado_cliente_id_empresa_id_nome_key" ON "CentroResultado"("cliente_id", "empresa_id", "nome");

CREATE INDEX "CentroCustoResultado_cliente_id_empresa_id_centro_resultado_idx" ON "CentroCustoResultado"("cliente_id", "empresa_id", "centro_resultado_id");

CREATE UNIQUE INDEX "CentroCustoResultado_cliente_id_id_key" ON "CentroCustoResultado"("cliente_id", "id");

CREATE UNIQUE INDEX "CentroCustoResultado_cliente_id_empresa_id_centro_custo_id__key" ON "CentroCustoResultado"("cliente_id", "empresa_id", "centro_custo_id", "centro_resultado_id");

ALTER TABLE "CentroCusto" ADD CONSTRAINT "CentroCusto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroCusto" ADD CONSTRAINT "CentroCusto_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroCusto" ADD CONSTRAINT "CentroCusto_cliente_id_empresa_id_pai_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "pai_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroResultado" ADD CONSTRAINT "CentroResultado_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroResultado" ADD CONSTRAINT "CentroResultado_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroResultado" ADD CONSTRAINT "CentroResultado_cliente_id_empresa_id_pai_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "pai_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroCustoResultado" ADD CONSTRAINT "CentroCustoResultado_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroCustoResultado" ADD CONSTRAINT "CentroCustoResultado_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroCustoResultado" ADD CONSTRAINT "CentroCustoResultado_cliente_id_empresa_id_centro_custo_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CentroCustoResultado" ADD CONSTRAINT "CentroCustoResultado_cliente_id_empresa_id_centro_resultad_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Sem autorreferência direta (ciclos maiores são barrados no serviço, sob trava).
ALTER TABLE "CentroCusto" ADD CONSTRAINT "CentroCusto_pai_diferente_check" CHECK ("pai_id" IS NULL OR "pai_id" <> "id");
ALTER TABLE "CentroResultado" ADD CONSTRAINT "CentroResultado_pai_diferente_check" CHECK ("pai_id" IS NULL OR "pai_id" <> "id");

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['CentroCusto', 'CentroResultado', 'CentroCustoResultado'];
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
