-- D-PROD-157 — MAIKE Patrimônio e Frota P1-01: cadastros nativos de inventário.
-- Catálogos do TENANT (FamiliaPatrimonial, TipoPatrimonial, TipoPatrimonialPerfil,
-- PerfilMedicao, TipoCombustivel; sem empresa) e o bem da EMPRESA
-- (BemPatrimonial) com os seus atributos (MedicaoBem, TanqueBem,
-- TanqueBemCombustivel) e, por EMPRESA, o vínculo explícito de um tipo de
-- combustível a Produtos reais da fazenda (TipoCombustivelProduto, R2). Sem
-- abastecimento, manutenção, consumo, estoque, financeiro, OS, custo/hora ou
-- contabilidade: a depreciação são só parâmetros (a prévia é calculada no
-- servidor e nada grava) e o vínculo a Produto é só classificação (nenhuma
-- conversão L↔KG, nenhum saldo, custo ou movimento).
--
-- EXPAND-ONLY: só CREATE TABLE / INDEX / FK / CHECK nas 10 tabelas NOVAS. Nenhuma
-- tabela existente é alterada e nenhum dado é migrado (o catálogo padrão é
-- instalado pelo serviço, nunca por seed). As FKs para tabelas antigas são
-- compostas por (cliente_id, …) e RESTRICT: nada some em cascata.
--
-- Escopo garantido pelo banco: toda FK inclui cliente_id; o bem pertence à
-- empresa pela FK composta (cliente_id, empresa_id) e o centro de custo do bem é
-- da MESMA empresa (FK (cliente_id, empresa_id, centro_custo_id)); medições,
-- tanques e vínculos de combustível herdam o tenant do bem pela FK
-- (cliente_id, bem_id|tanque_id); `principal` (true|NULL) com unique garante no
-- máximo um principal por tipo e por bem; o valor normalizado da medição é o
-- informado vezes o fator EXATO da unidade (CHECK). O vínculo combustível ×
-- produto tem FK composta (cliente_id, …) para Empresa, TipoCombustivel e
-- Produto; como Produto não tem unique (cliente_id, empresa_id, id) e não é
-- alterado aqui, a coerência Produto.empresa_id = vínculo.empresa_id é
-- invariante do serviço. No máximo UM vínculo ativo por produto na empresa
-- (`ativo_chave` true|NULL + unique) e nunca o mesmo par repetido.
--
-- Reversão operacional (não executada em produção): as 10 tabelas são novas e
-- nenhuma tabela antiga as referencia; removê-las (filhas antes das mães:
-- TipoCombustivelProduto, TanqueBemCombustivel, TanqueBem, MedicaoBem,
-- BemPatrimonial, TipoPatrimonialPerfil, TipoPatrimonial, FamiliaPatrimonial,
-- PerfilMedicao, TipoCombustivel) não afeta dados existentes.

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

CREATE TABLE "TipoPatrimonialPerfil" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "tipo_id" VARCHAR(64) NOT NULL,
    "perfil_id" VARCHAR(64) NOT NULL,
    "principal" BOOLEAN,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoPatrimonialPerfil_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PerfilMedicao" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "codigo" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "dimensao" VARCHAR(16) NOT NULL,
    "finalidade" VARCHAR(16) NOT NULL,
    "unidade_canonica" VARCHAR(8) NOT NULL,
    "unidades_permitidas" TEXT[],
    "descricao" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfilMedicao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TipoCombustivel" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "codigo" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "unidade" VARCHAR(4) NOT NULL DEFAULT 'L',
    "descricao" VARCHAR(500),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoCombustivel_pkey" PRIMARY KEY ("id")
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

CREATE TABLE "MedicaoBem" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "bem_id" VARCHAR(64) NOT NULL,
    "perfil_id" VARCHAR(64) NOT NULL,
    "rotulo" VARCHAR(80),
    "valor_informado" DECIMAL(14,4) NOT NULL,
    "unidade_informada" VARCHAR(8) NOT NULL,
    "valor_normalizado" DECIMAL(22,4) NOT NULL,
    "unidade_canonica" VARCHAR(8) NOT NULL,
    "principal" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicaoBem_pkey" PRIMARY KEY ("id")
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

