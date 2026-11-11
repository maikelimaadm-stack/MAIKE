-- D-PROD-162 — MAIKE Patrimônio SIMPLIFICA-01: o Patrimônio recomeça do zero.
-- Decisão do proprietário (2026-11-10): sem Perfis de medição, sem medições de
-- benfeitoria, sem Tipo de combustível, sem fator kg/L; Família e Tipo ficam no
-- cadastro de Bens; cada TANQUE do bem aceita Produtos do estoque
-- (TanqueBemProduto); o abastecimento baixa do estoque EXATAMENTE a quantidade
-- digitada, na unidade do Produto (L ou KG), sem conversão; o Produto e a compra
-- P3 aceitam Litros (L).
--
-- MODO CONTRACT (exceção aprovada pelo proprietário à D-PROD-72 item 3 e à
-- D-PROD-107 R7, registrada na D-PROD-162): esta migration APAGA as 13 tabelas
-- do Patrimônio (com o que houver lançado nelas, em TODOS os clientes), ALARGA
-- 2 CHECKs de OperacaoFinanceiraItem para aceitar 'L' e cria as 7 tabelas do
-- formato novo. O classificador do premerge só a aceita pela entrada fechada de
-- MIGRATIONS_CONTRACT_APROVADAS: guarda DO com hash pinado como PRIMEIRA
-- instrução, depois exatamente estes 13 DROP TABLE (nesta ordem, sem CASCADE),
-- depois exatamente as 4 instruções de alargamento (texto pinado); o resto é
-- EXPAND puro (só tabelas novas).
--
-- A guarda (falha fechada; qualquer recusa desfaz TUDO, nada é aplicado):
--  - lock_timeout 5s e statement_timeout 120s locais à transação;
--  - pg_advisory_xact_lock(72707369), a mesma trava do prisma migrate;
--  - as 13 tabelas existem e TanqueBemProduto ainda não existe;
--  - LOCK das 13 em ACCESS EXCLUSIVE antes de contar;
--  - o papel da conexão é o dono das 13 (as 7 novas herdam o mesmo dono e os
--    mesmos privilégios padrão; outro papel recusa);
--  - recusa se houver AbastecimentoBem CONFIRMADO (o estoque baixado não
--    voltaria: cancele com estorno exato antes, com GO);
--  - com linhas nas 13 (ou com o parâmetro informado): exige
--    maike.simplifica_impressao igual à impressão das contagens por tabela e
--    cliente aprovada no GO (preflight do runbook);
--  - recusa se alguma FK ou regra/visão de FORA das 13 depender delas, ou se
--    houver nelas gatilho, política ou publicação criados fora das migrations.
-- Única tabela antiga alterada: OperacaoFinanceiraItem (2 CHECKs só ALARGADOS;
-- toda linha válida antes continua válida). As FKs que somem moram nas 13.
-- Resíduos sem FK ficam como histórico (MovimentacaoEstoque de origem
-- abastecimento_patrimonio, AuditLog, OperacaoIdempotente dos tipos v1,
-- EntidadeCodigoSequencia, linhas antigas de Permissao.permissoes_telas).

