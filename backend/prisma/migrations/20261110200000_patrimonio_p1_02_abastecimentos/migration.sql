-- D-PROD-159 — MAIKE Patrimônio e Frota P1-02: abastecimento e consumo de
-- combustível da frota com baixa FÍSICA real pelo motor de estoque (KG, FIFO).
-- Três tabelas NOVAS: ConversaoCombustivelProduto (fator kg/L INFORMADO pelo
-- responsável, versionado, por empresa × tipo de combustível × produto),
-- AbastecimentoBem (fato em litros + KG convertido uma vez + snapshot do fator
-- + custo FIFO final + leitura do medidor + movimento de saída e de estorno) e
-- AbastecimentoBemConsumoLote (fatias FIFO por lote, para o estorno exato).
-- Sem manutenção, OS, compras, financeiro, custo/hora, depreciação apurada ou
-- transferência: nenhum lançamento financeiro é criado ou fingido.
--
-- EXPAND-ONLY (classificador `premergeMigrateLib.classificarMigrations`): só
-- CREATE TABLE / INDEX / FK / CHECK nas 3 tabelas NOVAS. Nenhuma tabela
-- existente é alterada (zero DDL em BemPatrimonial, MovimentacaoEstoque,
-- EstoqueLoteNota, Produto ou qualquer outra) e nenhum dado é migrado ou
-- semeado. As FKs para tabelas antigas são compostas por (cliente_id, …) e
-- RESTRICT: nada some em cascata; nenhuma tabela antiga referencia as novas.
--
-- Escopo garantido pelo banco: toda FK inclui cliente_id; o fator é do PAR do
-- vínculo R2 (FK para TipoCombustivelProduto_par_key) e o abastecimento usa um
-- fator do MESMO par (FK de 5 colunas para ConversaoCombustivelProduto_par_id_key);
-- a fatia FIFO é da MESMA empresa do abastecimento (FK (cliente_id, empresa_id,
-- abastecimento_id)); um vigente por par (`ativo_chave` true|NULL + unique); um
-- abastecimento por operation_id, por movimento e por estorno (uniques); KG =
-- round(litros × fator, 4) (CHECK; ROUND_HALF_UP, a mesma regra do serviço); a
-- leitura do medidor só existe com contador e origem 'ABASTECIMENTO' (CHECK) e
-- nunca é gravada em BemPatrimonial. Como BemPatrimonial, TanqueBem e Produto
-- não têm unique (cliente_id, empresa_id|bem_id, id) e não são alterados aqui,
-- a coerência bem/tanque/empresa/produto é invariante do serviço, revalidada
-- sob trava na confirmação.
--
-- Reversão operacional (não executada em produção): as 3 tabelas são novas e
-- nenhuma tabela antiga as referencia; removê-las (filhas antes das mães:
-- AbastecimentoBemConsumoLote, AbastecimentoBem, ConversaoCombustivelProduto)
-- não afeta dados existentes enquanto estiverem vazias.

CREATE TABLE "ConversaoCombustivelProduto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "tipo_combustivel_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "kg_por_litro" DECIMAL(10,6) NOT NULL,
    "declara_estoque_em_kg" BOOLEAN NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ativo_chave" BOOLEAN,
    "encerrado_em" TIMESTAMP(3),
    "criado_por_usuario_id" VARCHAR(64),
    "encerrado_por_usuario_id" VARCHAR(64),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversaoCombustivelProduto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AbastecimentoBem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "bem_id" VARCHAR(64) NOT NULL,
    "tanque_id" VARCHAR(64) NOT NULL,
    "tipo_combustivel_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "conversao_id" VARCHAR(64) NOT NULL,
    "data_operacional" DATE NOT NULL,
    "quantidade_litros" DECIMAL(14,4) NOT NULL,
    "kg_por_litro" DECIMAL(10,6) NOT NULL,
    "quantidade_kg" DECIMAL(14,4) NOT NULL,
    "custo_total" DECIMAL(14,4) NOT NULL,
    "custo_unitario_kg" DECIMAL(14,4) NOT NULL,
    "tanque_cheio" BOOLEAN NOT NULL DEFAULT false,
    "medidor_tipo" VARCHAR(16) NOT NULL,
    "medidor_unidade" VARCHAR(8),
    "medidor_leitura" DECIMAL(14,4),
    "medidor_origem" VARCHAR(24),
    "observacao" VARCHAR(500),
    "referencia_externa" VARCHAR(64),
    "operation_id" VARCHAR(128) NOT NULL,
    "movimentacao_estoque_id" VARCHAR(64) NOT NULL,
    "movimentacao_estorno_id" VARCHAR(64),
    "criado_por_usuario_id" VARCHAR(64),
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbastecimentoBem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AbastecimentoBemConsumoLote" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "abastecimento_id" VARCHAR(64) NOT NULL,
    "estoque_lote_nota_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbastecimentoBemConsumoLote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversaoCombustivelProduto_empresa_keyset_idx" ON "ConversaoCombustivelProduto"("cliente_id", "empresa_id", "createdAt", "id");

