-- R2E-P1 (D-PROD-107) — ledger do rebanho por posição: cadastro de entrada
-- (`Lote`) separado do saldo operacional (`PosicaoRebanho`) e dos fatos
-- (`EventoRebanho` + `PartidaRebanho`, com data operacional por dia).
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK nas tabelas NOVAS.
-- Nenhuma tabela existente é alterada; nenhum dado é copiado ou apagado.
-- O backend antigo nunca lê estas tabelas, então continua funcionando com o
-- banco migrado (ordem "migration antes do código", D-PROD-28). O código novo
-- só usa o ledger numa empresa com linha em "RebanhoLedgerAtivacao"; sem ela,
-- tudo segue no modelo legado.
--
-- Rollback (só se nenhuma empresa tiver sido ativada — conferir antes):
--   SELECT count(*) FROM "RebanhoLedgerAtivacao";   -- precisa ser 0
--   DROP TABLE "PartidaRebanho"; DROP TABLE "EventoRebanho";
--   DROP TABLE "PosicaoRebanho"; DROP TABLE "RebanhoLedgerAtivacao";

-- CreateTable
CREATE TABLE "RebanhoLedgerAtivacao" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "data_corte" DATE NOT NULL,
    "ativado_por_usuario_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RebanhoLedgerAtivacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosicaoRebanho" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "area_id" VARCHAR(64) NOT NULL,
    "lote_entrada_id" VARCHAR(64),
    "linhagem" JSONB NOT NULL DEFAULT '[]',
    "chave_identidade" VARCHAR(512) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "numero_lote" VARCHAR(64),
    "categoria" VARCHAR(128),
    "categoria_manejo_id" VARCHAR(64),
    "categoria_manejo_nome" VARCHAR(255),
    "sexo" VARCHAR(32),
    "peso_medio_kg" DECIMAL(14,4),
    "quantidade_cabecas" INTEGER NOT NULL DEFAULT 0,
    "identificador_nome" VARCHAR(255),
    "identificador_sigla" VARCHAR(32),
    "identificador_cor" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosicaoRebanho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoRebanho" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "tipo" VARCHAR(32) NOT NULL,
    "data_operacional" DATE NOT NULL,
    "registrado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registrado_por_usuario_id" VARCHAR(64),
    "operation_id" VARCHAR(160) NOT NULL,
    "situacao" VARCHAR(16) NOT NULL DEFAULT 'ativo',
    "cancelado_em" TIMESTAMP(3),
    "cancelado_por_usuario_id" VARCHAR(64),
    "motivo_cancelamento" VARCHAR(500),
    "movimentacao_id" VARCHAR(64),
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventoRebanho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartidaRebanho" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "evento_id" VARCHAR(64) NOT NULL,
    "posicao_id" VARCHAR(64) NOT NULL,
    "data_operacional" DATE NOT NULL,
    "delta" INTEGER NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartidaRebanho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RebanhoLedgerAtivacao_cliente_id_empresa_id_key" ON "RebanhoLedgerAtivacao"("cliente_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "RebanhoLedgerAtivacao_cliente_id_id_key" ON "RebanhoLedgerAtivacao"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "PosicaoRebanho_cliente_id_empresa_id_area_id_idx" ON "PosicaoRebanho"("cliente_id", "empresa_id", "area_id");

-- CreateIndex
CREATE INDEX "PosicaoRebanho_cliente_id_lote_entrada_id_idx" ON "PosicaoRebanho"("cliente_id", "lote_entrada_id");

-- CreateIndex
CREATE UNIQUE INDEX "PosicaoRebanho_cliente_id_id_key" ON "PosicaoRebanho"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PosicaoRebanho_cliente_id_empresa_id_area_id_chave_identida_key" ON "PosicaoRebanho"("cliente_id", "empresa_id", "area_id", "chave_identidade");

-- CreateIndex
CREATE INDEX "EventoRebanho_cliente_id_empresa_id_data_operacional_idx" ON "EventoRebanho"("cliente_id", "empresa_id", "data_operacional");