CREATE TABLE "TanqueBemCombustivel" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "tanque_id" VARCHAR(64) NOT NULL,
    "combustivel_id" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TanqueBemCombustivel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TipoCombustivelProduto" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "tipo_combustivel_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ativo_chave" BOOLEAN,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoCombustivelProduto_pkey" PRIMARY KEY ("id")
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

CREATE INDEX "TipoPatrimonialPerfil_cliente_id_createdAt_id_idx" ON "TipoPatrimonialPerfil"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "TipoPatrimonialPerfil_cliente_id_id_key" ON "TipoPatrimonialPerfil"("cliente_id", "id");

CREATE UNIQUE INDEX "TipoPatrimonialPerfil_cliente_id_tipo_id_perfil_id_key" ON "TipoPatrimonialPerfil"("cliente_id", "tipo_id", "perfil_id");

CREATE UNIQUE INDEX "TipoPatrimonialPerfil_cliente_id_tipo_id_principal_key" ON "TipoPatrimonialPerfil"("cliente_id", "tipo_id", "principal");

CREATE INDEX "PerfilMedicao_cliente_id_createdAt_id_idx" ON "PerfilMedicao"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "PerfilMedicao_cliente_id_id_key" ON "PerfilMedicao"("cliente_id", "id");

CREATE UNIQUE INDEX "PerfilMedicao_cliente_id_codigo_key" ON "PerfilMedicao"("cliente_id", "codigo");

CREATE UNIQUE INDEX "PerfilMedicao_cliente_id_nome_key" ON "PerfilMedicao"("cliente_id", "nome");

CREATE INDEX "TipoCombustivel_cliente_id_createdAt_id_idx" ON "TipoCombustivel"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "TipoCombustivel_cliente_id_id_key" ON "TipoCombustivel"("cliente_id", "id");

CREATE UNIQUE INDEX "TipoCombustivel_cliente_id_codigo_key" ON "TipoCombustivel"("cliente_id", "codigo");

CREATE UNIQUE INDEX "TipoCombustivel_cliente_id_nome_key" ON "TipoCombustivel"("cliente_id", "nome");

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

CREATE INDEX "MedicaoBem_cliente_id_perfil_id_idx" ON "MedicaoBem"("cliente_id", "perfil_id");

CREATE INDEX "MedicaoBem_cliente_id_createdAt_id_idx" ON "MedicaoBem"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "MedicaoBem_cliente_id_id_key" ON "MedicaoBem"("cliente_id", "id");

CREATE UNIQUE INDEX "MedicaoBem_cliente_id_bem_id_perfil_id_key" ON "MedicaoBem"("cliente_id", "bem_id", "perfil_id");

CREATE UNIQUE INDEX "MedicaoBem_cliente_id_bem_id_principal_key" ON "MedicaoBem"("cliente_id", "bem_id", "principal");

CREATE INDEX "TanqueBem_cliente_id_createdAt_id_idx" ON "TanqueBem"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "TanqueBem_cliente_id_id_key" ON "TanqueBem"("cliente_id", "id");

CREATE UNIQUE INDEX "TanqueBem_cliente_id_bem_id_identificador_key" ON "TanqueBem"("cliente_id", "bem_id", "identificador");

CREATE INDEX "TanqueBemCombustivel_cliente_id_combustivel_id_idx" ON "TanqueBemCombustivel"("cliente_id", "combustivel_id");

CREATE INDEX "TanqueBemCombustivel_cliente_id_createdAt_id_idx" ON "TanqueBemCombustivel"("cliente_id", "createdAt", "id");

CREATE UNIQUE INDEX "TanqueBemCombustivel_cliente_id_id_key" ON "TanqueBemCombustivel"("cliente_id", "id");

CREATE UNIQUE INDEX "TanqueBemCombustivel_cliente_id_tanque_id_combustivel_id_key" ON "TanqueBemCombustivel"("cliente_id", "tanque_id", "combustivel_id");

