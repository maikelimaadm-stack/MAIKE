-- Cadastro de Curvas de Ganho de Peso da fazenda: ganho médio diário (GMD,
-- kg/dia) previsto em cada tipo de estação (ÁGUAS, TRANSIÇÃO e SECA), por
-- fazenda (empresa). Tabela física "CADCURVAGANHO", nome fixado pelo
-- proprietário (model Prisma CadCurvaGanho com @@map).
-- Primeira fatia: NADA referencia CADCURVAGANHO e ela não referencia nenhum
-- cadastro de negócio (nem categoria, nem lote, nem estação); as únicas FKs
-- são o escopo (Cliente e Empresa).
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK na tabela NOVA. Nenhuma
-- tabela existente é alterada e nenhum dado é migrado.
--
-- Escopo garantido pelo banco: a FK composta (cliente_id, empresa_id) →
-- Empresa(cliente_id, id) faz a fazenda ser do MESMO tenant. ON DELETE
-- RESTRICT: excluir uma fazenda com curvas é barrado.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nada a
-- referencia; removê-la não afeta dados existentes.

-- CreateTable
CREATE TABLE "CADCURVAGANHO" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "gmd_aguas" DECIMAL(6,3) NOT NULL,
    "gmd_transicao" DECIMAL(6,3) NOT NULL,
    "gmd_seca" DECIMAL(6,3) NOT NULL,
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CADCURVAGANHO_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CADCURVAGANHO_cliente_id_empresa_id_ativo_idx" ON "CADCURVAGANHO"("cliente_id", "empresa_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_id_key" ON "CADCURVAGANHO"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADCURVAGANHO_cliente_id_empresa_id_nome_key" ON "CADCURVAGANHO"("cliente_id", "empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "CADCURVAGANHO" ADD CONSTRAINT "CADCURVAGANHO_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADCURVAGANHO" ADD CONSTRAINT "CADCURVAGANHO_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Faixa do GMD (kg/dia): de -2 (perda de peso, típica da seca) a 3. O serviço
-- valida antes; o banco é a última barreira.
ALTER TABLE "CADCURVAGANHO" ADD CONSTRAINT "CADCURVAGANHO_gmd_check" CHECK ("gmd_aguas" BETWEEN -2 AND 3 AND "gmd_transicao" BETWEEN -2 AND 3 AND "gmd_seca" BETWEEN -2 AND 3);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['CADCURVAGANHO'];
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
