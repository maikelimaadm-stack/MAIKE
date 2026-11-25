-- MAIKE-SINCRONIZACAO-INDICES — índices da sincronização incremental (`GET /…/mudancas`, Etapa 2 da sincronização).
-- Decisão, relatório e runbook em docs/engineering/ (MAIKE-SINCRONIZACAO-INDICES-*.md). O número da decisão fica FORA
-- deste arquivo de propósito: renumerar a decisão nunca muda o checksum.
--
-- EXPAND-ONLY: só CREATE INDEX não-único em tabelas existentes, tenant primeiro (R10). Nenhuma tabela, coluna,
-- constraint, dado, função, gatilho, RLS ou GRANT muda. Sem CONCURRENTLY (o classificador da release não aceita).
--
-- Por quê: a cada sincronização o aparelho pede só o que mudou desde a última marca. A consulta é
--   WHERE cliente_id = ? AND "updatedAt" >= ? [AND ("updatedAt", id) > cursor] ORDER BY "updatedAt", id LIMIT n
-- nas 4 listas, e as exclusões do período saem do AuditLog por
--   WHERE cliente_id = ? AND entidade = ? AND acao = 'delete' AND "createdAt" >= ? ORDER BY "createdAt", id.
-- Sem estes índices, com milhões de registros, cada sincronização leria a tabela inteira do cliente.
--
-- Travas: o Prisma aplica o arquivo numa transação só. Cada CREATE INDEX toma SHARE LOCK na tabela dele até o COMMIT:
-- leituras seguem; ESCRITAS nas 5 tabelas esperam até o fim da migration. Ordem: as tabelas do domínio primeiro e o
-- AuditLog por último (a mesma ordem dos comandos, que gravam o registro e auditam no fim), para não formar ciclo de
-- espera. Janela e tempo: runbook.
--
-- Reversão operacional (não executada em produção): DROP INDEX dos 5.

-- CreateIndex
CREATE INDEX "Lote_cliente_id_updatedAt_id_idx" ON "Lote"("cliente_id", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "PontoSuplementacao_cliente_id_updatedAt_id_idx" ON "PontoSuplementacao"("cliente_id", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "LEITURACOCHO_cliente_id_updatedAt_id_idx" ON "LEITURACOCHO"("cliente_id", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "SuplementacaoEvento_cliente_id_updatedAt_id_idx" ON "SuplementacaoEvento"("cliente_id", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_cliente_id_entidade_acao_createdAt_id_idx" ON "AuditLog"("cliente_id", "entidade", "acao", "createdAt", "id");
