-- CreateTable
CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "apelido" VARCHAR(255) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "tipo_pessoa" VARCHAR(32) NOT NULL DEFAULT 'Jurídica',
    "cpf" VARCHAR(32),
    "rg" VARCHAR(32),
    "cnpj" VARCHAR(32),
    "inscricao_estadual" VARCHAR(64),
    "telefone" VARCHAR(64),
    "email" VARCHAR(255),
    "endereco" VARCHAR(255),
    "cidade" VARCHAR(128),
    "estado" VARCHAR(8),
    "cep" VARCHAR(16),
    "logotipo_url" VARCHAR(2000),
    "observacoes" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permissao" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "user_email" VARCHAR(255) NOT NULL,
    "user_nome" VARCHAR(255),
    "modulos_permitidos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "permissoes_telas" JSONB NOT NULL DEFAULT '[]',
    "mobile_menu_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "mapa_geral_permissoes" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Permissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_cadastro" VARCHAR(32) NOT NULL,
    "tipo_pessoa" VARCHAR(32) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "cpf" VARCHAR(32),
    "rg" VARCHAR(32),
    "data_nascimento" DATE,
    "cnpj" VARCHAR(32),
    "razao_social" VARCHAR(255),
    "inscricao_estadual" VARCHAR(64),
    "nome_responsavel" VARCHAR(255),
    "telefone" VARCHAR(64),
    "email" VARCHAR(255),
    "endereco" VARCHAR(255),
    "cidade" VARCHAR(128),
    "codigo_ibge" VARCHAR(16),
    "estado" VARCHAR(8),
    "cep" VARCHAR(16),
    "observacoes" VARCHAR(2000),
    "tipos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoriaManejo" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "sigla" VARCHAR(32),
    "especie" VARCHAR(128),
    "sexo" VARCHAR(32),
    "raca" VARCHAR(128),
    "idade_minima_meses" INTEGER,
    "idade_maxima_meses" INTEGER,
    "categoria_oficial" VARCHAR(128),
    "ganho_peso_anual_kg" DECIMAL(14,4),
    "gmd_janeiro" DECIMAL(14,4),
    "gmd_fevereiro" DECIMAL(14,4),
    "gmd_marco" DECIMAL(14,4),
    "gmd_abril" DECIMAL(14,4),
    "gmd_maio" DECIMAL(14,4),
    "gmd_junho" DECIMAL(14,4),
    "gmd_julho" DECIMAL(14,4),
    "gmd_agosto" DECIMAL(14,4),
    "gmd_setembro" DECIMAL(14,4),
    "gmd_outubro" DECIMAL(14,4),
    "gmd_novembro" DECIMAL(14,4),
    "gmd_dezembro" DECIMAL(14,4),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoriaManejo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bebedouro" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "ponto_referencia_id" VARCHAR(64),
    "nome" VARCHAR(255) NOT NULL,
    "codigo_interno" VARCHAR(64),
    "pasto_id" VARCHAR(64),
    "pasto_nome" VARCHAR(255),
    "area_vinculada_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "area_vinculada_nomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "setor_id" VARCHAR(64),
    "setor_nome" VARCHAR(255),
    "tipo" VARCHAR(64) NOT NULL,
    "capacidade_litros" DECIMAL(14,4),
    "origem_agua" VARCHAR(64),
    "coordenadas" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'Ativo',
    "periodicidade_limpeza" VARCHAR(32) DEFAULT 'Mensal',
    "periodicidade_inspecao" VARCHAR(32) DEFAULT 'Semanal',
    "dias_limpeza_personalizado" INTEGER,
    "dias_inspecao_personalizado" INTEGER,
    "observacoes" VARCHAR(2000),
    "fotos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bebedouro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PontoSuplementacao" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_ponto" VARCHAR(32) NOT NULL,
    "setor_id" VARCHAR(64),
    "setor_nome" VARCHAR(255),
    "nome_ponto" VARCHAR(255) NOT NULL,
    "sigla" VARCHAR(32),
    "categoria_ponto" VARCHAR(32) NOT NULL DEFAULT 'COCHO',
    "tipo" VARCHAR(128),
    "produto_padrao" VARCHAR(255),
    "capacidade_cocho_kg" DECIMAL(14,4),
    "estoque_minimo_kg" DECIMAL(14,4),
    "metragem_cocho_m" DECIMAL(14,4),
    "cobertura_cocho" VARCHAR(32),
    "area_vinculada_id" VARCHAR(64),
    "area_vinculada_nome" VARCHAR(255),
    "area_vinculada_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "area_vinculada_nomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deposito_origem_id" VARCHAR(64),
    "deposito_origem_nome" VARCHAR(255),
    "local_estoque_id" VARCHAR(64),
    "local_estoque_nome" VARCHAR(255),
    "consumo_ideal_por_cabeca_kg" DECIMAL(14,4),
    "limite_minimo_consumo" DECIMAL(14,4),
    "limite_maximo_consumo" DECIMAL(14,4),
    "dias_alerta_reposicao" INTEGER DEFAULT 3,
    "alerta_sem_lancamento_dias" INTEGER DEFAULT 10,
    "coordenadas" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'Ativo',
    "observacoes" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PontoSuplementacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstoqueLoteNota" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "produto_nome" VARCHAR(255),
    "local_estoque_id" VARCHAR(64) NOT NULL,
    "local_estoque_nome" VARCHAR(255),
    "numero_documento" VARCHAR(64),
    "serie_documento" VARCHAR(32),
    "data_documento" DATE,
    "fornecedor_id" VARCHAR(64),
    "fornecedor_nome" VARCHAR(255),
    "custo_unitario" DECIMAL(14,4) NOT NULL,
    "quantidade_entrada" DECIMAL(14,4) NOT NULL,
    "quantidade_disponivel" DECIMAL(14,4) NOT NULL,
    "movimentacao_entrada_id" VARCHAR(64),
    "status" VARCHAR(32) NOT NULL DEFAULT 'Disponivel',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueLoteNota_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimentacaoEstoque" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "numero_movimentacao" VARCHAR(32) NOT NULL,
    "tipo_movimentacao" VARCHAR(32) NOT NULL,
    "tipo_detalhado" VARCHAR(128),
    "tipo_documento" VARCHAR(64),
    "numero_documento" VARCHAR(64),
    "chave_documento" VARCHAR(2000),
    "data_documento" DATE,
    "data_movimentacao" TIMESTAMP(3) NOT NULL,
    "produto_id" VARCHAR(64) NOT NULL,
    "produto_nome" VARCHAR(255),
    "produto_codigo" VARCHAR(64),
    "produto_categoria" VARCHAR(255),
    "quantidade" DECIMAL(14,4) NOT NULL,
    "unidade_medida" VARCHAR(32) NOT NULL,
    "valor_unitario" DECIMAL(14,4),
    "valor_total" DECIMAL(14,4),
    "local_origem" VARCHAR(255),
    "local_destino" VARCHAR(255),
    "local_estoque_origem" VARCHAR(255),
    "local_estoque_destino" VARCHAR(255),
    "custo_medio_antes" DECIMAL(14,4),
    "custo_medio_depois" DECIMAL(14,4),
    "saldo_antes" DECIMAL(14,4),
    "saldo_depois" DECIMAL(14,4),
    "fornecedor_id" VARCHAR(64),
    "fornecedor_nome" VARCHAR(255),
    "cliente_nome" VARCHAR(255),
    "safra_id" VARCHAR(64),
    "safra_nome" VARCHAR(255),
    "centro_custo_id" VARCHAR(64),
    "centro_custo_nome" VARCHAR(255),
    "lancamento_origem_id" VARCHAR(64),
    "motivo_movimentacao" VARCHAR(255),
    "observacoes" VARCHAR(2000),
    "responsavel" VARCHAR(255),
    "usuario_responsavel" VARCHAR(255),
    "status" VARCHAR(32) NOT NULL DEFAULT 'Ativa',
    "vinculado" BOOLEAN NOT NULL DEFAULT false,
    "tipo_vinculo" VARCHAR(32),
    "lote_vinculado_id" VARCHAR(64),
    "lote_vinculado_nome" VARCHAR(255),
    "area_vinculada_id" VARCHAR(64),
    "area_vinculada_nome" VARCHAR(255),
    "maquina_vinculada_id" VARCHAR(64),
    "maquina_vinculada_nome" VARCHAR(255),
    "origem_sistema" VARCHAR(32) NOT NULL DEFAULT 'manual',
    "deposito_id" VARCHAR(64),
    "ponto_suplementacao_id" VARCHAR(64),
    "movimento_pai_id" VARCHAR(64),
    "movimento_filho_id" VARCHAR(64),
    "bloqueado_exclusao_estoque" BOOLEAN NOT NULL DEFAULT false,
    "exclusao_somente_em" VARCHAR(32),
    "movimentacao_grupo_id" VARCHAR(64),
    "numero_movimentacao_seq" INTEGER,
    "total_movimentacoes_grupo" INTEGER,
    "is_registro_principal" BOOLEAN NOT NULL DEFAULT false,
    "modo_saida_fifo" VARCHAR(32),
    "lotes_consumidos" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovimentacaoEstoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Empresa_cliente_id_apelido_idx" ON "Empresa"("cliente_id", "apelido");

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_cliente_id_id_key" ON "Empresa"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Empresa_cliente_id_nome_key" ON "Empresa"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Permissao_cliente_id_id_key" ON "Permissao"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Permissao_cliente_id_user_email_key" ON "Permissao"("cliente_id", "user_email");