-- 1. Guarda (PRIMEIRA instrução; hash pinado em MIGRATIONS_CONTRACT_APROVADAS).
DO $$
DECLARE
  apagadas constant text[] := ARRAY['AbastecimentoBemConsumoLote','AbastecimentoBem','ConversaoCombustivelProduto','TipoCombustivelProduto','TanqueBemCombustivel','TanqueBem','MedicaoBem','BemPatrimonial','TipoPatrimonialPerfil','TipoPatrimonial','FamiliaPatrimonial','PerfilMedicao','TipoCombustivel'];
  tbl text;
  oids oid[];
  n_confirmados bigint;
  externas text;
  dependentes text;
  estranhos text;
  parte text[];
  linhas text[] := ARRAY[]::text[];
  subtotal bigint;
  total bigint := 0;
  impressao text;
  esperada text := nullif(current_setting('maike.simplifica_impressao', true), '');
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  FOREACH tbl IN ARRAY apagadas
  LOOP
    IF to_regclass(format('public.%I', tbl)) IS NULL THEN
      RAISE EXCEPTION 'D-PROD-162: a tabela public.% não existe: schema fora do esperado; nada foi alterado', tbl;
    END IF;
  END LOOP;
  IF to_regclass('public."TanqueBemProduto"') IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-162: public.TanqueBemProduto já existe: migration já aplicada ou schema fora do esperado; nada foi alterado';
  END IF;
  LOCK TABLE public."AbastecimentoBemConsumoLote", public."AbastecimentoBem", public."ConversaoCombustivelProduto", public."TipoCombustivelProduto", public."TanqueBemCombustivel", public."TanqueBem", public."MedicaoBem", public."BemPatrimonial", public."TipoPatrimonialPerfil", public."TipoPatrimonial", public."FamiliaPatrimonial", public."PerfilMedicao", public."TipoCombustivel" IN ACCESS EXCLUSIVE MODE;
  SELECT array_agg(c.oid) INTO oids
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relname = ANY (apagadas);
  SELECT string_agg(c.relname || '=' || pg_get_userbyid(c.relowner), ', ' ORDER BY c.relname) INTO estranhos
    FROM pg_class c
   WHERE c.oid = ANY (oids) AND pg_get_userbyid(c.relowner) <> current_user;
  IF estranhos IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-162: o papel da conexão (%) não é o dono das tabelas apagadas (%): as novas ficariam com outro dono e outros privilégios; nada foi alterado', current_user, estranhos;
  END IF;
  SELECT count(*) INTO n_confirmados FROM public."AbastecimentoBem" WHERE "status" = 'CONFIRMADO';
  IF n_confirmados > 0 THEN
    RAISE EXCEPTION 'D-PROD-162: há % abastecimento(s) CONFIRMADO(s): apagar não devolve o estoque baixado; cancele com estorno exato e peça novo GO; nada foi alterado', n_confirmados;
  END IF;
  FOREACH tbl IN ARRAY apagadas
  LOOP
    EXECUTE format('SELECT coalesce(array_agg(%L || ''|'' || s.cliente_id || ''|'' || s.n ORDER BY s.cliente_id COLLATE "C"), ARRAY[]::text[]), coalesce(sum(s.n), 0) FROM (SELECT cliente_id, count(*) AS n FROM public.%I GROUP BY cliente_id) s', tbl, tbl)
      INTO parte, subtotal;
    linhas := linhas || parte;
    total := total + subtotal;
  END LOOP;
  impressao := left(md5(array_to_string(linhas, E'\n')), 12);
  IF (total > 0 OR esperada IS NOT NULL) AND esperada IS DISTINCT FROM impressao THEN
    RAISE EXCEPTION 'D-PROD-162: as contagens das tabelas apagadas (% linhas) não são as aprovadas no GO (maike.simplifica_impressao = %): refaça o preflight e peça novo GO; nada foi alterado', total, coalesce(esperada, 'ausente');
  END IF;
  SELECT string_agg(k.conrelid::regclass::text || '.' || k.conname, ', ' ORDER BY k.conname) INTO externas
    FROM pg_constraint k
   WHERE k.contype = 'f' AND k.confrelid = ANY (oids) AND NOT (k.conrelid = ANY (oids));
  IF externas IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-162: FK de fora do Patrimônio aponta para as tabelas apagadas (%); nada foi alterado', externas;
  END IF;
  SELECT string_agg(DISTINCT r.ev_class::regclass::text, ', ') INTO dependentes
    FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
   WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = ANY (oids) AND NOT (r.ev_class = ANY (oids));
  IF dependentes IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-162: visão ou regra depende das tabelas apagadas (%); nada foi alterado', dependentes;
  END IF;
  SELECT string_agg(x.objeto, ', ' ORDER BY x.objeto) INTO estranhos
    FROM (SELECT t.tgrelid::regclass::text || ' gatilho ' || t.tgname AS objeto FROM pg_trigger t WHERE t.tgrelid = ANY (oids) AND NOT t.tgisinternal
          UNION ALL SELECT p.polrelid::regclass::text || ' política ' || p.polname FROM pg_policy p WHERE p.polrelid = ANY (oids) AND p.polname <> 'maike_backend_all'
          UNION ALL SELECT pr.prrelid::regclass::text || ' publicação ' || pb.pubname FROM pg_publication_rel pr JOIN pg_publication pb ON pb.oid = pr.prpubid WHERE pr.prrelid = ANY (oids)) x;
  IF estranhos IS NOT NULL THEN
    RAISE EXCEPTION 'D-PROD-162: objeto criado fora das migrations nas tabelas apagadas (%): o DROP o apagaria em silêncio; nada foi alterado', estranhos;
  END IF;