CREATE INDEX "ConversaoCombustivelProduto_cliente_id_produto_id_idx" ON "ConversaoCombustivelProduto"("cliente_id", "produto_id");

CREATE UNIQUE INDEX "ConversaoCombustivelProduto_cliente_id_id_key" ON "ConversaoCombustivelProduto"("cliente_id", "id");

CREATE UNIQUE INDEX "ConversaoCombustivelProduto_par_id_key" ON "ConversaoCombustivelProduto"("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id", "id");

CREATE UNIQUE INDEX "ConversaoCombustivelProduto_par_sequencia_key" ON "ConversaoCombustivelProduto"("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id", "sequencia");

CREATE UNIQUE INDEX "ConversaoCombustivelProduto_par_vigente_key" ON "ConversaoCombustivelProduto"("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id", "ativo_chave");

CREATE INDEX "AbastecimentoBem_cliente_id_empresa_id_createdAt_id_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "createdAt", "id");

CREATE INDEX "AbastecimentoBem_empresa_bem_keyset_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "bem_id", "createdAt", "id");

CREATE INDEX "AbastecimentoBem_bem_status_data_idx" ON "AbastecimentoBem"("cliente_id", "bem_id", "status", "data_operacional");

CREATE INDEX "AbastecimentoBem_tanque_status_data_idx" ON "AbastecimentoBem"("cliente_id", "tanque_id", "status", "data_operacional");

CREATE INDEX "AbastecimentoBem_cliente_id_empresa_id_produto_id_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "produto_id");

CREATE INDEX "AbastecimentoBem_cliente_id_local_estoque_id_idx" ON "AbastecimentoBem"("cliente_id", "local_estoque_id");

CREATE UNIQUE INDEX "AbastecimentoBem_cliente_id_id_key" ON "AbastecimentoBem"("cliente_id", "id");

CREATE UNIQUE INDEX "AbastecimentoBem_cliente_id_empresa_id_id_key" ON "AbastecimentoBem"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "AbastecimentoBem_cliente_id_numero_key" ON "AbastecimentoBem"("cliente_id", "numero");

CREATE UNIQUE INDEX "AbastecimentoBem_cliente_id_operation_id_key" ON "AbastecimentoBem"("cliente_id", "operation_id");

CREATE UNIQUE INDEX "AbastecimentoBem_cliente_id_movimentacao_estoque_id_key" ON "AbastecimentoBem"("cliente_id", "movimentacao_estoque_id");

CREATE UNIQUE INDEX "AbastecimentoBem_cliente_id_movimentacao_estorno_id_key" ON "AbastecimentoBem"("cliente_id", "movimentacao_estorno_id");

CREATE INDEX "AbastecimentoBemConsumoLote_lote_idx" ON "AbastecimentoBemConsumoLote"("cliente_id", "estoque_lote_nota_id");

CREATE UNIQUE INDEX "AbastecimentoBemConsumoLote_cliente_id_id_key" ON "AbastecimentoBemConsumoLote"("cliente_id", "id");

CREATE UNIQUE INDEX "AbastecimentoBemConsumoLote_abastecimento_lote_key" ON "AbastecimentoBemConsumoLote"("cliente_id", "abastecimento_id", "estoque_lote_nota_id");

