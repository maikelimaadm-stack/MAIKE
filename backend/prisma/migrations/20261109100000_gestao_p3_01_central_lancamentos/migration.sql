-- D-PROD-154 — MAIKE Gestão P3-01: Central Única de Lançamentos GERENCIAIS.
-- Um documento (OperacaoFinanceira) PAGAR|RECEBER × COM_PRODUTOS|SEM_PRODUTOS ×
-- AVISTA|PRAZO|PARCELADO, com itens, rateio GLOBAL (natureza + centros), títulos
-- (uma linha por parcela), liquidações MANUAIS e o estorno de liquidação em
-- tabela própria (sem autorreferência). Sem conciliação, OFX, DRE, plano de
-- contas, fiscal, tributos, câmbio ou contabilidade.
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK nas 8 tabelas NOVAS. Nenhuma
-- tabela existente é alterada e nenhum dado é migrado. As FKs para tabelas
-- antigas são compostas por (cliente_id, …) e RESTRICT: nada some em cascata.
--
-- Escopo garantido pelo banco: toda FK inclui cliente_id; itens, rateios e
-- títulos herdam a empresa do documento pela FK composta (cliente_id,
-- empresa_id, operacao_id); o rateio amarra a direção do documento ao tipo da
-- natureza (FK com direção + FK com tipo + CHECK PAGAR→DESPESA/RECEBER→RECEITA);
-- o estorno aponta para a liquidação do MESMO título.
--
-- Reversão operacional (não executada em produção): as 8 tabelas são novas e
-- nenhuma tabela antiga as referencia; removê-las (filhas antes das mães) não
-- afeta dados existentes. Movimentos/lotes de estoque já gerados por
-- lançamentos confirmados permanecem (são fatos do estoque).

CREATE TABLE "PerfilFinanceiroEmpresa" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "pais" VARCHAR(2) NOT NULL,
    "moeda" VARCHAR(3) NOT NULL,
    "locale" VARCHAR(35) NOT NULL,
    "versao_contrato" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilFinanceiroEmpresa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperacaoFinanceira" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "direcao" VARCHAR(8) NOT NULL,
    "conteudo" VARCHAR(16) NOT NULL,
    "condicao" VARCHAR(12) NOT NULL,
    "parceiro_id" VARCHAR(64) NOT NULL,
    "parceiro_nome" VARCHAR(255) NOT NULL,
    "descricao" VARCHAR(500),
    "documento_referencia" VARCHAR(64),
    "documento_chave_ativa" VARCHAR(64),
    "data_emissao" DATE NOT NULL,
    "data_operacional" DATE,
    "moeda" VARCHAR(3) NOT NULL,
    "moeda_casas" INTEGER NOT NULL,
    "valor_bruto" DECIMAL(18,4) NOT NULL,
    "valor_desconto" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "valor_acrescimo" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "valor_total" DECIMAL(18,4) NOT NULL,
    "rateio_modo" VARCHAR(12) NOT NULL,
    "metodo_preferido" VARCHAR(16),
    "versao" INTEGER NOT NULL DEFAULT 1,
    "versao_contrato" INTEGER NOT NULL DEFAULT 1,
    "criado_por_usuario_id" VARCHAR(64),
    "confirmado_por_usuario_id" VARCHAR(64),
    "confirmado_em" TIMESTAMP(3),
    "cancelado_por_usuario_id" VARCHAR(64),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperacaoFinanceira_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperacaoFinanceiraItem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "operacao_id" VARCHAR(64) NOT NULL,
    "ordem" INTEGER NOT NULL,
    "tipo_item" VARCHAR(12) NOT NULL,
    "produto_id" VARCHAR(64),
    "produto_nome" VARCHAR(255),
    "descricao" VARCHAR(255),
    "local_estoque_id" VARCHAR(64),
    "local_estoque_nome" VARCHAR(255),
    "unidade" VARCHAR(8) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "fator_kg" DECIMAL(14,4),
    "quantidade_estoque" DECIMAL(14,4),
    "valor_unitario" DECIMAL(18,6) NOT NULL,
    "valor_total" DECIMAL(18,4) NOT NULL,
    "movimentacao_estoque_id" VARCHAR(64),
    "estoque_lote_nota_id" VARCHAR(64),
    "movimentacao_estorno_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperacaoFinanceiraItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperacaoFinanceiraConsumoLote" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "item_id" VARCHAR(64) NOT NULL,
    "estoque_lote_nota_id" VARCHAR(64) NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperacaoFinanceiraConsumoLote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperacaoFinanceiraRateio" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "operacao_id" VARCHAR(64) NOT NULL,
    "operacao_direcao" VARCHAR(8) NOT NULL,
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

    CONSTRAINT "OperacaoFinanceiraRateio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TituloFinanceiro" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "operacao_id" VARCHAR(64) NOT NULL,
    "direcao" VARCHAR(8) NOT NULL,
    "parceiro_id" VARCHAR(64) NOT NULL,
    "numero_parcela" INTEGER NOT NULL,
    "total_parcelas" INTEGER NOT NULL,
    "vencimento" DATE NOT NULL,
    "moeda" VARCHAR(3) NOT NULL,
    "valor" DECIMAL(18,4) NOT NULL,
    "valor_liquidado" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" VARCHAR(12) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TituloFinanceiro_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiquidacaoFinanceira" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "titulo_id" VARCHAR(64) NOT NULL,
    "valor" DECIMAL(18,4) NOT NULL,
    "data" DATE NOT NULL,
    "metodo" VARCHAR(16) NOT NULL,
    "referencia" VARCHAR(120),
    "observacao" VARCHAR(500),
    "registrado_por_usuario_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiquidacaoFinanceira_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiquidacaoFinanceiraEstorno" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "titulo_id" VARCHAR(64) NOT NULL,
    "liquidacao_id" VARCHAR(64) NOT NULL,
    "data" DATE NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "registrado_por_usuario_id" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiquidacaoFinanceiraEstorno_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PerfilFinanceiroEmpresa_cliente_id_id_key" ON "PerfilFinanceiroEmpresa"("cliente_id", "id");