CREATE INDEX "TipoCombustivelProduto_empresa_tipo_ativo_idx" ON "TipoCombustivelProduto"("cliente_id", "empresa_id", "tipo_combustivel_id", "ativo");

CREATE INDEX "TipoCombustivelProduto_cliente_id_produto_id_idx" ON "TipoCombustivelProduto"("cliente_id", "produto_id");

CREATE INDEX "TipoCombustivelProduto_cliente_id_tipo_combustivel_id_idx" ON "TipoCombustivelProduto"("cliente_id", "tipo_combustivel_id");

CREATE INDEX "TipoCombustivelProduto_cliente_id_empresa_id_createdAt_id_idx" ON "TipoCombustivelProduto"("cliente_id", "empresa_id", "createdAt", "id");

CREATE UNIQUE INDEX "TipoCombustivelProduto_cliente_id_id_key" ON "TipoCombustivelProduto"("cliente_id", "id");

CREATE UNIQUE INDEX "TipoCombustivelProduto_par_key" ON "TipoCombustivelProduto"("cliente_id", "empresa_id", "tipo_combustivel_id", "produto_id");

CREATE UNIQUE INDEX "TipoCombustivelProduto_produto_ativo_key" ON "TipoCombustivelProduto"("cliente_id", "empresa_id", "produto_id", "ativo_chave");

ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_cliente_id_familia_id_fkey" FOREIGN KEY ("cliente_id", "familia_id") REFERENCES "FamiliaPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoPatrimonialPerfil" ADD CONSTRAINT "TipoPatrimonialPerfil_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoPatrimonialPerfil" ADD CONSTRAINT "TipoPatrimonialPerfil_cliente_id_tipo_id_fkey" FOREIGN KEY ("cliente_id", "tipo_id") REFERENCES "TipoPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoPatrimonialPerfil" ADD CONSTRAINT "TipoPatrimonialPerfil_cliente_id_perfil_id_fkey" FOREIGN KEY ("cliente_id", "perfil_id") REFERENCES "PerfilMedicao"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PerfilMedicao" ADD CONSTRAINT "PerfilMedicao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoCombustivel" ADD CONSTRAINT "TipoCombustivel_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_familia_id_fkey" FOREIGN KEY ("cliente_id", "familia_id") REFERENCES "FamiliaPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_tipo_id_fkey" FOREIGN KEY ("cliente_id", "tipo_id") REFERENCES "TipoPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_proprietario_parceiro_id_fkey" FOREIGN KEY ("cliente_id", "proprietario_parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_fornecedor_parceiro_id_fkey" FOREIGN KEY ("cliente_id", "fornecedor_parceiro_id") REFERENCES "Fornecedor"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_responsavel_usuario_id_fkey" FOREIGN KEY ("cliente_id", "responsavel_usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_empresa_id_centro_custo_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "centro_custo_id") REFERENCES "CentroCusto"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BemPatrimonial" ADD CONSTRAINT "BemPatrimonial_cliente_id_area_id_fkey" FOREIGN KEY ("cliente_id", "area_id") REFERENCES "AreaPastagem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MedicaoBem" ADD CONSTRAINT "MedicaoBem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MedicaoBem" ADD CONSTRAINT "MedicaoBem_cliente_id_bem_id_fkey" FOREIGN KEY ("cliente_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MedicaoBem" ADD CONSTRAINT "MedicaoBem_cliente_id_perfil_id_fkey" FOREIGN KEY ("cliente_id", "perfil_id") REFERENCES "PerfilMedicao"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_cliente_id_bem_id_fkey" FOREIGN KEY ("cliente_id", "bem_id") REFERENCES "BemPatrimonial"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBemCombustivel" ADD CONSTRAINT "TanqueBemCombustivel_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBemCombustivel" ADD CONSTRAINT "TanqueBemCombustivel_cliente_id_tanque_id_fkey" FOREIGN KEY ("cliente_id", "tanque_id") REFERENCES "TanqueBem"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TanqueBemCombustivel" ADD CONSTRAINT "TanqueBemCombustivel_cliente_id_combustivel_id_fkey" FOREIGN KEY ("cliente_id", "combustivel_id") REFERENCES "TipoCombustivel"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoCombustivelProduto" ADD CONSTRAINT "TipoCombustivelProduto_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoCombustivelProduto" ADD CONSTRAINT "TipoCombustivelProduto_cliente_id_empresa_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id") REFERENCES "Empresa"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoCombustivelProduto" ADD CONSTRAINT "TipoCombustivelProduto_cliente_id_tipo_combustivel_id_fkey" FOREIGN KEY ("cliente_id", "tipo_combustivel_id") REFERENCES "TipoCombustivel"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TipoCombustivelProduto" ADD CONSTRAINT "TipoCombustivelProduto_cliente_id_produto_id_fkey" FOREIGN KEY ("cliente_id", "produto_id") REFERENCES "Produto"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Domínios fechados e invariantes (CHECK escrito à mão; NULL-safe: cada ramo
-- com IS NOT NULL explícito; nomes ≤ 63 bytes; nenhum ponto e vírgula dentro).
ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_codigo_check" CHECK ("codigo" ~ '^[A-Z0-9_]{2,32}$');
ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_natureza_check" CHECK ("natureza" IN ('BENFEITORIA', 'MAQUINA', 'VEICULO', 'IMPLEMENTO', 'EQUIPAMENTO', 'OUTRO'));
ALTER TABLE "FamiliaPatrimonial" ADD CONSTRAINT "FamiliaPatrimonial_valores_check" CHECK (("ordem" IS NULL OR "ordem" BETWEEN 0 AND 9999) AND ("vida_util_meses_padrao" IS NULL OR "vida_util_meses_padrao" BETWEEN 1 AND 1200) AND "versao" >= 1);

ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_codigo_check" CHECK ("codigo" ~ '^[A-Z0-9_]{2,32}$');
ALTER TABLE "TipoPatrimonial" ADD CONSTRAINT "TipoPatrimonial_valores_check" CHECK (("vida_util_meses_sugerida" IS NULL OR "vida_util_meses_sugerida" BETWEEN 1 AND 1200) AND "versao" >= 1);

