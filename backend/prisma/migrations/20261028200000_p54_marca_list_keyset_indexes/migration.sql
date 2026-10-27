-- D-PROD-54: índices para listagem keyset de Marca (createdAt, id) por tenant/empresa
CREATE INDEX "Marca_cliente_id_empresa_id_createdAt_id_idx" ON "Marca"("cliente_id", "empresa_id", "createdAt", "id");
CREATE INDEX "Marca_cliente_id_createdAt_id_idx" ON "Marca"("cliente_id", "createdAt", "id");