CREATE UNIQUE INDEX "AbastecimentoBemConsumoLote_abastecimento_ordem_key" ON "AbastecimentoBemConsumoLote"("cliente_id", "abastecimento_id", "ordem");

ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_vinculo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id") REFERENCES "TipoCombustivelProduto"("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_encerrado_por_fkey" FOREIGN KEY ("cliente_id", "encerrado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_bem_id_fkey" FOREIGN KEY ("cliente_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_tanque_id_fkey" FOREIGN KEY ("cliente_id", "tanque_id") REFERENCES "TanqueBem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_local_estoque_id_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_conversao_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id", "conversao_id") REFERENCES "ConversaoCombustivelProduto"("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_movimentacao_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBemConsumoLote" ADD CONSTRAINT "AbastecimentoBemConsumoLote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBemConsumoLote" ADD CONSTRAINT "AbastecimentoBemConsumoLote_abastecimento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "abastecimento_id") REFERENCES "AbastecimentoBem"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBemConsumoLote" ADD CONSTRAINT "AbastecimentoBemConsumoLote_lote_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domínios fechados e invariantes (CHECK escrito à mão; NULL-safe: cada ramo
-- com IS NOT NULL explícito; nomes ≤ 63 bytes; nenhum ponto e vírgula dentro).
ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_fator_check" CHECK ("kg_por_litro" > 0 AND "kg_por_litro" <= 10);
ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_declaracao_check" CHECK ("declara_estoque_em_kg" = true);
ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_vigencia_check" CHECK (("ativo" AND "ativo_chave" IS TRUE AND "encerrado_em" IS NULL AND "encerrado_por_usuario_id" IS NULL) OR (NOT "ativo" AND "ativo_chave" IS NULL AND "encerrado_em" IS NOT NULL));
ALTER TABLE "ConversaoCombustivelProduto" ADD CONSTRAINT "ConversaoCombustivelProduto_valores_check" CHECK ("sequencia" >= 1 AND "versao" >= 1);

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_status_check" CHECK (("status" = 'CONFIRMADO' AND "movimentacao_estorno_id" IS NULL AND "cancelado_em" IS NULL AND "cancelado_por_usuario_id" IS NULL AND "motivo_cancelamento" IS NULL) OR ("status" = 'CANCELADO' AND "movimentacao_estorno_id" IS NOT NULL AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND char_length(btrim("motivo_cancelamento")) >= 3));
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_quantidades_check" CHECK ("quantidade_litros" > 0 AND "kg_por_litro" > 0 AND "kg_por_litro" <= 10 AND "quantidade_kg" > 0);
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_conversao_kg_check" CHECK ("quantidade_kg" = round("quantidade_litros" * "kg_por_litro", 4));
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_custos_check" CHECK ("custo_total" >= 0 AND "custo_unitario_kg" >= 0);
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_medidor_check" CHECK (("medidor_tipo" = 'SEM_MEDIDOR' AND "medidor_unidade" IS NULL AND "medidor_leitura" IS NULL AND "medidor_origem" IS NULL) OR ("medidor_tipo" IN ('HORIMETRO', 'ODOMETRO', 'CICLOS') AND "medidor_unidade" IS NOT NULL AND "medidor_leitura" IS NOT NULL AND "medidor_origem" IS NOT NULL AND "medidor_origem" = 'ABASTECIMENTO' AND "medidor_leitura" >= 0 AND (("medidor_tipo" = 'HORIMETRO' AND "medidor_unidade" = 'h') OR ("medidor_tipo" = 'ODOMETRO' AND "medidor_unidade" = 'km') OR ("medidor_tipo" = 'CICLOS' AND "medidor_unidade" = 'ciclos'))));
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_textos_check" CHECK (("observacao" IS NULL OR char_length(btrim("observacao")) > 0) AND ("referencia_externa" IS NULL OR char_length(btrim("referencia_externa")) > 0) AND "operation_id" ~ '^[A-Za-z0-9_.:-]{8,128}$');
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_movimentos_check" CHECK ("movimentacao_estorno_id" IS NULL OR "movimentacao_estorno_id" <> "movimentacao_estoque_id");
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_versao_check" CHECK ("versao" >= 1);

ALTER TABLE "AbastecimentoBemConsumoLote" ADD CONSTRAINT "AbastecimentoBemConsumoLote_valores_check" CHECK ("quantidade" > 0 AND "custo_unitario" >= 0 AND "ordem" >= 1);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['AbastecimentoBem','AbastecimentoBemConsumoLote','ConversaoCombustivelProduto'];
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
