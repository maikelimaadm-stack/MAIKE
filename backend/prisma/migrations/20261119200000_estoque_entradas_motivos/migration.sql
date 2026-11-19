-- MAIKE-ESTOQUE-NOVO-MOVIMENTO — a Entrada do Estoque passa a ter o motivo de um CADASTRO
-- ("MotivoEntradaEstoque", por cliente), fornecedor, centro de custo e centro de resultado no
-- cabeçalho, e lote do fabricante e data de validade em cada produto. Decisão, relatório e
-- runbook em docs/engineering/ (MAIKE-ESTOQUE-NOVO-MOVIMENTO-*.md). O número da decisão fica
-- FORA deste arquivo de propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS). Troca o CHECK do
-- motivo (os 3 motivos fechados viram 2 naturezas: SALDO_IMPLANTACAO e ENTRADA; o nome do motivo
-- vem do cadastro), apaga o CHECK da justificativa, acrescenta colunas anuláveis e FKs compostas
-- para tabelas ANTIGAS. Só passa com as 3 tabelas das Entradas VAZIAS: nenhuma linha existente
-- precisa ser convertida. Nesta ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma migrate
--      (72707369), as tabelas existem e estão travadas em ACCESS EXCLUSIVE, estão VAZIAS, as
--      colunas e constraints novas não existem, a tabela nova não existe e os alvos das FKs
--      têm o UNIQUE que elas exigem;
--   2. as instruções pinadas em tabela antiga: os 2 CHECKs apagados, o CHECK novo do motivo,
--      as 5 colunas anuláveis sem DEFAULT, as 3 FKs compostas pelo tenant (centros: também
--      pela empresa), RESTRICT, e o CHECK "implantação não tem fornecedor";
--   3. o resto pela allowlist EXPAND: a tabela nova "MotivoEntradaEstoque" (índices, CHECKs,
--      FK do cliente e RLS de corpo já aprovado), a coluna "motivo_id" com a FK para ela e os
--      índices não-únicos das FKs, pelo cliente.
--
-- Os motivos padrão (Compra, Doação, Saldo de implantação) NÃO são semeados aqui: o serviço
-- os cria na primeira leitura de cada cliente (idempotente pelo UNIQUE da chave).
--
-- Reversão operacional (não executada em produção): com as tabelas ainda vazias, DROP das FKs,
-- dos índices, das colunas e da tabela nova, e os 2 CHECKs antigos recriados.

-- Guarda: falha fechada se o banco não estiver no estado que a fatia conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."EntradaEstoque"') IS NULL
     OR to_regclass('public."EntradaEstoqueItem"') IS NULL
     OR to_regclass('public."EntradaEstoqueEvento"') IS NULL
     OR to_regclass('public."Fornecedor"') IS NULL
     OR to_regclass('public."CentroCusto"') IS NULL
     OR to_regclass('public."CentroResultado"') IS NULL THEN
    RAISE EXCEPTION 'guarda: as tabelas das Entradas, "Fornecedor", "CentroCusto" e "CentroResultado" têm de existir';
  END IF;
  IF to_regclass('public."MotivoEntradaEstoque"') IS NOT NULL THEN
    RAISE EXCEPTION 'guarda: "MotivoEntradaEstoque" já existe: migration já aplicada ou schema fora do esperado';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND ((table_name = 'EntradaEstoque' AND column_name IN ('motivo_id', 'fornecedor_id', 'centro_custo_id', 'centro_resultado_id'))
                 OR (table_name = 'EntradaEstoqueItem' AND column_name IN ('lote_fabricante', 'data_validade')))) THEN
    RAISE EXCEPTION 'guarda: coluna nova já presente nas Entradas: migration já aplicada ou schema fora do esperado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."EntradaEstoque"') AND conname = 'EntradaEstoque_motivo_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."EntradaEstoque"') AND conname = 'EntradaEstoque_justificativa_check')
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."EntradaEstoque"')
                  AND conname IN ('EntradaEstoque_fornecedor_fkey', 'EntradaEstoque_centro_custo_fkey', 'EntradaEstoque_centro_resultado_fkey', 'EntradaEstoque_fornecedor_check')) THEN
    RAISE EXCEPTION 'guarda: os CHECKs das Entradas não são os esperados ou as constraints novas já existem';
  END IF;
  IF to_regclass('public."Fornecedor_cliente_id_id_key"') IS NULL
     OR to_regclass('public."CentroCusto_cliente_id_empresa_id_id_key"') IS NULL
     OR to_regclass('public."CentroResultado_cliente_id_empresa_id_id_key"') IS NULL THEN
    RAISE EXCEPTION 'guarda: falta o UNIQUE que as FKs compostas exigem em "Fornecedor", "CentroCusto" ou "CentroResultado"';
  END IF;
  -- Trava até o COMMIT: ninguém grava nas Entradas enquanto a regra do motivo muda.
  LOCK TABLE public."EntradaEstoque", public."EntradaEstoqueItem", public."EntradaEstoqueEvento" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."EntradaEstoque") OR EXISTS (SELECT 1 FROM public."EntradaEstoqueItem")
     OR EXISTS (SELECT 1 FROM public."EntradaEstoqueEvento") THEN
    RAISE EXCEPTION 'guarda: as Entradas do Estoque já têm lançamentos; esta migration só roda com as 3 tabelas vazias';
  END IF;
