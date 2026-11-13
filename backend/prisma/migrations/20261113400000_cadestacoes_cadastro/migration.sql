-- Cadastro de Estações da fazenda: períodos de ÁGUAS, TRANSIÇÃO ou SECA, com
-- data de início e de fim, por fazenda (empresa). Tabela física "CADESTACOES",
-- nome fixado pelo proprietário (model Prisma CadEstacao com @@map).
-- Primeira fatia: NADA referencia CADESTACOES e ela não referencia nenhum
-- cadastro de negócio; as únicas FKs são o escopo (Cliente e Empresa).
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK na tabela NOVA. Nenhuma
-- tabela existente é alterada e nenhum dado é migrado.
--
-- Escopo garantido pelo banco: a FK composta (cliente_id, empresa_id) →
-- Empresa(cliente_id, id) faz a fazenda ser do MESMO tenant. ON DELETE
-- RESTRICT: excluir uma fazenda com estações é barrado.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nada a
-- referencia; removê-la não afeta dados existentes.

-- CreateTable
CREATE TABLE "CADESTACOES" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_fim" DATE NOT NULL,
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CADESTACOES_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CADESTACOES_cliente_id_empresa_id_ativo_idx" ON "CADESTACOES"("cliente_id", "empresa_id", "ativo");

-- CreateIndex
CREATE INDEX "CADESTACOES_cliente_id_empresa_id_data_inicio_idx" ON "CADESTACOES"("cliente_id", "empresa_id", "data_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "CADESTACOES_cliente_id_id_key" ON "CADESTACOES"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADESTACOES_cliente_id_empresa_id_nome_key" ON "CADESTACOES"("cliente_id", "empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "CADESTACOES" ADD CONSTRAINT "CADESTACOES_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADESTACOES" ADD CONSTRAINT "CADESTACOES_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domínio do tipo e coerência do período (o serviço valida antes; o banco é a
-- última barreira).
ALTER TABLE "CADESTACOES" ADD CONSTRAINT "CADESTACOES_tipo_check" CHECK ("tipo" IN ('AGUAS', 'TRANSICAO', 'SECA'));

ALTER TABLE "CADESTACOES" ADD CONSTRAINT "CADESTACOES_periodo_check" CHECK ("data_fim" >= "data_inicio");

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['CADESTACOES'];
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
