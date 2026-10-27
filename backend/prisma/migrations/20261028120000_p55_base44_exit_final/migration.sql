-- P5.5 — saída final Base44: manejo, suplementação, bebedouro satélite.

CREATE TABLE "MovimentacaoMapa" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovimentacaoMapa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MovimentacaoPecuaria" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovimentacaoPecuaria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuplementacaoEvento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuplementacaoEvento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SuplementacaoLote" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuplementacaoLote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AplicacaoMedicamento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AplicacaoMedicamento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventoSanitario" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventoSanitario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ManejoTecnicoRebanho" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManejoTecnicoRebanho_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BebedouroHistorico" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BebedouroHistorico_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BebedouroSanidade" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BebedouroSanidade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BebedouroAlerta" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "dados" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BebedouroAlerta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MovimentacaoMapa_cliente_id_id_key" ON "MovimentacaoMapa"("cliente_id", "id");
CREATE INDEX "MovimentacaoMapa_cliente_id_empresa_id_idx" ON "MovimentacaoMapa"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "MovimentacaoPecuaria_cliente_id_id_key" ON "MovimentacaoPecuaria"("cliente_id", "id");
CREATE INDEX "MovimentacaoPecuaria_cliente_id_empresa_id_idx" ON "MovimentacaoPecuaria"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "SuplementacaoEvento_cliente_id_id_key" ON "SuplementacaoEvento"("cliente_id", "id");
CREATE INDEX "SuplementacaoEvento_cliente_id_empresa_id_idx" ON "SuplementacaoEvento"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "SuplementacaoLote_cliente_id_id_key" ON "SuplementacaoLote"("cliente_id", "id");
CREATE INDEX "SuplementacaoLote_cliente_id_empresa_id_idx" ON "SuplementacaoLote"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "AplicacaoMedicamento_cliente_id_id_key" ON "AplicacaoMedicamento"("cliente_id", "id");
CREATE INDEX "AplicacaoMedicamento_cliente_id_empresa_id_idx" ON "AplicacaoMedicamento"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "EventoSanitario_cliente_id_id_key" ON "EventoSanitario"("cliente_id", "id");
CREATE INDEX "EventoSanitario_cliente_id_empresa_id_idx" ON "EventoSanitario"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "ManejoTecnicoRebanho_cliente_id_id_key" ON "ManejoTecnicoRebanho"("cliente_id", "id");
CREATE INDEX "ManejoTecnicoRebanho_cliente_id_empresa_id_idx" ON "ManejoTecnicoRebanho"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "BebedouroHistorico_cliente_id_id_key" ON "BebedouroHistorico"("cliente_id", "id");
CREATE INDEX "BebedouroHistorico_cliente_id_empresa_id_idx" ON "BebedouroHistorico"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "BebedouroSanidade_cliente_id_id_key" ON "BebedouroSanidade"("cliente_id", "id");
CREATE INDEX "BebedouroSanidade_cliente_id_empresa_id_idx" ON "BebedouroSanidade"("cliente_id", "empresa_id");

CREATE UNIQUE INDEX "BebedouroAlerta_cliente_id_id_key" ON "BebedouroAlerta"("cliente_id", "id");
CREATE INDEX "BebedouroAlerta_cliente_id_empresa_id_idx" ON "BebedouroAlerta"("cliente_id", "empresa_id");

ALTER TABLE "MovimentacaoMapa" ADD CONSTRAINT "MovimentacaoMapa_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimentacaoPecuaria" ADD CONSTRAINT "MovimentacaoPecuaria_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SuplementacaoEvento" ADD CONSTRAINT "SuplementacaoEvento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SuplementacaoLote" ADD CONSTRAINT "SuplementacaoLote_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AplicacaoMedicamento" ADD CONSTRAINT "AplicacaoMedicamento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventoSanitario" ADD CONSTRAINT "EventoSanitario_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ManejoTecnicoRebanho" ADD CONSTRAINT "ManejoTecnicoRebanho_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BebedouroHistorico" ADD CONSTRAINT "BebedouroHistorico_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BebedouroSanidade" ADD CONSTRAINT "BebedouroSanidade_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BebedouroAlerta" ADD CONSTRAINT "BebedouroAlerta_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
