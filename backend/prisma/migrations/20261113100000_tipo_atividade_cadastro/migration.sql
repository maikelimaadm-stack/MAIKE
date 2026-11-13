-- D-PROD-180 — Cadastro de Tipos de Atividade: catálogo por tenant, filho de
-- GrupoAtividade, no mesmo molde do TipoTarefa e SEM as flags
-- exige_area/pode_ter_* (D-PROD-179). Nada referencia TipoAtividade ainda.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK na tabela NOVA. Nenhuma tabela
-- existente é alterada e nenhum dado é migrado.
--
-- Escopo garantido pelo banco: a FK composta (cliente_id, grupo_atividade_id)
-- → GrupoAtividade(cliente_id, id) faz o grupo ser do MESMO tenant. ON DELETE
-- RESTRICT: excluir um grupo com tipos de atividade é barrado.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nada a
-- referencia; removê-la não afeta dados existentes.

-- CreateTable
CREATE TABLE "TipoAtividade" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "nome_tipo" VARCHAR(255) NOT NULL,
    "grupo_atividade_id" VARCHAR(64) NOT NULL,
    "grupo_atividade_nome" VARCHAR(255) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "descricao" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoAtividade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TipoAtividade_cliente_id_grupo_atividade_id_idx" ON "TipoAtividade"("cliente_id", "grupo_atividade_id");

-- CreateIndex
CREATE INDEX "TipoAtividade_cliente_id_ativo_idx" ON "TipoAtividade"("cliente_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoAtividade_cliente_id_grupo_atividade_id_nome_tipo_key" ON "TipoAtividade"("cliente_id", "grupo_atividade_id", "nome_tipo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoAtividade_cliente_id_id_key" ON "TipoAtividade"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_cliente_id_grupo_atividade_id_fkey" FOREIGN KEY ("cliente_id", "grupo_atividade_id") REFERENCES "GrupoAtividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['TipoAtividade'];
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