END $$;

-- 2. Contração: filhas antes das mães, sem CASCADE (uma dependência inesperada faz o DROP falhar e desfaz tudo).
DROP TABLE "AbastecimentoBemConsumoLote";
DROP TABLE "AbastecimentoBem";
DROP TABLE "ConversaoCombustivelProduto";
DROP TABLE "TipoCombustivelProduto";
DROP TABLE "TanqueBemCombustivel";
DROP TABLE "TanqueBem";
DROP TABLE "MedicaoBem";
DROP TABLE "BemPatrimonial";
DROP TABLE "TipoPatrimonialPerfil";
DROP TABLE "TipoPatrimonial";
DROP TABLE "FamiliaPatrimonial";
DROP TABLE "PerfilMedicao";
DROP TABLE "TipoCombustivel";

-- 3. Alargamento fechado (D1): a compra P3 aceita Litros. Só os 2 CHECKs de OperacaoFinanceiraItem
-- (P3-01 migration.sql:355 e :361), com o mesmo texto + 'L'; toda linha válida antes continua válida.
ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_unidade_check";
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_unidade_check" CHECK ("unidade" IN ('KG', 'SACO', 'UN', 'L'));
ALTER TABLE "OperacaoFinanceiraItem" DROP CONSTRAINT "OperacaoFinanceiraItem_forma_check";
ALTER TABLE "OperacaoFinanceiraItem" ADD CONSTRAINT "OperacaoFinanceiraItem_forma_check" CHECK (("tipo_item" = 'MERCADORIA' AND "produto_id" IS NOT NULL AND "local_estoque_id" IS NOT NULL AND "unidade" IN ('KG', 'SACO', 'L') AND "fator_kg" IS NOT NULL AND "fator_kg" > 0 AND "quantidade_estoque" IS NOT NULL AND "quantidade_estoque" > 0) OR ("tipo_item" = 'SERVICO' AND "produto_id" IS NULL AND "local_estoque_id" IS NULL AND "descricao" IS NOT NULL AND "unidade" = 'UN' AND "fator_kg" IS NULL AND "quantidade_estoque" IS NULL AND "movimentacao_estoque_id" IS NULL AND "estoque_lote_nota_id" IS NULL AND "movimentacao_estorno_id" IS NULL));

-- 4. Expansão: as 7 tabelas do formato novo (só tabelas novas desta migration).
CREATE TABLE "FamiliaPatrimonial" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "codigo" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "natureza" VARCHAR(16) NOT NULL,
    "descricao" VARCHAR(500),
    "ordem" INTEGER,
    "vida_util_meses_padrao" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FamiliaPatrimonial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TipoPatrimonial" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "familia_id" VARCHAR(64) NOT NULL,
    "codigo" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "vida_util_meses_sugerida" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoPatrimonial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BemPatrimonial" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "codigo_frota" VARCHAR(16),
    "nome" VARCHAR(120) NOT NULL,
    "natureza" VARCHAR(16) NOT NULL,
    "familia_id" VARCHAR(64) NOT NULL,
    "tipo_id" VARCHAR(64) NOT NULL,
    "propriedade" VARCHAR(16) NOT NULL DEFAULT 'PROPRIO',
    "proprietario_parceiro_id" VARCHAR(64),
    "responsavel_usuario_id" VARCHAR(64),
    "centro_custo_id" VARCHAR(64),
    "area_id" VARCHAR(64),
    "localizacao_descricao" VARCHAR(255),
    "marca" VARCHAR(80),
    "modelo" VARCHAR(80),
    "ano_fabricacao" INTEGER,
    "ano_modelo" INTEGER,
    "numero_serie" VARCHAR(40),
    "chassi" VARCHAR(17),
    "placa" VARCHAR(8),
    "placa_uf" VARCHAR(2),
    "renavam" VARCHAR(11),
    "potencia_cv" DECIMAL(14,4),
    "material" VARCHAR(80),
    "ano_conclusao" INTEGER,
    "compatibilidade" VARCHAR(255),
    "especificacoes" VARCHAR(1000),
    "observacoes" VARCHAR(2000),
    "medidor_tipo" VARCHAR(16),
    "medidor_unidade" VARCHAR(8),
    "medidor_leitura_inicial" DECIMAL(14,4),
    "medidor_leitura_atual" DECIMAL(14,4),
    "medidor_data_leitura" DATE,
    "medidor_origem" VARCHAR(24),
    "data_aquisicao" DATE,
    "data_disponibilidade" DATE,
    "valor_aquisicao" DECIMAL(18,4),
    "custo_incorporacao" DECIMAL(18,4),
    "fornecedor_parceiro_id" VARCHAR(64),
    "documento_referencia" VARCHAR(80),
    "garantia_ate" DATE,
    "depreciavel" BOOLEAN NOT NULL DEFAULT false,
    "depreciacao_metodo" VARCHAR(16),
    "vida_util_meses" INTEGER,
    "residual_modo" VARCHAR(16),
    "valor_residual" DECIMAL(18,4),
    "residual_percentual" DECIMAL(9,6),
    "data_inicio_depreciacao" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BemPatrimonial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TanqueBem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "bem_id" VARCHAR(64) NOT NULL,
    "identificador" VARCHAR(40) NOT NULL,
    "capacidade_litros" DECIMAL(14,4) NOT NULL,
    "observacao" VARCHAR(255),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TanqueBem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TanqueBemProduto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "tanque_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TanqueBemProduto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AbastecimentoBem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "bem_id" VARCHAR(64) NOT NULL,
    "tanque_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "data_operacional" DATE NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade" VARCHAR(4) NOT NULL,
    "custo_total" DECIMAL(14,4) NOT NULL,
    "custo_unitario" DECIMAL(14,4) NOT NULL,
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

