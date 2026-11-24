-- MAIKE-PRODUTO-UNIDADES-CONVERSAO — unidades de conversão no cadastro do produto. O produto continua com
-- UMA unidade de estoque (KG ou L; o SACO legado guarda kg) e ganha a tabela "ProdutoUnidadeConversao": a
-- sigla digitada nos lançamentos ("SACO", "SC 25", "GL 20", "G"), a operação (MULTIPLICA: 1 sigla = fator
-- unidades de estoque; DIVIDE: 1 sigla = 1/fator), o fator, o uso (compra/entrada e venda/saída), o código
-- de barras opcional, ativa/inativa e a exclusão lógica ("excluido_em"). As linhas de lançamento que já
-- guardam "unidade" e "fator_kg" (entrada documentada, saída manual, ajuste e item do financeiro) passam a
-- aceitar a sigla de uma conversão: os CHECKs que só aceitavam KG/SACO/L são recriados mais largos.
-- A Formulação ganha o consumo mínimo e máximo (%PV), que saem da tela do produto, com os valores copiados
-- do produto que vai ao cocho. Decisão, especificação e runbook em docs/engineering/
-- (MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md). O número da decisão fica FORA deste arquivo de propósito.
--
-- CONTRACT condicionado, formato CONVERSÃO sem DROP (como a D-PROD-249). Nenhuma coluna é apagada,
-- nenhuma linha existente muda de valor fora da cópia abaixo. Nesta ordem:
--   1. guarda (falha fechada): lock_timeout 5s e statement_timeout 120s locais, a trava consultiva do
--      prisma migrate (72707369), o estado esperado (as 6 tabelas existem; a tabela e as colunas novas
--      não; os 5 CHECKs antigos existem) e as 6 tabelas travadas em ACCESS EXCLUSIVE até o COMMIT;
--   2. as instruções pinadas em tabela antiga: os 5 CHECKs de unidade recriados (a unidade é texto não
--      vazio; na mercadoria do financeiro, qualquer unidade menos UN, que é do serviço);
--   3. o resto, pela allowlist EXPAND: a tabela nova, índices (o único parcial só entre as não excluídas),
--      CHECKs, FKs, RLS e as 2 colunas anuláveis da Formulação;
--   4. a cópia pinada: cada produto com "peso_por_saco_kg" > 0 (que não seja de litros) ganha a conversão
--      SACO multiplica pelo peso; cada formulação recebe o consumo mínimo/máximo do produto dela.
--
-- Reversão operacional (não executada em produção): DROP da tabela nova e das 2 colunas da Formulação e
-- os 5 CHECKs de volta ao texto anterior (só se nenhuma linha usar sigla de conversão).

-- Guarda: falha fechada se o banco não estiver no estado que a fatia conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."Produto"') IS NULL OR to_regclass('public."CADFORMULACAO"') IS NULL
     OR to_regclass('public."EntradaEstoqueItem"') IS NULL OR to_regclass('public."SaidaEstoqueItem"') IS NULL
     OR to_regclass('public."AjusteEstoqueItem"') IS NULL OR to_regclass('public."OperacaoFinanceiraItem"') IS NULL THEN
    RAISE EXCEPTION 'guarda: as 6 tabelas (produto, formulação, entrada, saída, ajuste e item do financeiro) têm de existir';
  END IF;
  IF to_regclass('public."ProdutoUnidadeConversao"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                  AND table_name = 'CADFORMULACAO' AND column_name IN ('consumo_minimo_pv', 'consumo_maximo_pv')) THEN
    RAISE EXCEPTION 'guarda: as unidades de conversão já estão no banco (tabela ou colunas novas presentes)';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype = 'c' AND conname IN (
        'EntradaEstoqueItem_unidade_check', 'SaidaEstoqueItem_unidade_check', 'AjusteEstoqueItem_unidade_check',
        'OperacaoFinanceiraItem_unidade_check', 'OperacaoFinanceiraItem_forma_check')) <> 5 THEN
    RAISE EXCEPTION 'guarda: os 5 CHECKs de unidade que esta migration recria têm de existir';
  END IF;
  -- Trava até o COMMIT: ninguém grava produto, formulação nem lançamento enquanto a conversão entra.
  LOCK TABLE public."Produto" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."CADFORMULACAO" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."EntradaEstoqueItem" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."SaidaEstoqueItem" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."AjusteEstoqueItem" IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public."OperacaoFinanceiraItem" IN ACCESS EXCLUSIVE MODE;
END $$;

