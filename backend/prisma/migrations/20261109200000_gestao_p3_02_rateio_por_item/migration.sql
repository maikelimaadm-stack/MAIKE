-- D-PROD-156 — MAIKE Gestão P3-02: rateio gerencial POR ITEM.
-- No lançamento COM_PRODUTOS, cada item (MERCADORIA ou SERVICO) pode ter a sua
-- própria divisão em natureza + centro de custo + centro de resultado, sobre o
-- valor LÍQUIDO do item (subtotal − desconto rateado + acréscimo rateado). Os
-- modos são exclusivos: o documento usa o rateio GERAL (P3-01) OU o rateio por
-- item, nunca os dois. É classificação gerencial: não cria título, movimento,
-- lote nem custo, e não mexe no estoque nem no FIFO.
--
-- EXPAND-ONLY (classificador `premergeMigrateLib.classificarMigrations`):
--  - "OperacaoFinanceira"."rateio_escopo": coluna NOVA anulável, sem DEFAULT e
--    sem NOT NULL. NULL = documento anterior à P3-02, lido como GERAL; o serviço
--    grava sempre 'GERAL' ou 'POR_ITEM' em POST/PUT. O domínio é conferido no
--    serviço (CHECK em tabela antiga não é expand).
--  - "OperacaoFinanceiraItemRateio": tabela NOVA, com CHECK/UNIQUE/índices/FKs
--    só nela. As FKs para tabelas antigas são compostas por (cliente_id, …) e
--    RESTRICT: nada some em cascata. Os alvos das FKs já têm unique.
--
-- Escopo garantido pelo banco: toda FK inclui cliente_id; a linha herda a
-- empresa do documento e do item pelas FKs compostas (cliente_id, empresa_id,
-- …); a FK com a direção do documento + a FK com o tipo da natureza + o CHECK
-- amarram PAGAR→DESPESA e RECEBER→RECEITA (como no rateio geral).
--
-- Reversão operacional (não executada em produção): a tabela nova não é
-- referenciada por nenhuma outra; removê-la e depois a coluna anulável não afeta
-- os dados da P3-01 (documentos POR_ITEM perderiam só a classificação gerencial).

ALTER TABLE "OperacaoFinanceira" ADD COLUMN "rateio_escopo" VARCHAR(12);

CREATE TABLE "OperacaoFinanceiraItemRateio" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "operacao_id" VARCHAR(64) NOT NULL,
    "operacao_direcao" VARCHAR(8) NOT NULL,
    "item_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "natureza_id" VARCHAR(64) NOT NULL,
    "natureza_tipo" VARCHAR(10) NOT NULL,
    "natureza_nome" VARCHAR(120) NOT NULL,
    "centro_custo_id" VARCHAR(64),
    "centro_custo_nome" VARCHAR(120),
    "centro_resultado_id" VARCHAR(64),
    "centro_resultado_nome" VARCHAR(120),
    "percentual" DECIMAL(9,6),
    "valor" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperacaoFinanceiraItemRateio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperacaoFinanceiraItemRateio_operacao_idx" ON "OperacaoFinanceiraItemRateio"("cliente_id", "empresa_id", "operacao_id");

CREATE INDEX "OperacaoFinanceiraItemRateio_item_idx" ON "OperacaoFinanceiraItemRateio"("cliente_id", "empresa_id", "item_id");

CREATE INDEX "OperacaoFinanceiraItemRateio_natureza_idx" ON "OperacaoFinanceiraItemRateio"("cliente_id", "empresa_id", "natureza_id");

CREATE UNIQUE INDEX "OperacaoFinanceiraItemRateio_cliente_id_id_key" ON "OperacaoFinanceiraItemRateio"("cliente_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceiraItemRateio_cliente_id_item_id_ordem_key" ON "OperacaoFinanceiraItemRateio"("cliente_id", "item_id", "ordem");

ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_operacao_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "operacao_id", "operacao_direcao") REFERENCES "OperacaoFinanceira"("cliente_id", "empresa_id", "id", "direcao") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_item_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "item_id") REFERENCES "OperacaoFinanceiraItem"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_natureza_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "natureza_tipo", "natureza_id") REFERENCES "NaturezaFinanceira"("cliente_id", "empresa_id", "tipo", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_centro_custo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_centro_resultado_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domínios fechados por CHECK (sem enum Prisma), como no rateio geral.
ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_tipo_direcao_check" CHECK (("operacao_direcao" = 'PAGAR' AND "natureza_tipo" = 'DESPESA') OR ("operacao_direcao" = 'RECEBER' AND "natureza_tipo" = 'RECEITA'));
ALTER TABLE "OperacaoFinanceiraItemRateio" ADD CONSTRAINT "OperacaoFinanceiraItemRateio_valores_check" CHECK ("valor" > 0 AND "ordem" >= 1 AND ("percentual" IS NULL OR ("percentual" > 0 AND "percentual" <= 100)));

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
-- Só a tabela NOVA (a coluna nova herda a RLS/grants da tabela da P3-01).
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['OperacaoFinanceiraItemRateio'];
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
