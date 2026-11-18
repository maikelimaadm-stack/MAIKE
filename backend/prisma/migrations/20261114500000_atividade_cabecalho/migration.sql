-- MAIKE-ATIVIDADE-CABECALHO (Fatia 2 do Lançamento de Atividades) — a atividade
-- vira CABEÇALHO e o apontamento de hoje vira FILHO dela. Decisão, contrato,
-- runbook e relatório em docs/engineering/ (MAIKE-ATIVIDADE-CABECALHO-*.md). O
-- número da decisão fica FORA deste arquivo de propósito: renumerar a decisão
-- nunca muda o checksum aplicado.
--
-- CONTRACT (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS), nesta ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma
--      migrate (72707369) e as 3 tabelas antigas travadas em ACCESS EXCLUSIVE
--      ANTES de conferir, para que nada seja gravado nelas entre a conferência e
--      o DROP (sem a trava, um item gravado por uma transação concorrente depois
--      da conferência seria apagado com a tabela);
--   2. as tabelas NOVAS "Atividade" e "AtividadeApontamento" (allowlist EXPAND:
--      CREATE TABLE / INDEX / CHECK / FK nas novas e RLS das novas);
--   3. a CONVERSÃO pinada: cada linha de "ApontamentoAtividade" vira uma
--      "Atividade" (id 'atv_' || id antigo, mesmo número) e um
--      "AtividadeApontamento" filho (mesmo id antigo, sequência 1, sem turno);
--      o contador do número passa a ser o da entidade 'Atividade';
--   4. os DROP TABLE pinados das 3 tabelas antigas (filhas primeiro). Os itens de
--      custo (D-PROD-193) e as fatias FIFO têm de estar VAZIOS (a guarda confere):
--      nada com custo é apagado. Produto e máquina voltam na Fatia 3.
--
-- Nada é descartado: os campos sem lugar no modelo novo (implemento, hora de
-- início/fim, horas trabalhadas) têm de estar vazios, senão a guarda recusa.
-- A unidade de texto vira o snapshot `unidade_producao_sigla`; a máquina vira o
-- `bem_id` do cabeçalho; centro de custo, centro de resultado, área (com o setor
-- dela), safra e tarefa vão para o cabeçalho; operador, produção, observação e
-- cancelamento vão para o apontamento.
--
-- Escopo garantido pelo banco: toda FK nova é composta e tenant-aware, RESTRICT.
-- Reversão operacional: não automática (a tabela antiga deixa de existir); o
-- runbook descreve o caminho de volta a partir das tabelas novas.

-- Guarda: falha fechada se o banco não estiver no estado que a conversão conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."ApontamentoAtividade"') IS NULL
     OR to_regclass('public."ApontamentoAtividadeItem"') IS NULL
     OR to_regclass('public."ApontamentoAtividadeItemConsumoLote"') IS NULL THEN
    RAISE EXCEPTION 'guarda: as 3 tabelas antigas do apontamento de atividade têm de existir';
  END IF;
  IF to_regclass('public."Atividade"') IS NOT NULL OR to_regclass('public."AtividadeApontamento"') IS NOT NULL THEN
    RAISE EXCEPTION 'guarda: as tabelas novas da atividade já existem';
  END IF;
  -- Trava ANTES de conferir: até o COMMIT ninguém grava nas 3 antigas (o que a guarda conferiu é o que a conversão lê e o DROP apaga).
  LOCK TABLE public."ApontamentoAtividade", public."ApontamentoAtividadeItem", public."ApontamentoAtividadeItemConsumoLote" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."ApontamentoAtividadeItem") OR EXISTS (SELECT 1 FROM public."ApontamentoAtividadeItemConsumoLote") THEN
    RAISE EXCEPTION 'guarda: há itens de custo ou fatias FIFO no apontamento antigo; a conversão não os carrega';
  END IF;
  IF EXISTS (SELECT 1 FROM public."ApontamentoAtividade"
              WHERE "implemento_bem_id" IS NOT NULL OR "hora_inicio" IS NOT NULL OR "hora_fim" IS NOT NULL
                 OR "horas_trabalhadas" IS NOT NULL) THEN
    RAISE EXCEPTION 'guarda: há apontamento antigo com implemento, hora ou horas trabalhadas; o modelo novo não tem onde guardar';
  END IF;
  IF EXISTS (SELECT 1 FROM public."ApontamentoAtividade" WHERE "status" NOT IN ('CONFIRMADO', 'CANCELADO')
                OR ("status" = 'CANCELADO') <> ("cancelado_em" IS NOT NULL)) THEN
    RAISE EXCEPTION 'guarda: há apontamento antigo com status fora de CONFIRMADO/CANCELADO ou cancelamento incompleto';
  END IF;
  IF EXISTS (SELECT 1 FROM public."EntidadeCodigoSequencia" WHERE "entidade" = 'Atividade') THEN
    RAISE EXCEPTION 'guarda: já existe contador para a entidade Atividade';
  END IF;
