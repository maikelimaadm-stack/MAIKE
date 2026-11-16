-- MAIKE-CULTURAS — Cadastro de Culturas da fazenda: o tipo (PASTAGEM, CAPINEIRA,
-- LAVOURA ou SILAGEM), o código de numeração da fazenda ("001", "002"…), o nome,
-- a espécie e a cultivar, e as alturas de referência de pastejo (entrada e saída,
-- em cm). Tabela física "CADCULTURAS", nome fixado pelo proprietário (model Prisma
-- Cultura com @@map). Decisão, relatório e runbook em docs/engineering/
-- (MAIKE-CULTURAS-*.md). O número da decisão fica FORA deste arquivo de propósito:
-- renumerar a decisão nunca muda o checksum aplicado.
--
-- Primeira fatia: NADA referencia CADCULTURAS ainda (a Área continua com o texto de
-- antes) e ela não referencia nenhum cadastro de negócio; as únicas FKs são o escopo
-- (Cliente e Empresa). A lista de referência (Marandu, Mombaça…) é criada pelo
-- serviço, por comando idempotente: nenhum dado é semeado aqui.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK na tabela NOVA e o bloco RLS
-- dela. Nenhuma tabela existente é alterada e nenhum dado é migrado.
--
-- Escopo garantido pelo banco: a FK composta (cliente_id, empresa_id) →
-- Empresa(cliente_id, id) faz a fazenda ser do MESMO tenant. ON DELETE RESTRICT.
--
-- Reversão operacional (não executada em produção): a tabela é nova e nada a
-- referencia; removê-la não afeta dados existentes.

-- CreateTable
CREATE TABLE "CADCULTURAS" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "codigo" VARCHAR(16) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "especie" VARCHAR(120),
    "cultivar" VARCHAR(120),
    "altura_entrada_cm" DECIMAL(6,1),
    "altura_saida_cm" DECIMAL(6,1),
    "observacoes" VARCHAR(2000),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CADCULTURAS_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CADCULTURAS_cliente_id_empresa_id_ativo_idx" ON "CADCULTURAS"("cliente_id", "empresa_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "CADCULTURAS_cliente_id_id_key" ON "CADCULTURAS"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CADCULTURAS_cliente_id_empresa_id_codigo_key" ON "CADCULTURAS"("cliente_id", "empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "CADCULTURAS_cliente_id_empresa_id_nome_key" ON "CADCULTURAS"("cliente_id", "empresa_id", "nome");

-- AddForeignKey
ALTER TABLE "CADCULTURAS" ADD CONSTRAINT "CADCULTURAS_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CADCULTURAS" ADD CONSTRAINT "CADCULTURAS_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Forma: o serviço valida antes; o banco é a última barreira. Valores fechados.
ALTER TABLE "CADCULTURAS" ADD CONSTRAINT "CADCULTURAS_tipo_check" CHECK ("tipo" IN ('PASTAGEM', 'CAPINEIRA', 'LAVOURA', 'SILAGEM'));

ALTER TABLE "CADCULTURAS" ADD CONSTRAINT "CADCULTURAS_alturas_check" CHECK (("altura_entrada_cm" IS NULL OR "altura_entrada_cm" > 0) AND ("altura_saida_cm" IS NULL OR "altura_saida_cm" > 0) AND ("altura_entrada_cm" IS NULL OR "altura_saida_cm" IS NULL OR "altura_saida_cm" < "altura_entrada_cm"));

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['CADCULTURAS'];
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
