-- =============================================================================
-- MAIKE · Estoque P1-02 · PRECHECK DOS ESTORNOS (SOMENTE LEITURA)     D-PROD-177
-- -----------------------------------------------------------------------------
-- Por quê: a P1-02 endurece os estornos do motor (contrato §2 M5 e §6.2 item 8)
-- nos DOIS caminhos que estornam estoque hoje:
--   FINANCEIRO    cancelar/retificar/excluir lançamento CONFIRMADO com mercadoria
--                 (OperacaoFinanceira → estorno em lote);
--   ABASTECIMENTO cancelar abastecimento CONFIRMADO (AbastecimentoBem →
--                 estornarSaida, fatia a fatia).
-- O estorno RECUSA (409, nada é alterado) quando:
--   - o movimento original não existe, não está 'Ativa' ou já tem filho
--     (original_inexistente / original_nao_ativo / original_ja_estornado);
--   - o movimento original é de outra empresa ou de outro produto que o
--     documento (vinculo_divergente);
--   - a camada (lote) do item da compra, ou de uma fatia da venda/do
--     abastecimento, é de outra empresa, outro produto ou outro local
--     (camada_divergente);
--   - as fatias gravadas não fecham com a quantidade (fatias_inconsistentes),
--     um lote de fatia não aceita devolução (lote_indisponivel_para_devolucao)
--     ou a devolução passaria da entrada do lote (devolucao_excede_entrada).
-- Coluna `efeito`:
--   NOVA_RECUSA  passa a ser recusado com a P1-02 (antes era aceito): é o
--                impacto do release;
--   JA_RECUSAVA  já era recusado antes (só aparece para o quadro ficar completo).
--   O efeito é do MOTIVO: um documento listado em NOVA_RECUSA pode já ser
--   recusado por outro motivo anterior (ex.: lote da compra consumido); cruze
--   os ids de exemplo entre as linhas antes de concluir o impacto.
-- Fora do relatório, de propósito: compra cujo lote já foi consumido
-- (lote_consumido). É a recusa NORMAL de quem já usou o estoque, não um dado
-- incoerente, e não mudou na P1-02.
--
-- REGRA: rodar em PRODUÇÃO só com GO explícito do proprietário. Sem GO, só em
-- banco local/descartável (validação de sintaxe e de resultado).
-- Onde: Supabase → projeto MAIKE → SQL Editor → New query → cole TUDO → Run.
-- O que faz: um único SELECT. Nenhum DDL, nenhum DML, nenhuma trava de escrita,
-- nenhuma função que altere estado.
-- Não mostra nome, documento nem valor: só origem, cliente_id, motivo, a
-- contagem de documentos e até 5 ids técnicos de exemplo.
--
-- Resultado: uma linha por (origem, efeito, cliente_id, motivo); sem problema,
-- uma única linha 'NENHUM'.
-- O que fazer: com 'NENHUM', nada a fazer. Com qualquer outra linha, NÃO
-- corrigir por SQL: levar ao proprietário. Esses documentos não poderão ser
-- cancelados (nem retificados/excluídos, no financeiro) até uma decisão própria.
-- =============================================================================
WITH
-- ── Documentos confirmados que têm estorno físico ──────────────────────────
fin AS (
  SELECT 'FINANCEIRO'::text AS origem, o.cliente_id, o.id AS doc_id, o.empresa_id,
         o.direcao, i.id AS item_id, i.produto_id, i.local_estoque_id,
         i.quantidade_estoque AS quantidade, i.movimentacao_estoque_id, i.estoque_lote_nota_id
  FROM public."OperacaoFinanceira" o
  JOIN public."OperacaoFinanceiraItem" i
    ON i.cliente_id = o.cliente_id AND i.operacao_id = o.id
  WHERE o.status = 'CONFIRMADO'
    AND i.tipo_item = 'MERCADORIA'
    AND i.movimentacao_estoque_id IS NOT NULL
),
abast AS (
  SELECT 'ABASTECIMENTO'::text AS origem, a.cliente_id, a.id AS doc_id, a.empresa_id,
         a.produto_id, a.local_estoque_id, a.quantidade, a.movimentacao_estoque_id
  FROM public."AbastecimentoBem" a
  WHERE a.status = 'CONFIRMADO'
),
-- Linha comum: (origem, documento, empresa, produto, local, original)
linhas AS (
  SELECT origem, cliente_id, doc_id, empresa_id, produto_id, local_estoque_id, movimentacao_estoque_id FROM fin
  UNION ALL
  SELECT origem, cliente_id, doc_id, empresa_id, produto_id, local_estoque_id, movimentacao_estoque_id FROM abast
),
-- Fatias das SAÍDAS (venda do financeiro e abastecimento), com a quantidade da linha
fatias AS (
  SELECT f.origem, f.cliente_id, f.doc_id, f.item_id AS linha_id, f.empresa_id, f.produto_id, f.local_estoque_id,
         f.quantidade, c.estoque_lote_nota_id, c.quantidade AS qtd_fatia
  FROM fin f
  JOIN public."OperacaoFinanceiraConsumoLote" c
    ON c.cliente_id = f.cliente_id AND c.item_id = f.item_id
  WHERE f.direcao <> 'PAGAR'
  UNION ALL
  SELECT a.origem, a.cliente_id, a.doc_id, a.doc_id, a.empresa_id, a.produto_id, a.local_estoque_id,
         a.quantidade, c.estoque_lote_nota_id, c.quantidade
  FROM abast a
  JOIN public."AbastecimentoBemConsumoLote" c
    ON c.cliente_id = a.cliente_id AND c.abastecimento_id = a.doc_id
),
-- Saídas com a soma das fatias (LEFT: saída SEM fatia nenhuma também aparece)
saidas AS (
  SELECT f.origem, f.cliente_id, f.doc_id, f.item_id AS linha_id, f.quantidade FROM fin f WHERE f.direcao <> 'PAGAR'
  UNION ALL
  SELECT a.origem, a.cliente_id, a.doc_id, a.doc_id, a.quantidade FROM abast a
),
problemas AS (
  -- 1. Original fora do estado estornável.
  SELECT l.origem, l.cliente_id, l.doc_id,
         CASE WHEN m.id IS NULL THEN 'original_inexistente'
              WHEN m.movimento_filho_id IS NOT NULL OR m.status = 'Estornada' THEN 'original_ja_estornado'
              ELSE 'original_nao_ativo' END AS motivo,
         CASE WHEN l.origem = 'ABASTECIMENTO' THEN 'JA_RECUSAVA' ELSE 'NOVA_RECUSA' END AS efeito
  FROM linhas l
  LEFT JOIN public."MovimentacaoEstoque" m
    ON m.cliente_id = l.cliente_id AND m.id = l.movimentacao_estoque_id
  WHERE m.id IS NULL OR m.status IS DISTINCT FROM 'Ativa' OR m.movimento_filho_id IS NOT NULL
  UNION ALL
  -- 2. Original de outra empresa ou outro produto.
  SELECT l.origem, l.cliente_id, l.doc_id, 'vinculo_divergente', 'NOVA_RECUSA'
  FROM linhas l
  JOIN public."MovimentacaoEstoque" m
    ON m.cliente_id = l.cliente_id AND m.id = l.movimentacao_estoque_id
  WHERE m.empresa_id IS DISTINCT FROM l.empresa_id OR m.produto_id IS DISTINCT FROM l.produto_id
  UNION ALL
  -- 3a. Camada da COMPRA (lote do próprio item) divergente.
  SELECT f.origem, f.cliente_id, f.doc_id, 'camada_divergente', 'NOVA_RECUSA'
  FROM fin f
  JOIN public."EstoqueLoteNota" l
    ON l.cliente_id = f.cliente_id AND l.id = f.estoque_lote_nota_id
  WHERE f.direcao = 'PAGAR'
    AND (l.empresa_id IS DISTINCT FROM f.empresa_id
         OR l.produto_id IS DISTINCT FROM f.produto_id
         OR l.local_estoque_id IS DISTINCT FROM f.local_estoque_id)
  UNION ALL
  -- 3b. Camadas das SAÍDAS (fatias da venda e do abastecimento) divergentes.
  SELECT x.origem, x.cliente_id, x.doc_id, 'camada_divergente', 'NOVA_RECUSA'
  FROM fatias x
  JOIN public."EstoqueLoteNota" l
    ON l.cliente_id = x.cliente_id AND l.id = x.estoque_lote_nota_id
  WHERE l.empresa_id IS DISTINCT FROM x.empresa_id
     OR l.produto_id IS DISTINCT FROM x.produto_id
     OR l.local_estoque_id IS DISTINCT FROM x.local_estoque_id
  UNION ALL
  -- 4a. Fatias que não fecham com a quantidade da saída (ou nenhuma fatia).
  SELECT s.origem, s.cliente_id, s.doc_id, 'fatias_inconsistentes', 'JA_RECUSAVA'
  FROM saidas s
  LEFT JOIN (SELECT cliente_id, linha_id, sum(qtd_fatia) AS total FROM fatias GROUP BY cliente_id, linha_id) t
    ON t.cliente_id = s.cliente_id AND t.linha_id = s.linha_id
  WHERE t.total IS NULL OR t.total IS DISTINCT FROM s.quantidade
  UNION ALL
  -- 4b. Lote de fatia inexistente ou que não aceita devolução.
  SELECT x.origem, x.cliente_id, x.doc_id, 'lote_indisponivel_para_devolucao', 'JA_RECUSAVA'
  FROM fatias x
  LEFT JOIN public."EstoqueLoteNota" l
    ON l.cliente_id = x.cliente_id AND l.id = x.estoque_lote_nota_id
  WHERE l.id IS NULL OR l.status NOT IN ('Disponivel', 'Esgotado')
  UNION ALL
  -- 4c. Devolução (soma das fatias do DOCUMENTO no lote: o estorno em lote acumula
  --     entre os itens da mesma venda) passaria da entrada do lote.
  SELECT x.origem, x.cliente_id, x.doc_id, 'devolucao_excede_entrada', 'JA_RECUSAVA'
  FROM (SELECT origem, cliente_id, doc_id, estoque_lote_nota_id, sum(qtd_fatia) AS devolver
        FROM fatias GROUP BY origem, cliente_id, doc_id, estoque_lote_nota_id) x
  JOIN public."EstoqueLoteNota" l
    ON l.cliente_id = x.cliente_id AND l.id = x.estoque_lote_nota_id
  WHERE l.quantidade_disponivel + x.devolver > l.quantidade_entrada
),
resumo AS (
  SELECT origem, efeito, cliente_id, motivo,
         count(DISTINCT doc_id) AS documentos,
         (array_agg(DISTINCT doc_id ORDER BY doc_id))[1:5] AS exemplos
  FROM problemas
  GROUP BY origem, efeito, cliente_id, motivo
)
SELECT origem, efeito, cliente_id, motivo, documentos, exemplos
FROM resumo
UNION ALL
SELECT 'NENHUM', '-', '-', 'nenhum documento confirmado (financeiro ou abastecimento) com os motivos verificados', 0, ARRAY[]::text[]
WHERE NOT EXISTS (SELECT 1 FROM resumo)
ORDER BY 1, 2, 3, 4;