-- CreateIndex
CREATE INDEX "Fornecedor_cliente_id_empresa_id_idx" ON "Fornecedor"("cliente_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_cliente_id_id_key" ON "Fornecedor"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_cliente_id_numero_cadastro_key" ON "Fornecedor"("cliente_id", "numero_cadastro");

-- CreateIndex
CREATE INDEX "CategoriaManejo_cliente_id_empresa_id_idx" ON "CategoriaManejo"("cliente_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "CategoriaManejo_cliente_id_id_key" ON "CategoriaManejo"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "Bebedouro_cliente_id_empresa_id_idx" ON "Bebedouro"("cliente_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "Bebedouro_cliente_id_id_key" ON "Bebedouro"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "PontoSuplementacao_cliente_id_empresa_id_idx" ON "PontoSuplementacao"("cliente_id", "empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "PontoSuplementacao_cliente_id_id_key" ON "PontoSuplementacao"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PontoSuplementacao_cliente_id_numero_ponto_key" ON "PontoSuplementacao"("cliente_id", "numero_ponto");

-- CreateIndex
CREATE INDEX "EstoqueLoteNota_cliente_id_empresa_id_idx" ON "EstoqueLoteNota"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "EstoqueLoteNota_cliente_id_produto_id_idx" ON "EstoqueLoteNota"("cliente_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "EstoqueLoteNota_cliente_id_id_key" ON "EstoqueLoteNota"("cliente_id", "id");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_cliente_id_empresa_id_idx" ON "MovimentacaoEstoque"("cliente_id", "empresa_id");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_cliente_id_produto_id_idx" ON "MovimentacaoEstoque"("cliente_id", "produto_id");

-- CreateIndex
CREATE INDEX "MovimentacaoEstoque_cliente_id_data_movimentacao_idx" ON "MovimentacaoEstoque"("cliente_id", "data_movimentacao");

-- CreateIndex
CREATE UNIQUE INDEX "MovimentacaoEstoque_cliente_id_id_key" ON "MovimentacaoEstoque"("cliente_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MovimentacaoEstoque_cliente_id_numero_movimentacao_key" ON "MovimentacaoEstoque"("cliente_id", "numero_movimentacao");

-- AddForeignKey
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permissao" ADD CONSTRAINT "Permissao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fornecedor" ADD CONSTRAINT "Fornecedor_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoriaManejo" ADD CONSTRAINT "CategoriaManejo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bebedouro" ADD CONSTRAINT "Bebedouro_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PontoSuplementacao" ADD CONSTRAINT "PontoSuplementacao_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueLoteNota" ADD CONSTRAINT "EstoqueLoteNota_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