CREATE INDEX "FamiliaPatrimonial_cliente_id_ativo_idx" ON "FamiliaPatrimonial"("cliente_id", "ativo");

CREATE INDEX "FamiliaPatrimonial_cliente_id_createdAt_id_idx" ON "FamiliaPatrimonial"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "FamiliaPatrimonial_cliente_id_id_key" ON "FamiliaPatrimonial"("cliente_id", "id");

CREATE UNIQUE INDEX "FamiliaPatrimonial_cliente_id_codigo_key" ON "FamiliaPatrimonial"("cliente_id", "codigo");

CREATE UNIQUE INDEX "FamiliaPatrimonial_cliente_id_nome_key" ON "FamiliaPatrimonial"("cliente_id", "nome");

CREATE INDEX "TipoPatrimonial_cliente_id_familia_id_ativo_idx" ON "TipoPatrimonial"("cliente_id", "familia_id", "ativo");

CREATE INDEX "TipoPatrimonial_cliente_id_createdAt_id_idx" ON "TipoPatrimonial"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "TipoPatrimonial_cliente_id_id_key" ON "TipoPatrimonial"("cliente_id", "id");

CREATE UNIQUE INDEX "TipoPatrimonial_cliente_id_codigo_key" ON "TipoPatrimonial"("cliente_id", "codigo");

CREATE UNIQUE INDEX "TipoPatrimonial_cliente_id_familia_id_nome_key" ON "TipoPatrimonial"("cliente_id", "familia_id", "nome");

CREATE INDEX "BemPatrimonial_cliente_id_empresa_id_createdAt_id_idx" ON "BemPatrimonial"("cliente_id", "empresa_id", "createdAt", "id");

CREATE INDEX "BemPatrimonial_cliente_id_empresa_id_ativo_idx" ON "BemPatrimonial"("cliente_id", "empresa_id", "ativo");

CREATE INDEX "BemPatrimonial_cliente_id_familia_id_idx" ON "BemPatrimonial"("cliente_id", "familia_id");

CREATE INDEX "BemPatrimonial_cliente_id_tipo_id_idx" ON "BemPatrimonial"("cliente_id", "tipo_id");

CREATE INDEX "BemPatrimonial_cliente_id_proprietario_parceiro_id_idx" ON "BemPatrimonial"("cliente_id", "proprietario_parceiro_id");

CREATE INDEX "BemPatrimonial_cliente_id_fornecedor_parceiro_id_idx" ON "BemPatrimonial"("cliente_id", "fornecedor_parceiro_id");

CREATE INDEX "BemPatrimonial_cliente_id_responsavel_usuario_id_idx" ON "BemPatrimonial"("cliente_id", "responsavel_usuario_id");

CREATE INDEX "BemPatrimonial_cliente_id_empresa_id_centro_custo_id_idx" ON "BemPatrimonial"("cliente_id", "empresa_id", "centro_custo_id");