CREATE UNIQUE INDEX "PerfilFinanceiroEmpresa_cliente_id_empresa_id_key" ON "PerfilFinanceiroEmpresa"("cliente_id", "empresa_id");

CREATE INDEX "OperacaoFinanceira_cliente_id_empresa_id_createdAt_id_idx" ON "OperacaoFinanceira"("cliente_id", "empresa_id", "createdAt", "id");

CREATE INDEX "OperacaoFinanceira_cliente_id_empresa_id_status_createdAt_i_idx" ON "OperacaoFinanceira"("cliente_id", "empresa_id", "status", "createdAt", "id");

CREATE INDEX "OperacaoFinanceira_cliente_id_parceiro_id_idx" ON "OperacaoFinanceira"("cliente_id", "parceiro_id");

CREATE UNIQUE INDEX "OperacaoFinanceira_cliente_id_id_key" ON "OperacaoFinanceira"("cliente_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceira_cliente_id_empresa_id_id_key" ON "OperacaoFinanceira"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceira_cliente_id_empresa_id_id_direcao_key" ON "OperacaoFinanceira"("cliente_id", "empresa_id", "id", "direcao");

CREATE UNIQUE INDEX "OperacaoFinanceira_cliente_id_numero_key" ON "OperacaoFinanceira"("cliente_id", "numero");

CREATE UNIQUE INDEX "OperacaoFinanceira_cliente_id_empresa_id_direcao_parceiro_i_key" ON "OperacaoFinanceira"("cliente_id", "empresa_id", "direcao", "parceiro_id", "documento_chave_ativa");

CREATE INDEX "OperacaoFinanceiraItem_cliente_id_empresa_id_operacao_id_idx" ON "OperacaoFinanceiraItem"("cliente_id", "empresa_id", "operacao_id");

CREATE INDEX "OperacaoFinanceiraItem_cliente_id_produto_id_idx" ON "OperacaoFinanceiraItem"("cliente_id", "produto_id");

CREATE INDEX "OperacaoFinanceiraItem_cliente_id_local_estoque_id_idx" ON "OperacaoFinanceiraItem"("cliente_id", "local_estoque_id");

CREATE UNIQUE INDEX "OperacaoFinanceiraItem_cliente_id_id_key" ON "OperacaoFinanceiraItem"("cliente_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceiraItem_cliente_id_empresa_id_id_key" ON "OperacaoFinanceiraItem"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceiraItem_cliente_id_operacao_id_ordem_key" ON "OperacaoFinanceiraItem"("cliente_id", "operacao_id", "ordem");

CREATE UNIQUE INDEX "OperacaoFinanceiraItem_cliente_id_movimentacao_estoque_id_key" ON "OperacaoFinanceiraItem"("cliente_id", "movimentacao_estoque_id");

CREATE UNIQUE INDEX "OperacaoFinanceiraItem_cliente_id_movimentacao_estorno_id_key" ON "OperacaoFinanceiraItem"("cliente_id", "movimentacao_estorno_id");

CREATE UNIQUE INDEX "OperacaoFinanceiraItem_cliente_id_estoque_lote_nota_id_key" ON "OperacaoFinanceiraItem"("cliente_id", "estoque_lote_nota_id");

CREATE INDEX "OperacaoFinanceiraConsumoLote_cliente_id_estoque_lote_nota__idx" ON "OperacaoFinanceiraConsumoLote"("cliente_id", "estoque_lote_nota_id");

CREATE UNIQUE INDEX "OperacaoFinanceiraConsumoLote_cliente_id_id_key" ON "OperacaoFinanceiraConsumoLote"("cliente_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceiraConsumoLote_cliente_id_item_id_estoque_lo_key" ON "OperacaoFinanceiraConsumoLote"("cliente_id", "item_id", "estoque_lote_nota_id");

CREATE INDEX "OperacaoFinanceiraRateio_cliente_id_empresa_id_natureza_id_idx" ON "OperacaoFinanceiraRateio"("cliente_id", "empresa_id", "natureza_id");

CREATE UNIQUE INDEX "OperacaoFinanceiraRateio_cliente_id_id_key" ON "OperacaoFinanceiraRateio"("cliente_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceiraRateio_cliente_id_operacao_id_ordem_key" ON "OperacaoFinanceiraRateio"("cliente_id", "operacao_id", "ordem");

CREATE INDEX "TituloFinanceiro_cliente_id_empresa_id_status_vencimento_id_idx" ON "TituloFinanceiro"("cliente_id", "empresa_id", "status", "vencimento", "id");

CREATE INDEX "TituloFinanceiro_cliente_id_empresa_id_operacao_id_idx" ON "TituloFinanceiro"("cliente_id", "empresa_id", "operacao_id");

CREATE INDEX "TituloFinanceiro_cliente_id_parceiro_id_idx" ON "TituloFinanceiro"("cliente_id", "parceiro_id");

CREATE UNIQUE INDEX "TituloFinanceiro_cliente_id_id_key" ON "TituloFinanceiro"("cliente_id", "id");

CREATE UNIQUE INDEX "TituloFinanceiro_cliente_id_empresa_id_id_key" ON "TituloFinanceiro"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "TituloFinanceiro_cliente_id_operacao_id_numero_parcela_key" ON "TituloFinanceiro"("cliente_id", "operacao_id", "numero_parcela");

CREATE UNIQUE INDEX "LiquidacaoFinanceira_cliente_id_id_key" ON "LiquidacaoFinanceira"("cliente_id", "id");

CREATE UNIQUE INDEX "LiquidacaoFinanceira_cliente_id_empresa_id_id_key" ON "LiquidacaoFinanceira"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "LiquidacaoFinanceira_cliente_id_empresa_id_titulo_id_id_key" ON "LiquidacaoFinanceira"("cliente_id", "empresa_id", "titulo_id", "id");

CREATE INDEX "LiquidacaoFinanceiraEstorno_cliente_id_empresa_id_titulo_id_idx" ON "LiquidacaoFinanceiraEstorno"("cliente_id", "empresa_id", "titulo_id");

CREATE UNIQUE INDEX "LiquidacaoFinanceiraEstorno_cliente_id_id_key" ON "LiquidacaoFinanceiraEstorno"("cliente_id", "id");

CREATE UNIQUE INDEX "LiquidacaoFinanceiraEstorno_cliente_id_liquidacao_id_key" ON "LiquidacaoFinanceiraEstorno"("cliente_id", "liquidacao_id");

ALTER TABLE "PerfilFinanceiroEmpresa" ADD CONSTRAINT "PerfilFinanceiroEmpresa_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PerfilFinanceiroEmpresa" ADD CONSTRAINT "PerfilFinanceiroEmpresa_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_cliente_id_parceiro_id_fkey" FOREIGN KEY ("cliente_id", "parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_cliente_id_criado_por_usuario_id_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_cliente_id_confirmado_por_usuario_id_fkey" FOREIGN KEY ("cliente_id", "confirmado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_cliente_id_cancelado_por_usuario_id_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_cliente_id_empresa_id_operacao_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "operacao_id") REFERENCES "OperacaoFinanceira"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_cliente_id_local_estoque_id_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_cliente_id_movimentacao_estoque_id_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_cliente_id_movimentacao_estorno_id_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_cliente_id_estoque_lote_nota_id_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraConsumoLote" ADD CONSTRAINT "OperacaoFinanceiraConsumoLote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraConsumoLote" ADD CONSTRAINT "OperacaoFinanceiraConsumoLote_cliente_id_empresa_id_item_i_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "item_id") REFERENCES "OperacaoFinanceiraItem"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraConsumoLote" ADD CONSTRAINT "OperacaoFinanceiraConsumoLote_cliente_id_estoque_lote_nota_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraRateio" ADD CONSTRAINT "OperacaoFinanceiraRateio_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraRateio" ADD CONSTRAINT "OperacaoFinanceiraRateio_cliente_id_empresa_id_operacao_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "operacao_id", "operacao_direcao") REFERENCES "OperacaoFinanceira"("cliente_id", "empresa_id", "id", "direcao") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "OperacaoFinanceiraRateio" ADD CONSTRAINT "OperacaoFinanceiraRateio_cliente_id_empresa_id_natureza_ti_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "natureza_tipo", "natureza_id") REFERENCES "NaturezaFinanceira"("cliente_id", "empresa_id", "tipo", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "OperacaoFinanceiraRateio" ADD CONSTRAINT "OperacaoFinanceiraRateio_cliente_id_empresa_id_centro_cust_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraRateio" ADD CONSTRAINT "OperacaoFinanceiraRateio_cliente_id_empresa_id_centro_resu_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_resultado_id") REFERENCES "CentroResultado"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_cliente_id_empresa_id_operacao_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "operacao_id") REFERENCES "OperacaoFinanceira"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_cliente_id_parceiro_id_fkey" FOREIGN KEY ("cliente_id", "parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiquidacaoFinanceira" ADD CONSTRAINT "LiquidacaoFinanceira_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiquidacaoFinanceira" ADD CONSTRAINT "LiquidacaoFinanceira_cliente_id_empresa_id_titulo_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "titulo_id") REFERENCES "TituloFinanceiro"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiquidacaoFinanceira" ADD CONSTRAINT "LiquidacaoFinanceira_cliente_id_registrado_por_usuario_id_fkey" FOREIGN KEY ("cliente_id", "registrado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiquidacaoFinanceiraEstorno" ADD CONSTRAINT "LiquidacaoFinanceiraEstorno_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiquidacaoFinanceiraEstorno" ADD CONSTRAINT "LiquidacaoFinanceiraEstorno_titulo_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "titulo_id") REFERENCES "TituloFinanceiro"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiquidacaoFinanceiraEstorno" ADD CONSTRAINT "LiquidacaoFinanceiraEstorno_liquidacao_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "titulo_id", "liquidacao_id") REFERENCES "LiquidacaoFinanceira"("cliente_id", "empresa_id", "titulo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiquidacaoFinanceiraEstorno" ADD CONSTRAINT "LiquidacaoFinanceiraEstorno_cliente_id_registrado_por_usua_fkey" FOREIGN KEY ("cliente_id", "registrado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domínios fechados e invariantes de valor (CHECK escrito à mão; nomes ≤ 63 bytes).
ALTER TABLE "PerfilFinanceiroEmpresa" ADD CONSTRAINT "PerfilFinanceiroEmpresa_pais_check" CHECK ("pais" ~ '^[A-Z]{2}$');
ALTER TABLE "PerfilFinanceiroEmpresa" ADD CONSTRAINT "PerfilFinanceiroEmpresa_moeda_check" CHECK ("moeda" ~ '^[A-Z]{3}$');
ALTER TABLE "PerfilFinanceiroEmpresa" ADD CONSTRAINT "PerfilFinanceiroEmpresa_versao_check" CHECK ("versao_contrato" >= 1);

ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_status_check" CHECK ("status" IN ('RASCUNHO', 'CONFIRMADO', 'CANCELADO'));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_direcao_check" CHECK ("direcao" IN ('PAGAR', 'RECEBER'));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_conteudo_check" CHECK ("conteudo" IN ('COM_PRODUTOS', 'SEM_PRODUTOS'));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_condicao_check" CHECK ("condicao" IN ('AVISTA', 'PRAZO', 'PARCELADO'));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_rateio_modo_check" CHECK ("rateio_modo" IN ('VALOR', 'PERCENTUAL'));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_moeda_check" CHECK ("moeda" ~ '^[A-Z]{3}$' AND "moeda_casas" BETWEEN 0 AND 4);
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_valores_check" CHECK ("valor_bruto" > 0 AND "valor_desconto" >= 0 AND "valor_acrescimo" >= 0 AND "valor_total" > 0);
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_valor_total_check" CHECK ("valor_total" = "valor_bruto" - "valor_desconto" + "valor_acrescimo");
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_metodo_preferido_check" CHECK ("metodo_preferido" IS NULL OR "metodo_preferido" IN ('DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'PIX', 'OUTRO'));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_confirmado_check" CHECK ("status" <> 'CONFIRMADO' OR "confirmado_em" IS NOT NULL);
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_cancelado_check" CHECK ("status" <> 'CANCELADO' OR ("cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_documento_chave_check" CHECK (("status" = 'CONFIRMADO' AND "documento_chave_ativa" IS NOT DISTINCT FROM "documento_referencia") OR ("status" <> 'CONFIRMADO' AND "documento_chave_ativa" IS NULL));
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_data_operacional_check" CHECK ("conteudo" = 'COM_PRODUTOS' OR "data_operacional" IS NULL);
ALTER TABLE "OperacaoFinanceira" ADD CONSTRAINT "OperacaoFinanceira_versao_check" CHECK ("versao" >= 1 AND "versao_contrato" >= 1);

ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_tipo_item_check" CHECK ("tipo_item" IN ('MERCADORIA', 'SERVICO'));
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_unidade_check" CHECK ("unidade" IN ('KG', 'SACO', 'UN'));
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_valores_check" CHECK ("quantidade" > 0 AND "valor_unitario" >= 0 AND "valor_total" > 0 AND "ordem" >= 1);
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_forma_check" CHECK (("tipo_item" = 'MERCADORIA' AND "produto_id" IS NOT NULL AND "local_estoque_id" IS NOT NULL AND "unidade" IN ('KG', 'SACO') AND "fator_kg" IS NOT NULL AND "fator_kg" > 0 AND "quantidade_estoque" IS NOT NULL AND "quantidade_estoque" > 0) OR ("tipo_item" = 'SERVICO' AND "produto_id" IS NULL AND "local_estoque_id" IS NULL AND "descricao" IS NOT NULL AND "unidade" = 'UN' AND "fator_kg" IS NULL AND "quantidade_estoque" IS NULL AND "movimentacao_estoque_id" IS NULL AND "estoque_lote_nota_id" IS NULL AND "movimentacao_estorno_id" IS NULL));

ALTER TABLE "OperacaoFinanceiraConsumoLote" ADD CONSTRAINT "OperacaoFinanceiraConsumoLote_valores_check" CHECK ("quantidade" > 0 AND "custo_unitario" >= 0);

ALTER TABLE "OperacaoFinanceiraRateio" ADD CONSTRAINT "OperacaoFinanceiraRateio_tipo_direcao_check" CHECK (("operacao_direcao" = 'PAGAR' AND "natureza_tipo" = 'DESPESA') OR ("operacao_direcao" = 'RECEBER' AND "natureza_tipo" = 'RECEITA'));
ALTER TABLE "OperacaoFinanceiraRateio" ADD CONSTRAINT "OperacaoFinanceiraRateio_valores_check" CHECK ("valor" > 0 AND "ordem" >= 1 AND ("percentual" IS NULL OR ("percentual" > 0 AND "percentual" <= 100)));

ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_status_check" CHECK ("status" IN ('PREVISTO', 'ABERTO', 'PARCIAL', 'QUITADO', 'CANCELADO'));
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_direcao_check" CHECK ("direcao" IN ('PAGAR', 'RECEBER'));
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_moeda_check" CHECK ("moeda" ~ '^[A-Z]{3}$');
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_parcela_check" CHECK ("valor" > 0 AND "numero_parcela" >= 1 AND "total_parcelas" >= 1 AND "numero_parcela" <= "total_parcelas");
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_liquidado_check" CHECK ("valor_liquidado" >= 0 AND "valor_liquidado" <= "valor");
ALTER TABLE "TituloFinanceiro" ADD CONSTRAINT "TituloFinanceiro_coerencia_check" CHECK (("status" IN ('PREVISTO', 'ABERTO', 'CANCELADO') AND "valor_liquidado" = 0) OR ("status" = 'PARCIAL' AND "valor_liquidado" > 0 AND "valor_liquidado" < "valor") OR ("status" = 'QUITADO' AND "valor_liquidado" = "valor"));

ALTER TABLE "LiquidacaoFinanceira" ADD CONSTRAINT "LiquidacaoFinanceira_valor_check" CHECK ("valor" > 0);
ALTER TABLE "LiquidacaoFinanceira" ADD CONSTRAINT "LiquidacaoFinanceira_metodo_check" CHECK ("metodo" IN ('DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'PIX', 'OUTRO'));

ALTER TABLE "LiquidacaoFinanceiraEstorno" ADD CONSTRAINT "LiquidacaoFinanceiraEstorno_motivo_check" CHECK (char_length(btrim("motivo")) > 0);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['PerfilFinanceiroEmpresa','OperacaoFinanceira','OperacaoFinanceiraItem','OperacaoFinanceiraConsumoLote','OperacaoFinanceiraRateio','TituloFinanceiro','LiquidacaoFinanceira','LiquidacaoFinanceiraEstorno'];
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
