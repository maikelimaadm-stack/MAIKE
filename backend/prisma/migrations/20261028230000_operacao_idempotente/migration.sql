-- ESTAB-P0-01: catálogo durável de idempotência para comandos compostos.

CREATE TABLE "OperacaoIdempotente" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "operation_key" VARCHAR(128) NOT NULL,
    "tipo_operacao" VARCHAR(64) NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "http_status" INTEGER,
    "response_json" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperacaoIdempotente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperacaoIdempotente_cliente_id_operation_key_tipo_operacao_key" ON "OperacaoIdempotente"("cliente_id", "operation_key", "tipo_operacao");

CREATE INDEX "OperacaoIdempotente_cliente_id_createdAt_idx" ON "OperacaoIdempotente"("cliente_id", "createdAt");

ALTER TABLE "OperacaoIdempotente" ADD CONSTRAINT "OperacaoIdempotente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