CREATE INDEX "BemPatrimonial_cliente_id_area_id_idx" ON "BemPatrimonial"("cliente_id", "area_id");

CREATE UNIQUE INDEX "BemPatrimonial_cliente_id_id_key" ON "BemPatrimonial"("cliente_id", "id");

CREATE UNIQUE INDEX "BemPatrimonial_cliente_id_numero_key" ON "BemPatrimonial"("cliente_id", "numero");

CREATE UNIQUE INDEX "BemPatrimonial_cliente_id_empresa_id_codigo_frota_key" ON "BemPatrimonial"("cliente_id", "empresa_id", "codigo_frota");

CREATE INDEX "TanqueBem_cliente_id_createdAt_id_idx" ON "TanqueBem"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "TanqueBem_cliente_id_id_key" ON "TanqueBem"("cliente_id", "id");

CREATE UNIQUE INDEX "TanqueBem_cliente_id_bem_id_identificador_key" ON "TanqueBem"("cliente_id", "bem_id", "identificador");

CREATE UNIQUE INDEX "BemPatrimonial_cliente_id_empresa_id_id_key" ON "BemPatrimonial"("cliente_id", "empresa_id", "id");

CREATE UNIQUE INDEX "TanqueBem_cliente_id_bem_id_id_key" ON "TanqueBem"("cliente_id", "bem_id", "id");

CREATE INDEX "TanqueBemProduto_cliente_id_produto_id_idx" ON "TanqueBemProduto"("cliente_id", "produto_id");

CREATE INDEX "TanqueBemProduto_cliente_id_createdAt_id_idx" ON "TanqueBemProduto"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "TanqueBemProduto_cliente_id_id_key" ON "TanqueBemProduto"("cliente_id", "id");

CREATE UNIQUE INDEX "TanqueBemProduto_cliente_id_tanque_id_produto_id_key" ON "TanqueBemProduto"("cliente_id", "tanque_id", "produto_id");

CREATE INDEX "AbastecimentoBem_cliente_id_empresa_id_createdAt_id_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "createdAt", "id");

CREATE INDEX "AbastecimentoBem_empresa_bem_keyset_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "bem_id", "createdAt", "id");

CREATE INDEX "AbastecimentoBem_bem_status_data_idx" ON "AbastecimentoBem"("cliente_id", "bem_id", "status", "data_operacional");

CREATE INDEX "AbastecimentoBem_tanque_status_data_idx" ON "AbastecimentoBem"("cliente_id", "tanque_id", "status", "data_operacional");

CREATE INDEX "AbastecimentoBem_cliente_id_empresa_id_produto_id_idx" ON "AbastecimentoBem"("cliente_id", "empresa_id", "produto_id");

