-- R2E-PR174-R1 (D-PROD-107) — ledger do rebanho: todos os manejos, série de
-- pesos, modo de ativação por entradas e vínculo de tarefa com a posição.
--
-- EXPAND, compatível com o backend publicado (que não lê estas tabelas):
--   - CHECK de tipos do EventoRebanho passa a aceitar os manejos;
--   - RebanhoLedgerAtivacao.modo (default 'saldo_abertura' = comportamento atual);
--   - PesoRebanho (nova): peso por posição por data, desconhecido = NULL;
--   - LancamentoTarefa.posicao_id (nullable) + FK/índice;
--   - FKs de PartidaRebanho passam a incluir empresa_id (partida não cruza
--     empresa do evento nem da posição) — troca de FK sem perda de dado.
-- Não altera a migration 20261102200000 (checksum preservado).
--
-- Rollback (só sem dados de manejo além de transferência — conferir antes):
--   SELECT tipo, count(*) FROM "EventoRebanho" GROUP BY 1;  -- só SALDO_ABERTURA/ENTRADA/TRANSFERENCIA
--   SELECT count(*) FROM "PesoRebanho";                      -- 0
--   SELECT count(*) FROM "LancamentoTarefa" WHERE posicao_id IS NOT NULL;  -- 0
--   (desfazer na ordem inversa deste arquivo)

-- DropForeignKey
ALTER TABLE "PartidaRebanho" DROP CONSTRAINT "PartidaRebanho_cliente_id_evento_id_fkey";

-- DropForeignKey
ALTER TABLE "PartidaRebanho" DROP CONSTRAINT "PartidaRebanho_cliente_id_posicao_id_fkey";

-- AlterTable
ALTER TABLE "LancamentoTarefa" ADD COLUMN     "posicao_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "RebanhoLedgerAtivacao" ADD COLUMN     "modo" VARCHAR(32) NOT NULL DEFAULT 'saldo_abertura';

-- CreateTable
CREATE TABLE "PesoRebanho" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "evento_id" VARCHAR(64) NOT NULL,
    "posicao_id" VARCHAR(64) NOT NULL,
    "data_operacional" DATE NOT NULL,
    "peso_medio_kg" DECIMAL(14,4),
    "medido" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PesoRebanho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PesoRebanho_cliente_id_posicao_id_data_operacional_idx" ON "PesoRebanho"("cliente_id", "posicao_id", "data_operacional");

-- CreateIndex
CREATE INDEX "PesoRebanho_cliente_id_evento_id_idx" ON "PesoRebanho"("cliente_id", "evento_id");

-- CreateIndex
CREATE UNIQUE INDEX "PesoRebanho_cliente_id_id_key" ON "PesoRebanho"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EventoRebanho_cliente_id_empresa_id_id_key" ON "EventoRebanho"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE INDEX "LancamentoTarefa_cliente_id_posicao_id_idx" ON "LancamentoTarefa"("cliente_id", "posicao_id");

-- CreateIndex
CREATE UNIQUE INDEX "PosicaoRebanho_cliente_id_empresa_id_id_key" ON "PosicaoRebanho"("cliente_id", "empresa_id", "id");

-- AddForeignKey
ALTER TABLE "LancamentoTarefa" ADD CONSTRAINT "LancamentoTarefa_cliente_id_posicao_id_fkey" FOREIGN KEY ("cliente_id", "posicao_id") REFERENCES "PosicaoRebanho"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartidaRebanho" ADD CONSTRAINT "PartidaRebanho_cliente_id_empresa_id_evento_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "evento_id") REFERENCES "EventoRebanho"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartidaRebanho" ADD CONSTRAINT "PartidaRebanho_cliente_id_empresa_id_posicao_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "posicao_id") REFERENCES "PosicaoRebanho"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesoRebanho" ADD CONSTRAINT "PesoRebanho_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesoRebanho" ADD CONSTRAINT "PesoRebanho_cliente_id_empresa_id_evento_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "evento_id") REFERENCES "EventoRebanho"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PesoRebanho" ADD CONSTRAINT "PesoRebanho_cliente_id_empresa_id_posicao_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "posicao_id") REFERENCES "PosicaoRebanho"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tipos de evento: os manejos do mapa passam a existir no ledger.
ALTER TABLE "EventoRebanho" DROP CONSTRAINT "EventoRebanho_tipo_valido";
ALTER TABLE "EventoRebanho" ADD CONSTRAINT "EventoRebanho_tipo_valido" CHECK ("tipo" IN (
  'SALDO_ABERTURA', 'ENTRADA', 'TRANSFERENCIA', 'MORTE', 'ABATE', 'NASCIMENTO', 'PESAGEM', 'MUDANCA_CATEGORIA', 'JUNCAO'
));
ALTER TABLE "RebanhoLedgerAtivacao" ADD CONSTRAINT "RebanhoLedgerAtivacao_modo_valido" CHECK ("modo" IN ('saldo_abertura', 'entradas'));
ALTER TABLE "PesoRebanho" ADD CONSTRAINT "PesoRebanho_peso_positivo" CHECK ("peso_medio_kg" IS NULL OR "peso_medio_kg" > 0);

-- Data API do Supabase (D-PROD-56): tabela nova só do backend.
DO $$
DECLARE
  pol_name constant text := 'maike_backend_all';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."PesoRebanho" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public."PesoRebanho" FROM authenticated';
  END IF;
  EXECUTE 'ALTER TABLE public."PesoRebanho" ENABLE ROW LEVEL SECURITY';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') THEN
    EXECUTE format('DROP POLICY IF EXISTS %I ON public."PesoRebanho"', pol_name);
    EXECUTE format('CREATE POLICY %I ON public."PesoRebanho" FOR ALL TO maike_vercel USING (true) WITH CHECK (true)', pol_name);
  END IF;
END $$;