END $$;

-- AlterTable (os 3 motivos fechados viram 2 naturezas; a justificativa deixa de ser exigida pelo banco)
ALTER TABLE "EntradaEstoque" DROP CONSTRAINT "EntradaEstoque_justificativa_check";

ALTER TABLE "EntradaEstoque" DROP CONSTRAINT "EntradaEstoque_motivo_check";

ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_motivo_check" CHECK ("motivo" IN ('SALDO_IMPLANTACAO', 'ENTRADA'));

-- AlterTable (anuláveis, sem DEFAULT)
ALTER TABLE "EntradaEstoque" ADD COLUMN "fornecedor_id" VARCHAR(64);

ALTER TABLE "EntradaEstoque" ADD COLUMN "centro_custo_id" VARCHAR(64);

ALTER TABLE "EntradaEstoque" ADD COLUMN "centro_resultado_id" VARCHAR(64);

ALTER TABLE "EntradaEstoqueItem" ADD COLUMN "lote_fabricante" VARCHAR(64);

ALTER TABLE "EntradaEstoqueItem" ADD COLUMN "data_validade" DATE;

-- AddForeignKey (compostas pelo tenant; os centros também pela empresa: mesma fazenda por construção)
ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_fornecedor_fkey" FOREIGN KEY ("cliente_id", "fornecedor_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_centro_resultado_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK: o saldo de implantação não tem fornecedor
ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_fornecedor_check" CHECK ("motivo" <> 'SALDO_IMPLANTACAO' OR "fornecedor_id" IS NULL);

-- CreateTable (o cadastro de motivos de entrada, por cliente)
CREATE TABLE "MotivoEntradaEstoque" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "chave" VARCHAR(80) NOT NULL,
    "natureza" VARCHAR(24) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivoEntradaEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotivoEntradaEstoque_cliente_id_id_key" ON "MotivoEntradaEstoque"("cliente_id", "id");

-- CreateIndex (um nome por cliente, sem diferença de maiúsculas e espaços: a chave é o nome normalizado)
CREATE UNIQUE INDEX "MotivoEntradaEstoque_cliente_id_chave_key" ON "MotivoEntradaEstoque"("cliente_id", "chave");

-- CreateIndex
CREATE INDEX "MotivoEntradaEstoque_cliente_id_ativo_idx" ON "MotivoEntradaEstoque"("cliente_id", "ativo");

-- AddForeignKey
ALTER TABLE "MotivoEntradaEstoque" ADD CONSTRAINT "MotivoEntradaEstoque_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECKs (tabela nova)
ALTER TABLE "MotivoEntradaEstoque" ADD CONSTRAINT "MotivoEntradaEstoque_natureza_check" CHECK ("natureza" IN ('SALDO_IMPLANTACAO', 'ENTRADA'));

ALTER TABLE "MotivoEntradaEstoque" ADD CONSTRAINT "MotivoEntradaEstoque_nome_check" CHECK (char_length(btrim("nome")) >= 2 AND char_length(btrim("chave")) >= 2);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['MotivoEntradaEstoque'];
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

-- AlterTable (anulável, sem DEFAULT: as tabelas estão vazias; o serviço exige o motivo)
ALTER TABLE "EntradaEstoque" ADD COLUMN "motivo_id" VARCHAR(64);

-- AddForeignKey (para a tabela NOVA; RESTRICT: motivo usado não sai, só é desativado)
ALTER TABLE "EntradaEstoque" ADD CONSTRAINT "EntradaEstoque_motivo_id_fkey" FOREIGN KEY ("cliente_id", "motivo_id") REFERENCES "MotivoEntradaEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (índices não-únicos das FKs, pelo cliente)
CREATE INDEX "EntradaEstoque_cliente_id_motivo_id_idx" ON "EntradaEstoque"("cliente_id", "motivo_id");

CREATE INDEX "EntradaEstoque_cliente_id_fornecedor_id_idx" ON "EntradaEstoque"("cliente_id", "fornecedor_id");

CREATE INDEX "EntradaEstoque_cliente_id_empresa_id_centro_custo_id_idx" ON "EntradaEstoque"("cliente_id", "empresa_id", "centro_custo_id");

CREATE INDEX "EntradaEstoque_cliente_id_empresa_id_centro_resultado_id_idx" ON "EntradaEstoque"("cliente_id", "empresa_id", "centro_resultado_id");