CREATE INDEX "AbastecimentoBem_cliente_id_produto_id_idx" ON "AbastecimentoBem"("cliente_id", "produto_id");

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

ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_cliente_id_familia_id_fkey" FOREIGN KEY ("cliente_id", "familia_id") REFERENCES "FamiliaPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_familia_id_fkey" FOREIGN KEY ("cliente_id", "familia_id") REFERENCES "FamiliaPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_tipo_id_fkey" FOREIGN KEY ("cliente_id", "tipo_id") REFERENCES "TipoPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_proprietario_parceiro_id_fkey" FOREIGN KEY ("cliente_id", "proprietario_parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_fornecedor_parceiro_id_fkey" FOREIGN KEY ("cliente_id", "fornecedor_parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_responsavel_usuario_id_fkey" FOREIGN KEY ("cliente_id", "responsavel_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_empresa_id_centro_custo_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_area_id_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_cliente_id_bem_id_fkey" FOREIGN KEY ("cliente_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBemProduto" ADD CONSTRAINT "TanqueBemProduto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBemProduto" ADD CONSTRAINT "TanqueBemProduto_cliente_id_tanque_id_fkey" FOREIGN KEY ("cliente_id", "tanque_id") REFERENCES "TanqueBem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBemProduto" ADD CONSTRAINT "TanqueBemProduto_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_empresa_id_bem_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_bem_id_tanque_id_fkey" FOREIGN KEY ("cliente_id", "bem_id", "tanque_id") REFERENCES "TanqueBem"("cliente_id", "bem_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_tanque_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "tanque_id", "produto_id") REFERENCES "TanqueBemProduto"("cliente_id", "tanque_id", "produto_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cliente_id_local_estoque_id_fkey" FOREIGN KEY ("cliente_id", "local_estoque_id") REFERENCES "LocalEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_movimentacao_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estoque_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_estorno_fkey" FOREIGN KEY ("cliente_id", "movimentacao_estorno_id") REFERENCES "MovimentacaoEstoque"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_criado_por_fkey" FOREIGN KEY ("cliente_id", "criado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_cancelado_por_fkey" FOREIGN KEY ("cliente_id", "cancelado_por_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBemConsumoLote" ADD CONSTRAINT "AbastecimentoBemConsumoLote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBemConsumoLote" ADD CONSTRAINT "AbastecimentoBemConsumoLote_abastecimento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "abastecimento_id") REFERENCES "AbastecimentoBem"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AbastecimentoBemConsumoLote" ADD CONSTRAINT "AbastecimentoBemConsumoLote_lote_fkey" FOREIGN KEY ("cliente_id", "estoque_lote_nota_id") REFERENCES "EstoqueLoteNota"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domínios fechados e invariantes (CHECK escrito à mão; NULL-safe; nomes ≤ 63 bytes; nenhum ponto e vírgula dentro).
ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_codigo_check" CHECK ("codigo" ~ '^[A-Z0-9_]{2,32}$');
ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_natureza_check" CHECK ("natureza" IN ('BENFEITORIA', 'MAQUINA', 'VEICULO', 'IMPLEMENTO', 'EQUIPAMENTO', 'OUTRO'));
ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_valores_check" CHECK (("ordem" IS NULL OR "ordem" BETWEEN 0 AND 9999) AND ("vida_util_meses_padrao" IS NULL OR "vida_util_meses_padrao" BETWEEN 1 AND 1200) AND "versao" >= 1);
ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_codigo_check" CHECK ("codigo" ~ '^[A-Z0-9_]{2,32}$');
ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_valores_check" CHECK (("vida_util_meses_sugerida" IS NULL OR "vida_util_meses_sugerida" BETWEEN 1 AND 1200) AND "versao" >= 1);
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_natureza_check" CHECK ("natureza" IN ('BENFEITORIA', 'MAQUINA', 'VEICULO', 'IMPLEMENTO', 'EQUIPAMENTO', 'OUTRO'));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_propriedade_check" CHECK ("propriedade" IN ('PROPRIO', 'TERCEIRO', 'ARRENDADO', 'CEDIDO'));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_proprietario_check" CHECK ("propriedade" <> 'PROPRIO' OR "proprietario_parceiro_id" IS NULL);
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_medidor_tipo_check" CHECK ("medidor_tipo" IS NULL OR "medidor_tipo" IN ('SEM_MEDIDOR', 'HORIMETRO', 'ODOMETRO', 'CICLOS'));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_medidor_origem_check" CHECK ("medidor_origem" IS NULL OR "medidor_origem" IN ('CADASTRO_INICIAL', 'AJUSTE_CADASTRO'));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_metodo_check" CHECK ("depreciacao_metodo" IS NULL OR "depreciacao_metodo" = 'LINEAR');
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_residual_modo_check" CHECK ("residual_modo" IS NULL OR "residual_modo" IN ('VALOR', 'PERCENTUAL'));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_medidor_natureza_check" CHECK (("natureza" = 'BENFEITORIA' AND "medidor_tipo" IS NULL) OR ("natureza" IN ('MAQUINA', 'VEICULO', 'EQUIPAMENTO') AND "medidor_tipo" IS NOT NULL) OR "natureza" IN ('IMPLEMENTO', 'OUTRO'));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_medidor_check" CHECK ((("medidor_tipo" IS NULL OR "medidor_tipo" = 'SEM_MEDIDOR') AND "medidor_unidade" IS NULL AND "medidor_leitura_inicial" IS NULL AND "medidor_leitura_atual" IS NULL AND "medidor_data_leitura" IS NULL AND "medidor_origem" IS NULL) OR ("medidor_tipo" IS NOT NULL AND "medidor_unidade" IS NOT NULL AND "medidor_leitura_inicial" IS NOT NULL AND "medidor_leitura_atual" IS NOT NULL AND "medidor_data_leitura" IS NOT NULL AND "medidor_origem" IS NOT NULL AND (("medidor_tipo" = 'HORIMETRO' AND "medidor_unidade" = 'h') OR ("medidor_tipo" = 'ODOMETRO' AND "medidor_unidade" = 'km') OR ("medidor_tipo" = 'CICLOS' AND "medidor_unidade" = 'ciclos')) AND "medidor_leitura_inicial" >= 0 AND "medidor_leitura_atual" >= "medidor_leitura_inicial"));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_valores_check" CHECK (("valor_aquisicao" IS NULL OR "valor_aquisicao" >= 0) AND ("custo_incorporacao" IS NULL OR "custo_incorporacao" >= 0) AND ("potencia_cv" IS NULL OR "potencia_cv" > 0));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_datas_check" CHECK ("data_aquisicao" IS NULL OR "data_disponibilidade" IS NULL OR "data_disponibilidade" >= "data_aquisicao");
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_depreciacao_check" CHECK (("depreciavel" = false AND "depreciacao_metodo" IS NULL AND "vida_util_meses" IS NULL AND "residual_modo" IS NULL AND "valor_residual" IS NULL AND "residual_percentual" IS NULL AND "data_inicio_depreciacao" IS NULL) OR ("depreciavel" = true AND "propriedade" = 'PROPRIO' AND "depreciacao_metodo" IS NOT NULL AND "depreciacao_metodo" = 'LINEAR' AND "vida_util_meses" IS NOT NULL AND "vida_util_meses" BETWEEN 1 AND 1200 AND "data_inicio_depreciacao" IS NOT NULL AND "valor_aquisicao" IS NOT NULL AND "residual_modo" IS NOT NULL AND (("residual_modo" = 'VALOR' AND "valor_residual" IS NOT NULL AND "valor_residual" >= 0 AND "valor_residual" <= "valor_aquisicao" + COALESCE("custo_incorporacao", 0) AND "residual_percentual" IS NULL) OR ("residual_modo" = 'PERCENTUAL' AND "residual_percentual" IS NOT NULL AND "residual_percentual" >= 0 AND "residual_percentual" <= 100 AND "valor_residual" IS NULL))));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_inicio_depreciacao_check" CHECK ("data_inicio_depreciacao" IS NULL OR "data_inicio_depreciacao" >= COALESCE("data_disponibilidade", "data_aquisicao", "data_inicio_depreciacao"));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_codigo_frota_check" CHECK ("codigo_frota" IS NULL OR "codigo_frota" ~ '^[A-Z0-9]+([ -][A-Z0-9]+)*$');
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_identificacao_check" CHECK (("placa" IS NULL OR "placa" ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$') AND ("placa_uf" IS NULL OR "placa_uf" IN ('AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO')) AND ("renavam" IS NULL OR "renavam" ~ '^[0-9]{9,11}$') AND ("chassi" IS NULL OR "chassi" ~ '^[A-HJ-NPR-Z0-9]{17}$'));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_anos_check" CHECK (("ano_fabricacao" IS NULL OR "ano_fabricacao" BETWEEN 1900 AND 2100) AND ("ano_modelo" IS NULL OR "ano_modelo" BETWEEN 1900 AND 2101) AND ("ano_conclusao" IS NULL OR "ano_conclusao" BETWEEN 1800 AND 2100));
ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_versao_check" CHECK ("versao" >= 1);
ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_capacidade_check" CHECK ("capacidade_litros" > 0);
ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_identificador_check" CHECK (char_length(btrim("identificador")) > 0);
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_status_check" CHECK (("status" = 'CONFIRMADO' AND "movimentacao_estorno_id" IS NULL AND "cancelado_em" IS NULL AND "cancelado_por_usuario_id" IS NULL AND "motivo_cancelamento" IS NULL) OR ("status" = 'CANCELADO' AND "movimentacao_estorno_id" IS NOT NULL AND "cancelado_em" IS NOT NULL AND "motivo_cancelamento" IS NOT NULL AND char_length(btrim("motivo_cancelamento")) >= 3));
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_quantidade_check" CHECK ("quantidade" > 0 AND "unidade" IN ('L', 'KG'));
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_custos_check" CHECK ("custo_total" >= 0 AND "custo_unitario" >= 0);
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
  tabelas constant text[] := ARRAY['AbastecimentoBem','AbastecimentoBemConsumoLote','BemPatrimonial','FamiliaPatrimonial','TanqueBem','TanqueBemProduto','TipoPatrimonial'];
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
