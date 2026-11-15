-- MAIKE-LEITURA-COCHO — leitura de cocho feita no campo (etapa 3 da
-- suplementação). Decisão, relatório e runbook em docs/engineering/
-- (MAIKE-LEITURA-COCHO-*.md). O número da decisão fica FORA deste arquivo de
-- propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- Uma tabela NOVA, "LEITURACOCHO": o que se viu no cocho num dia — escore
-- (VAZIO | ADEQUADO | CHEIO), acesso (BOM | RUIM) e estrutura (BOA | REPARO |
-- QUEBRADA), com observação e o nome de quem registrou. A leitura NÃO
-- movimenta estoque; alimenta o farol do cocho no mapa.
--
-- EXPAND-ONLY (classificador `premergeMigrateLib.classificarMigrations`): só
-- CREATE TABLE / INDEX / FK / CHECK na tabela NOVA e o bloco RLS dela. Nenhuma
-- tabela existente é alterada (zero DDL em PontoSuplementacao, Empresa ou
-- Cliente) e nenhum dado é migrado ou semeado. As relações inversas do schema
-- são só do Prisma.
--
-- Escopo garantido pelo banco: toda FK é composta pelo tenant. A leitura aponta
-- para Empresa(cliente_id, id), Restrict, e para PontoSuplementacao(cliente_id,
-- id) com ON DELETE CASCADE: apagar o cocho apaga as leituras dele.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nenhuma
-- tabela antiga a referencia; removê-la não afeta dados anteriores a esta
-- migration.

-- CreateTable
CREATE TABLE "LEITURACOCHO" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "ponto_suplementacao_id" VARCHAR(64) NOT NULL,
    "data_leitura" DATE NOT NULL,
    "escore" VARCHAR(16) NOT NULL,
    "acesso" VARCHAR(8) NOT NULL,
    "estrutura" VARCHAR(16) NOT NULL,
    "observacoes" VARCHAR(2000),
    "registrado_por_nome" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LEITURACOCHO_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LEITURACOCHO_cliente_id_empresa_id_data_leitura_idx" ON "LEITURACOCHO"("cliente_id", "empresa_id", "data_leitura");

-- CreateIndex
CREATE INDEX "LEITURACOCHO_cliente_id_ponto_suplementacao_id_data_leitura_idx" ON "LEITURACOCHO"("cliente_id", "ponto_suplementacao_id", "data_leitura");

-- CreateIndex
CREATE UNIQUE INDEX "LEITURACOCHO_cliente_id_id_key" ON "LEITURACOCHO"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "LEITURACOCHO" ADD CONSTRAINT "LEITURACOCHO_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LEITURACOCHO" ADD CONSTRAINT "LEITURACOCHO_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LEITURACOCHO" ADD CONSTRAINT "LEITURACOCHO_cliente_id_ponto_suplementacao_id_fkey" FOREIGN KEY ("cliente_id", "ponto_suplementacao_id") REFERENCES "PontoSuplementacao"("cliente_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Forma: o serviço valida antes; o banco é a última barreira. Valores fechados.
ALTER TABLE "LEITURACOCHO" ADD CONSTRAINT "LEITURACOCHO_escore_check" CHECK ("escore" IN ('VAZIO', 'ADEQUADO', 'CHEIO'));

ALTER TABLE "LEITURACOCHO" ADD CONSTRAINT "LEITURACOCHO_acesso_check" CHECK ("acesso" IN ('BOM', 'RUIM'));

ALTER TABLE "LEITURACOCHO" ADD CONSTRAINT "LEITURACOCHO_estrutura_check" CHECK ("estrutura" IN ('BOA', 'REPARO', 'QUEBRADA'));

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['LEITURACOCHO'];
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
