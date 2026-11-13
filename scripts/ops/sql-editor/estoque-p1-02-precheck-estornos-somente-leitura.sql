-- =============================================================================
-- MAIKE · Estoque P1-02 · PRECHECK DOS ESTORNOS (SOMENTE LEITURA)     D-PROD-177
-- -----------------------------------------------------------------------------
-- Por quê: a P1-02 endurece os estornos do motor (contrato §2 M5 e §6.2 item 8).
-- Cancelar, retificar ou excluir um lançamento CONFIRMADO com mercadoria agora
-- RECUSA (409 ESTOQUE_JA_CONSUMIDO, nada é alterado) quando:
--   - o movimento original do item não está 'Ativa' ou já tem filho
--     (reasons original_nao_ativo / original_ja_estornado);
--   - o movimento original é de outra empresa ou de outro produto que o item
--     (reason vinculo_divergente);
--   - a camada (lote) do item, ou de um consumo da venda, é de outra empresa,
--     outro produto ou outro local que o item (reason camada_divergente).
-- O motor só grava dados coerentes, então o esperado é ZERO linha problemática.
-- Este SELECT confirma isso em produção ANTES do deploy.
--
-- REGRA: rodar em PRODUÇÃO só com GO explícito do proprietário. Sem GO, só em
-- banco local/descartável (validação de sintaxe).
-- Onde: Supabase → projeto MAIKE → SQL Editor → New query → cole TUDO → Run.
-- O que faz: um único SELECT. Nenhum DDL, nenhum DML, nenhuma trava de escrita.
-- Não mostra nome, documento nem valor: só cliente_id, ids técnicos e o motivo.
--
-- Resultado: uma linha por (cliente_id, motivo) com a contagem e até 5 ids de
-- lançamento de exemplo; sem problema, uma única linha 'NENHUM'.
-- O que fazer: com 'NENHUM', nada a fazer. Com qualquer outra linha, NÃO
-- corrigir por SQL: levar ao proprietário. Esses lançamentos não poderão ser
-- cancelados, retificados nem excluídos até uma decisão própria.
-- =============================================================================
WITH
itens AS (
  SELECT o.cliente_id, o.id AS operacao_id, o.empresa_id, o.direcao,
         i.id AS item_id, i.produto_id, i.local_estoque_id,
         i.movimentacao_estoque_id, i.estoque_lote_nota_id
  FROM public."OperacaoFinanceira" o
  JOIN public."OperacaoFinanceiraItem" i
    ON i.cliente_id = o.cliente_id AND i.operacao_id = o.id
  WHERE o.status = 'CONFIRMADO'
    AND i.tipo_item = 'MERCADORIA'
    AND i.movimentacao_estoque_id IS NOT NULL
),
problemas AS (
  -- Movimento original fora do estado estornável.
  SELECT it.cliente_id, it.operacao_id,
         CASE WHEN m.id IS NULL THEN 'original_inexistente'
              WHEN m.movimento_filho_id IS NOT NULL OR m.status = 'Estornada' THEN 'original_ja_estornado'
              ELSE 'original_nao_ativo' END AS motivo
  FROM itens it
  LEFT JOIN public."MovimentacaoEstoque" m
    ON m.cliente_id = it.cliente_id AND m.id = it.movimentacao_estoque_id
  WHERE m.id IS NULL OR m.status IS DISTINCT FROM 'Ativa' OR m.movimento_filho_id IS NOT NULL
  UNION ALL
  -- Movimento original de outra empresa ou outro produto.
  SELECT it.cliente_id, it.operacao_id, 'vinculo_divergente'
  FROM itens it
  JOIN public."MovimentacaoEstoque" m
    ON m.cliente_id = it.cliente_id AND m.id = it.movimentacao_estoque_id
  WHERE m.empresa_id IS DISTINCT FROM it.empresa_id OR m.produto_id IS DISTINCT FROM it.produto_id
  UNION ALL
  -- Camada da COMPRA (lote do próprio item) divergente.
  SELECT it.cliente_id, it.operacao_id, 'camada_divergente'
  FROM itens it
  JOIN public."EstoqueLoteNota" l
    ON l.cliente_id = it.cliente_id AND l.id = it.estoque_lote_nota_id
  WHERE it.direcao = 'PAGAR'
    AND (l.empresa_id IS DISTINCT FROM it.empresa_id
         OR l.produto_id IS DISTINCT FROM it.produto_id
         OR l.local_estoque_id IS DISTINCT FROM it.local_estoque_id)
  UNION ALL
  -- Camadas da VENDA (lotes dos consumos FIFO) divergentes.
  SELECT it.cliente_id, it.operacao_id, 'camada_divergente'
  FROM itens it
  JOIN public."OperacaoFinanceiraConsumoLote" c
    ON c.cliente_id = it.cliente_id AND c.item_id = it.item_id
  JOIN public."EstoqueLoteNota" l
    ON l.cliente_id = c.cliente_id AND l.id = c.estoque_lote_nota_id
  WHERE it.direcao <> 'PAGAR'
    AND (l.empresa_id IS DISTINCT FROM it.empresa_id
         OR l.produto_id IS DISTINCT FROM it.produto_id
         OR l.local_estoque_id IS DISTINCT FROM it.local_estoque_id)
),
resumo AS (
  SELECT cliente_id, motivo,
         count(DISTINCT operacao_id) AS lancamentos,
         (array_agg(DISTINCT operacao_id ORDER BY operacao_id))[1:5] AS exemplos
  FROM problemas
  GROUP BY cliente_id, motivo
)
SELECT cliente_id, motivo, lancamentos, exemplos
FROM resumo
UNION ALL
SELECT 'NENHUM', 'nenhum lançamento confirmado seria recusado pelos estornos endurecidos', 0, ARRAY[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM resumo)
ORDER BY 1, 2;