ALTER TABLE "TipoPatrimonialPerfil" ADD CONSTRAINT "TipoPatrimonialPerfil_principal_check" CHECK ("principal" IS NULL OR "principal");
ALTER TABLE "TipoPatrimonialPerfil" ADD CONSTRAINT "TipoPatrimonialPerfil_ordem_check" CHECK ("ordem" >= 0);

ALTER TABLE "PerfilMedicao" ADD CONSTRAINT "PerfilMedicao_codigo_check" CHECK ("codigo" ~ '^[A-Z0-9_]{2,32}$');
ALTER TABLE "PerfilMedicao" ADD CONSTRAINT "PerfilMedicao_finalidade_check" CHECK ("finalidade" IN ('DIMENSAO', 'CAPACIDADE'));
ALTER TABLE "PerfilMedicao" ADD CONSTRAINT "PerfilMedicao_dimensao_check" CHECK (("dimensao" = 'EXTENSAO' AND "unidade_canonica" = 'm') OR ("dimensao" = 'AREA' AND "unidade_canonica" = 'm2') OR ("dimensao" = 'VOLUME' AND "unidade_canonica" = 'L') OR ("dimensao" = 'MASSA' AND "unidade_canonica" = 'kg') OR ("dimensao" = 'QUANTIDADE' AND "unidade_canonica" = 'un') OR ("dimensao" = 'CABECAS' AND "unidade_canonica" = 'cab'));
ALTER TABLE "PerfilMedicao" ADD CONSTRAINT "PerfilMedicao_unidades_check" CHECK ("unidades_permitidas" IS NOT NULL AND cardinality("unidades_permitidas") >= 1 AND "unidade_canonica" = ANY("unidades_permitidas") AND "unidades_permitidas" <@ ARRAY['m','km','m2','ha','L','m3','kg','t','un','cab']::TEXT[]);
ALTER TABLE "PerfilMedicao" ADD CONSTRAINT "PerfilMedicao_unidades_dimensao_check" CHECK (("dimensao" = 'EXTENSAO' AND "unidades_permitidas" <@ ARRAY['m','km']::TEXT[]) OR ("dimensao" = 'AREA' AND "unidades_permitidas" <@ ARRAY['m2','ha']::TEXT[]) OR ("dimensao" = 'VOLUME' AND "unidades_permitidas" <@ ARRAY['L','m3']::TEXT[]) OR ("dimensao" = 'MASSA' AND "unidades_permitidas" <@ ARRAY['kg','t']::TEXT[]) OR ("dimensao" = 'QUANTIDADE' AND "unidades_permitidas" <@ ARRAY['un']::TEXT[]) OR ("dimensao" = 'CABECAS' AND "unidades_permitidas" <@ ARRAY['cab']::TEXT[]));
ALTER TABLE "PerfilMedicao" ADD CONSTRAINT "PerfilMedicao_versao_check" CHECK ("versao" >= 1);