END $$;

-- CreateTable
CREATE TABLE "Atividade" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "tipo_atividade_id" VARCHAR(64) NOT NULL,
    "tipo_atividade_nome" VARCHAR(255) NOT NULL,
    "grupo_atividade_id" VARCHAR(64) NOT NULL,
    "grupo_atividade_nome" VARCHAR(255) NOT NULL,
    "area_id" VARCHAR(64),
    "setor_id" VARCHAR(64),
    "setor_nome" VARCHAR(255),
    "bem_id" VARCHAR(64),
    "safra_ciclo" VARCHAR(32),
    "centro_custo_id" VARCHAR(64),
    "centro_resultado_id" VARCHAR(64),
    "unidade_producao_id" VARCHAR(64),
    "unidade_producao_sigla" VARCHAR(32),
    "data_inicio" DATE,
    "data_prevista_fim" DATE,
    "data_conclusao" DATE,
    "area_planejada" DECIMAL(14,4),
    "area_executada" DECIMAL(14,4),
    "quantidade_produzida" DECIMAL(14,4),
    "lancamento_tarefa_id" VARCHAR(64),
    "observacao" VARCHAR(2000),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ABERTA',
    "concluida_em" TIMESTAMP(3),
    "concluida_por_usuario_id" VARCHAR(64),
    "cancelada_em" TIMESTAMP(3),
    "cancelado_por_usuario_id" VARCHAR(64),
    "motivo_cancelamento" VARCHAR(500),
    "reaberta_em" TIMESTAMP(3),
    "reaberta_por_usuario_id" VARCHAR(64),
    "motivo_reabertura" VARCHAR(500),
    "criado_por_usuario_id" VARCHAR(64),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Atividade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeApontamento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "atividade_id" VARCHAR(64) NOT NULL,
    "data_operacional" DATE NOT NULL,
    "turno" VARCHAR(16),
    "sequencia" INTEGER NOT NULL,
    "operador_usuario_id" VARCHAR(64),
    "area_executada_dia" DECIMAL(14,4),
    "quantidade_produzida_dia" DECIMAL(14,4),
    "observacao" VARCHAR(2000),
    "origem" VARCHAR(16) NOT NULL DEFAULT 'WEB',
    "status" VARCHAR(16) NOT NULL DEFAULT 'CONFIRMADO',
    "cancelado_em" TIMESTAMP(3),
    "cancelado_por_usuario_id" VARCHAR(64),
    "motivo_cancelamento" VARCHAR(500),
    "criado_por_usuario_id" VARCHAR(64),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AtividadeApontamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_empresa_id_createdAt_id_idx" ON "Atividade"("cliente_id", "empresa_id", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_empresa_id_status_createdAt_id_idx" ON "Atividade"("cliente_id", "empresa_id", "status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_empresa_id_tipo_atividade_id_idx" ON "Atividade"("cliente_id", "empresa_id", "tipo_atividade_id");

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_area_id_idx" ON "Atividade"("cliente_id", "area_id");

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_setor_id_idx" ON "Atividade"("cliente_id", "setor_id");

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_empresa_id_bem_id_idx" ON "Atividade"("cliente_id", "empresa_id", "bem_id");

-- CreateIndex
CREATE INDEX "Atividade_cliente_id_lancamento_tarefa_id_idx" ON "Atividade"("cliente_id", "lancamento_tarefa_id");

-- CreateIndex
CREATE UNIQUE INDEX "Atividade_cliente_id_id_key" ON "Atividade"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Atividade_cliente_id_empresa_id_id_key" ON "Atividade"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Atividade_cliente_id_numero_key" ON "Atividade"("cliente_id", "numero");

-- CreateIndex
CREATE INDEX "AtividadeApontamento_cliente_id_empresa_id_atividade_id_idx" ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id");

-- CreateIndex
CREATE INDEX "AtividadeApontamento_cliente_id_operador_usuario_id_idx" ON "AtividadeApontamento"("cliente_id", "operador_usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamento_cliente_id_id_key" ON "AtividadeApontamento"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamento_cliente_id_empresa_id_id_key" ON "AtividadeApontamento"("cliente_id", "empresa_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeApontamento_atividade_dia_turno_sequencia_key" ON "AtividadeApontamento"("cliente_id", "atividade_id", "data_operacional", "turno", "sequencia") NULLS NOT DISTINCT;

-- Listas fechadas e invariantes (CHECK nas tabelas NOVAS).
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_status_check" CHECK ("status" IN ('ABERTA', 'CONCLUIDA', 'CANCELADA'));
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_area_planejada_check" CHECK ("area_planejada" IS NULL OR "area_planejada" >= 0);
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_area_executada_check" CHECK ("area_executada" IS NULL OR "area_executada" >= 0);
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_quantidade_produzida_check" CHECK ("quantidade_produzida" IS NULL OR "quantidade_produzida" >= 0);
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_datas_check" CHECK ("data_prevista_fim" IS NULL OR "data_inicio" IS NULL OR "data_prevista_fim" >= "data_inicio");
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_conclusao_check" CHECK (("status" = 'CONCLUIDA') = ("concluida_em" IS NOT NULL));
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cancelamento_check" CHECK (("status" = 'CANCELADA') = ("cancelada_em" IS NOT NULL));
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_turno_check" CHECK ("turno" IS NULL OR "turno" IN ('MANHA', 'TARDE', 'NOITE'));
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_origem_check" CHECK ("origem" IN ('WEB', 'APP'));
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_status_check" CHECK ("status" IN ('CONFIRMADO', 'CANCELADO'));
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_sequencia_check" CHECK ("sequencia" >= 1);
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_area_executada_dia_check" CHECK ("area_executada_dia" IS NULL OR "area_executada_dia" >= 0);
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_quantidade_produzida_dia_check" CHECK ("quantidade_produzida_dia" IS NULL OR "quantidade_produzida_dia" >= 0);
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_cancelamento_check" CHECK (("status" = 'CANCELADO') = ("cancelado_em" IS NOT NULL));

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_tipo_atividade_id_fkey" FOREIGN KEY ("cliente_id", "tipo_atividade_id") REFERENCES "TipoAtividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_grupo_atividade_id_fkey" FOREIGN KEY ("cliente_id", "grupo_atividade_id") REFERENCES "GrupoAtividade"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_area_id_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_setor_id_fkey" FOREIGN KEY ("cliente_id", "setor_id") REFERENCES "Setor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_bem_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_centro_resultado_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_unidade_producao_id_fkey" FOREIGN KEY ("cliente_id", "unidade_producao_id") REFERENCES "UnidadeMedida"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cliente_id_lancamento_tarefa_id_fkey" FOREIGN KEY ("cliente_id", "lancamento_tarefa_id") REFERENCES "LancamentoTarefa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_concluida_por_fkey" FOREIGN KEY ("cliente_id", "concluida_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Atividade" ADD CONSTRAINT "Atividade_reaberta_por_fkey" FOREIGN KEY ("cliente_id", "reaberta_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_atividade_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id") REFERENCES "Atividade"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_operador_fkey" FOREIGN KEY ("cliente_id", "operador_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeApontamento" ADD CONSTRAINT "AtividadeApontamento_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['Atividade','AtividadeApontamento'];
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

-- CONVERSÃO (pinada): cada apontamento antigo vira uma atividade + um apontamento filho.
INSERT INTO "Atividade" ("id", "cliente_id", "empresa_id", "numero", "nome", "tipo_atividade_id", "tipo_atividade_nome",
    "grupo_atividade_id", "grupo_atividade_nome", "area_id", "setor_id", "setor_nome", "bem_id", "safra_ciclo",
    "centro_custo_id", "centro_resultado_id", "unidade_producao_id", "unidade_producao_sigla", "data_inicio",
    "area_executada", "quantidade_produzida", "lancamento_tarefa_id", "status", "cancelada_em",
    "cancelado_por_usuario_id", "motivo_cancelamento", "criado_por_usuario_id", "versao", "createdAt", "updatedAt")
SELECT 'atv_' || a."id", a."cliente_id", a."empresa_id", a."numero",
    left(a."tipo_atividade_nome" || ' (apontamento nº ' || a."numero" || ')', 120), a."tipo_atividade_id",
    a."tipo_atividade_nome", a."grupo_atividade_id", a."grupo_atividade_nome", a."area_id", ar."setor_id",
    ar."setor_nome", a."bem_id", a."safra_ciclo", a."centro_custo_id", a."centro_resultado_id", NULL,
    a."unidade_producao", a."data_operacional", NULL,
    CASE WHEN a."status" = 'CONFIRMADO' THEN a."quantidade_produzida" END, a."lancamento_tarefa_id",
    CASE WHEN a."status" = 'CANCELADO' THEN 'CANCELADA' ELSE 'ABERTA' END, a."cancelado_em",
    a."cancelado_por_usuario_id", a."motivo_cancelamento", a."criado_por_usuario_id", 1, a."createdAt", a."updatedAt"
  FROM "ApontamentoAtividade" AS a
  LEFT JOIN "AreaPastagem" AS ar ON ar."cliente_id" = a."cliente_id" AND ar."id" = a."area_id";

INSERT INTO "AtividadeApontamento" ("id", "cliente_id", "empresa_id", "atividade_id", "data_operacional", "turno",
    "sequencia", "operador_usuario_id", "area_executada_dia", "quantidade_produzida_dia", "observacao", "origem",
    "status", "cancelado_em", "cancelado_por_usuario_id", "motivo_cancelamento", "criado_por_usuario_id", "versao",
    "createdAt", "updatedAt")
SELECT a."id", a."cliente_id", a."empresa_id", 'atv_' || a."id", a."data_operacional", NULL, 1,
    a."operador_usuario_id", NULL, a."quantidade_produzida", a."observacao", 'WEB', a."status", a."cancelado_em",
    a."cancelado_por_usuario_id", a."motivo_cancelamento", a."criado_por_usuario_id", a."versao", a."createdAt",
    a."updatedAt"
  FROM "ApontamentoAtividade" AS a;

-- O número da atividade continua o contador do apontamento (as convertidas mantêm 1, 2, …).
UPDATE "EntidadeCodigoSequencia" SET "entidade" = 'Atividade', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "entidade" = 'ApontamentoAtividade';

-- DROP pinado das tabelas antigas (filhas primeiro; os itens estão vazios pela guarda).
DROP TABLE "ApontamentoAtividadeItemConsumoLote";

DROP TABLE "ApontamentoAtividadeItem";

DROP TABLE "ApontamentoAtividade";