-- CreateIndex
CREATE INDEX "EventoRebanho_cliente_id_movimentacao_id_idx" ON "EventoRebanho"("cliente_id", "movimentacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "EventoRebanho_cliente_id_id_key" ON "EventoRebanho"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EventoRebanho_cliente_id_empresa_id_tipo_operation_id_key" ON "EventoRebanho"("cliente_id", "empresa_id", "tipo", "operation_id");

-- CreateIndex
CREATE INDEX "PartidaRebanho_cliente_id_posicao_id_data_operacional_idx" ON "PartidaRebanho"("cliente_id", "posicao_id", "data_operacional");

-- CreateIndex
CREATE INDEX "PartidaRebanho_cliente_id_evento_id_idx" ON "PartidaRebanho"("cliente_id", "evento_id");

-- CreateIndex
CREATE UNIQUE INDEX "PartidaRebanho_cliente_id_id_key" ON "PartidaRebanho"("cliente_id", "id");

-- AddForeignKey
ALTER TABLE "RebanhoLedgerAtivacao" ADD CONSTRAINT "RebanhoLedgerAtivacao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RebanhoLedgerAtivacao" ADD CONSTRAINT "RebanhoLedgerAtivacao_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosicaoRebanho" ADD CONSTRAINT "PosicaoRebanho_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosicaoRebanho" ADD CONSTRAINT "PosicaoRebanho_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosicaoRebanho" ADD CONSTRAINT "PosicaoRebanho_cliente_id_area_id_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosicaoRebanho" ADD CONSTRAINT "PosicaoRebanho_cliente_id_lote_entrada_id_fkey" FOREIGN KEY ("cliente_id", "lote_entrada_id") REFERENCES "Lote"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoRebanho" ADD CONSTRAINT "EventoRebanho_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoRebanho" ADD CONSTRAINT "EventoRebanho_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartidaRebanho" ADD CONSTRAINT "PartidaRebanho_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartidaRebanho" ADD CONSTRAINT "PartidaRebanho_cliente_id_evento_id_fkey" FOREIGN KEY ("cliente_id", "evento_id") REFERENCES "EventoRebanho"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartidaRebanho" ADD CONSTRAINT "PartidaRebanho_cliente_id_posicao_id_fkey" FOREIGN KEY ("cliente_id", "posicao_id") REFERENCES "PosicaoRebanho"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariantes no banco (o motor também confere; aqui é a última barreira).
ALTER TABLE "PosicaoRebanho" ADD CONSTRAINT "PosicaoRebanho_quantidade_nao_negativa" CHECK ("quantidade_cabecas" >= 0);
ALTER TABLE "PosicaoRebanho" ADD CONSTRAINT "PosicaoRebanho_peso_positivo" CHECK ("peso_medio_kg" IS NULL OR "peso_medio_kg" > 0);
ALTER TABLE "PartidaRebanho" ADD CONSTRAINT "PartidaRebanho_delta_nao_zero" CHECK ("delta" <> 0);
ALTER TABLE "EventoRebanho" ADD CONSTRAINT "EventoRebanho_situacao_valida" CHECK ("situacao" IN ('ativo', 'cancelado'));
ALTER TABLE "EventoRebanho" ADD CONSTRAINT "EventoRebanho_tipo_valido" CHECK ("tipo" IN ('SALDO_ABERTURA', 'ENTRADA', 'TRANSFERENCIA'));
ALTER TABLE "EventoRebanho" ADD CONSTRAINT "EventoRebanho_cancelamento_coerente" CHECK (("situacao" = 'cancelado') = ("cancelado_em" IS NOT NULL));

-- Data API do Supabase (D-PROD-56): tabelas só do backend. Mesmo padrão das
-- migrations anteriores: REVOKE de anon/authenticated, RLS ligado sem FORCE e
-- política só para o papel do backend quando ele existe.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['RebanhoLedgerAtivacao', 'PosicaoRebanho', 'EventoRebanho', 'PartidaRebanho'];
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