ALTER TABLE "TipoCombustivel" ADD CONSTRAINT "TipoCombustivel_codigo_check" CHECK ("codigo" ~ '^[A-Z0-9_]{2,32}$');
ALTER TABLE "TipoCombustivel" ADD CONSTRAINT "TipoCombustivel_unidade_check" CHECK ("unidade" IN ('L', 'm3'));
ALTER TABLE "TipoCombustivel" ADD CONSTRAINT "TipoCombustivel_versao_check" CHECK ("versao" >= 1);

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

ALTER TABLE "MedicaoBem" ADD CONSTRAINT "MedicaoBem_principal_check" CHECK ("principal" IS NULL OR "principal");
ALTER TABLE "MedicaoBem" ADD CONSTRAINT "MedicaoBem_valores_check" CHECK ("valor_informado" > 0 AND "valor_normalizado" > 0);
ALTER TABLE "MedicaoBem" ADD CONSTRAINT "MedicaoBem_unidades_check" CHECK (("unidade_canonica" = 'm' AND "unidade_informada" IN ('m', 'km')) OR ("unidade_canonica" = 'm2' AND "unidade_informada" IN ('m2', 'ha')) OR ("unidade_canonica" = 'L' AND "unidade_informada" IN ('L', 'm3')) OR ("unidade_canonica" = 'kg' AND "unidade_informada" IN ('kg', 't')) OR ("unidade_canonica" = 'un' AND "unidade_informada" = 'un') OR ("unidade_canonica" = 'cab' AND "unidade_informada" = 'cab'));
ALTER TABLE "MedicaoBem" ADD CONSTRAINT "MedicaoBem_normalizado_check" CHECK ("valor_normalizado" = "valor_informado" * (CASE "unidade_informada" WHEN 'km' THEN 1000 WHEN 'ha' THEN 10000 WHEN 'm3' THEN 1000 WHEN 't' THEN 1000 ELSE 1 END));

ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_capacidade_check" CHECK ("capacidade_litros" > 0);
ALTER TABLE "TanqueBem" ADD CONSTRAINT "TanqueBem_identificador_check" CHECK (char_length(btrim("identificador")) > 0);

ALTER TABLE "TipoCombustivelProduto" ADD CONSTRAINT "TipoCombustivelProduto_ativo_chave_check" CHECK (("ativo" AND "ativo_chave" IS TRUE) OR (NOT "ativo" AND "ativo_chave" IS NULL));
ALTER TABLE "TipoCombustivelProduto" ADD CONSTRAINT "TipoCombustivelProduto_versao_check" CHECK ("versao" >= 1);

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['BemPatrimonial','FamiliaPatrimonial','MedicaoBem','PerfilMedicao','TanqueBem','TanqueBemCombustivel','TipoCombustivel','TipoCombustivelProduto','TipoPatrimonial','TipoPatrimonialPerfil'];
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
