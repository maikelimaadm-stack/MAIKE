-- MAIKE-ESTOQUE-P1-03 (contrato do Estoque P1, M7) — índices EXPAND-ONLY.
--
-- Só CREATE INDEX não-único em tabelas existentes, tenant primeiro (R10).
-- Nenhuma tabela, coluna, constraint, dado, função, gatilho, RLS ou GRANT muda.
-- Sem CONCURRENTLY (o classificador da release não aceita). O Prisma aplica o
-- arquivo numa transação só: o 1º CREATE INDEX toma SHARE LOCK em
-- "OperacaoIdempotente", o 2º em "MovimentacaoEstoque", e os dois só saem no
-- COMMIT. Leituras seguem; ESCRITAS nas DUAS tabelas esperam até o fim da
-- migration inteira (os dois builds somados, mais qualquer espera pela trava da
-- 2ª tabela). Ordem recibos → movimentos: a mesma dos comandos (o recibo é a
-- 1ª escrita), para não formar ciclo de espera. Janela e tempo: runbook
-- MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md.
--
-- 1. LC-2: recibos de comando de estoque por tipo dentro de intervalos de
--    `createdAt` (reconciliação: tipo_operacao = ANY(...) AND createdAt entre
--    ini e fim). Antes só havia (cliente_id, createdAt): o intervalo inteiro,
--    de qualquer tipo, era lido e filtrado.
CREATE INDEX "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx" ON "OperacaoIdempotente"("cliente_id", "tipo_operacao", "createdAt");

-- 2. Keyset da futura central de movimentos (P1-04): empresa obrigatória,
--    cursor (data_movimentacao, id), ordem DESC/DESC.
CREATE INDEX "MovimentacaoEstoque_keyset_empresa_idx" ON "MovimentacaoEstoque"("cliente_id", "empresa_id", "data_movimentacao" DESC, "id" DESC);