-- Os CHECKs de unidade, mais largos (a sigla de uma conversão do produto também vale)
ALTER TABLE "EntradaEstoqueItem" DROP CONSTRAINT "EntradaEstoqueItem_unidade_check";
ALTER TABLE "EntradaEstoqueItem" ADD CONSTRAINT "EntradaEstoqueItem_unidade_check" CHECK (char_length(btrim("unidade")) > 0 AND "unidade" <> 'UN');
ALTER TABLE "SaidaEstoqueItem" DROP CONSTRAINT "SaidaEstoqueItem_unidade_check";
ALTER TABLE "SaidaEstoqueItem" ADD CONSTRAINT "SaidaEstoqueItem_unidade_check" CHECK (char_length(btrim("unidade")) > 0 AND "unidade" <> 'UN');
ALTER TABLE "AjusteEstoqueItem" DROP CONSTRAINT "AjusteEstoqueItem_unidade_check";
ALTER TABLE "AjusteEstoqueItem" ADD CONSTRAINT "AjusteEstoqueItem_unidade_check" CHECK (char_length(btrim("unidade")) > 0 AND "unidade" <> 'UN');
ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_unidade_check";
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_unidade_check" CHECK (char_length(btrim("unidade")) > 0);
ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_forma_check";
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_forma_check" CHECK (("tipo_item" = 'MERCADORIA' AND "produto_id" IS NOT NULL AND "local_estoque_id" IS NOT NULL AND "unidade" <> 'UN' AND "fator_kg" IS NOT NULL AND "fator_kg" > 0 AND "quantidade_estoque" IS NOT NULL AND "quantidade_estoque" > 0) OR ("tipo_item" = 'SERVICO' AND "produto_id" IS NULL AND "local_estoque_id" IS NULL AND "descricao" IS NOT NULL AND "unidade" = 'UN' AND "fator_kg" IS NULL AND "quantidade_estoque" IS NULL AND "movimentacao_estoque_id" IS NULL AND "estoque_lote_nota_id" IS NULL AND "movimentacao_estorno_id" IS NULL));

-- CreateTable
CREATE TABLE "ProdutoUnidadeConversao" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "sigla" VARCHAR(8) NOT NULL,
    "operacao" VARCHAR(12) NOT NULL,
    "fator" DECIMAL(14,6) NOT NULL,
    "uso_compra" BOOLEAN NOT NULL DEFAULT true,
    "uso_venda" BOOLEAN NOT NULL DEFAULT true,
    "codigo_barras" VARCHAR(64),
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "excluido_em" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProdutoUnidadeConversao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (tenant-first; a sigla é única por produto só entre as NÃO excluídas)
CREATE UNIQUE INDEX "ProdutoUnidadeConversao_cliente_id_id_key" ON "ProdutoUnidadeConversao"("cliente_id", "id");
CREATE UNIQUE INDEX "ProdutoUnidadeConversao_sigla_key" ON "ProdutoUnidadeConversao"("cliente_id", "produto_id", "sigla") WHERE "excluido_em" IS NULL;
CREATE INDEX "ProdutoUnidadeConversao_cliente_id_produto_id_idx" ON "ProdutoUnidadeConversao"("cliente_id", "produto_id");

-- AddForeignKey
ALTER TABLE "ProdutoUnidadeConversao" ADD CONSTRAINT "ProdutoUnidadeConversao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProdutoUnidadeConversao" ADD CONSTRAINT "ProdutoUnidadeConversao_produto_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheck
ALTER TABLE "ProdutoUnidadeConversao" ADD CONSTRAINT "ProdutoUnidadeConversao_operacao_check" CHECK ("operacao" IN ('MULTIPLICA', 'DIVIDE') AND "fator" > 0 AND ("operacao" = 'MULTIPLICA' OR "fator" <= 10000));
ALTER TABLE "ProdutoUnidadeConversao" ADD CONSTRAINT "ProdutoUnidadeConversao_sigla_check" CHECK (char_length("sigla") > 0 AND "sigla" = upper(btrim("sigla")) AND "sigla" NOT IN ('KG', 'L', 'UN'));
ALTER TABLE "ProdutoUnidadeConversao" ADD CONSTRAINT "ProdutoUnidadeConversao_uso_check" CHECK ("uso_compra" OR "uso_venda");
ALTER TABLE "ProdutoUnidadeConversao" ADD CONSTRAINT "ProdutoUnidadeConversao_ordem_check" CHECK ("ordem" >= 0);

-- AlterTable (anuláveis, sem DEFAULT: o consumo mínimo e máximo do cocho passa a ser da formulação)
ALTER TABLE "CADFORMULACAO" ADD COLUMN "consumo_minimo_pv" DECIMAL(14,6);
ALTER TABLE "CADFORMULACAO" ADD COLUMN "consumo_maximo_pv" DECIMAL(14,6);

-- RLS da tabela nova (o mesmo corpo de sempre)
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['ProdutoUnidadeConversao'];
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

-- Cópia (o único DML): o peso por saco vira a conversão SACO multiplica pelo peso
INSERT INTO "ProdutoUnidadeConversao" ("id", "cliente_id", "produto_id", "sigla", "operacao", "fator", "uso_compra", "uso_venda", "ativa", "ordem", "createdAt", "updatedAt") SELECT 'puc_' || p."id", p."cliente_id", p."id", 'SACO', 'MULTIPLICA', p."peso_por_saco_kg", true, true, true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Produto" AS p WHERE p."peso_por_saco_kg" IS NOT NULL AND p."peso_por_saco_kg" > 0 AND p."unidade_principal_estoque" <> 'L';

-- Cópia: o consumo mínimo e máximo (%PV) do produto vai para a formulação que o leva ao cocho
UPDATE "CADFORMULACAO" AS f SET "consumo_minimo_pv" = p."consumo_minimo_pv", "consumo_maximo_pv" = p."consumo_maximo_pv" FROM "Produto" AS p WHERE p."cliente_id" = f."cliente_id" AND p."id" = f."produto_id" AND (p."consumo_minimo_pv" IS NOT NULL OR p."consumo_maximo_pv" IS NOT NULL);
