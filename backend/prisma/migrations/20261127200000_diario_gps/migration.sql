-- MAIKE-DIARIO-GPS — o rastreio do trajeto da máquina no Diário (fase 1: tela ligada, em primeiro plano).
-- Plano: notas/2026-11-26-plano-gps-diario.md (seções 3 e 4). Decisão e número ficam FORA deste arquivo de propósito.
--
-- EXPAND-ONLY: SÓ tabelas novas. Nenhuma coluna, tabela ou linha existente muda. Nada de DROP, RENAME, ALTER COLUMN,
-- NOT NULL em coluna antiga ou DML. Não escreve em estoque nem em custo.
--   "AtividadeTrajeto"        — um trajeto gravado numa atividade, numa máquina, num dia operacional (ABERTO | ENCERRADO | CANCELADO);
--   "AtividadeTrajetoPonto"   — um ponto do trajeto (lat/lng, precisão, velocidade, relógio do aparelho), com seq do aparelho.
-- Tenant primeiro em todo índice e unique (cliente_id), FKs compostas pelo tenant, RLS como as demais tabelas novas.
-- Reversão operacional (não executada em produção): DROP das duas tabelas novas.

-- CreateTable
CREATE TABLE "AtividadeTrajeto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "atividade_id" VARCHAR(64) NOT NULL,
    "apontamento_id" VARCHAR(64),
    "bem_id" VARCHAR(64) NOT NULL,
    "implemento_bem_id" VARCHAR(64),
    "usuario_id" VARCHAR(64),
    "data_operacional" DATE NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "iniciado_em" TIMESTAMP(3) NOT NULL,
    "encerrado_em" TIMESTAMP(3),
    "pontos_total" INTEGER NOT NULL DEFAULT 0,
    "distancia_m" DECIMAL(14,2),
    "operation_id" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeTrajeto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeTrajetoPonto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "trajeto_id" VARCHAR(64) NOT NULL,
    "seq" INTEGER NOT NULL,
    "lat" DECIMAL(10,7) NOT NULL,
    "lng" DECIMAL(10,7) NOT NULL,
    "precisao_m" DECIMAL(10,2),
    "velocidade_ms" DECIMAL(10,2),
    "capturado_em" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AtividadeTrajetoPonto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeTrajeto_cliente_id_id_key" ON "AtividadeTrajeto"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeTrajeto_cliente_id_operation_id_key" ON "AtividadeTrajeto"("cliente_id", "operation_id");

-- CreateIndex
CREATE INDEX "AtividadeTrajeto_cliente_id_atividade_id_status_idx" ON "AtividadeTrajeto"("cliente_id", "atividade_id", "status");

-- CreateIndex
CREATE INDEX "AtividadeTrajeto_cliente_id_atividade_id_data_operacional_idx" ON "AtividadeTrajeto"("cliente_id", "atividade_id", "data_operacional");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeTrajetoPonto_cliente_id_id_key" ON "AtividadeTrajetoPonto"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeTrajetoPonto_cliente_id_trajeto_id_seq_key" ON "AtividadeTrajetoPonto"("cliente_id", "trajeto_id", "seq");

-- CreateIndex
CREATE INDEX "AtividadeTrajetoPonto_cliente_id_trajeto_id_capturado_em_idx" ON "AtividadeTrajetoPonto"("cliente_id", "trajeto_id", "capturado_em");

-- Checks (tabelas novas)
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_status_check" CHECK ("status" IN ('ABERTO', 'ENCERRADO', 'CANCELADO'));

ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_valores_check" CHECK ("pontos_total" >= 0 AND ("distancia_m" IS NULL OR "distancia_m" >= 0));

ALTER TABLE "AtividadeTrajetoPonto" ADD CONSTRAINT "AtividadeTrajetoPonto_coordenadas_check" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180 AND "seq" >= 0);

ALTER TABLE "AtividadeTrajetoPonto" ADD CONSTRAINT "AtividadeTrajetoPonto_medidas_check" CHECK (("precisao_m" IS NULL OR "precisao_m" >= 0) AND ("velocidade_ms" IS NULL OR "velocidade_ms" >= 0));

-- AddForeignKey
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_empresa_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_atividade_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_apontamento_fkey" FOREIGN KEY ("cliente_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_bem_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_implemento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "implemento_bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajeto" ADD CONSTRAINT "AtividadeTrajeto_usuario_fkey" FOREIGN KEY ("cliente_id", "usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajetoPonto" ADD CONSTRAINT "AtividadeTrajetoPonto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeTrajetoPonto" ADD CONSTRAINT "AtividadeTrajetoPonto_trajeto_fkey" FOREIGN KEY ("cliente_id", "trajeto_id") REFERENCES "AtividadeTrajeto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS das tabelas novas (mesmo formato das EXPANDs anteriores: sem acesso para anon/authenticated; o backend, maike_vercel).
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['AtividadeTrajeto', 'AtividadeTrajetoPonto'];
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
