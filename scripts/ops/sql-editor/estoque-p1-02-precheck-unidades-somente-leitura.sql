-- =============================================================================
-- MAIKE · Estoque P1-02 · PRECHECK DE UNIDADES (SOMENTE LEITURA)      D-PROD-177
-- -----------------------------------------------------------------------------
-- Por quê: a P1-02 fecha o domínio da unidade de estoque do Produto em
-- {KG, SACO, L} (contrato MAIKE-ESTOQUE-P1-CONTRATO.md §2 M3 e §5 C1). Produto
-- legado com outra unidade (UN, minúsculas, espaços, NULL, outro texto) continua
-- editável reenviando a MESMA unidade, mas não entra em lançamento com
-- mercadoria (`unidade_produto_invalida`) e não troca para fora do domínio.
-- Este SELECT diz se existe esse legado em produção ANTES do deploy.
--
-- REGRA: rodar em PRODUÇÃO só com GO explícito do proprietário. Sem GO, só em
-- banco local/descartável (validação de sintaxe).
-- Onde: Supabase → projeto MAIKE → SQL Editor → New query → cole TUDO → Run.
-- O que faz: um único SELECT. Nenhum DDL, nenhum DML, nenhuma trava de escrita.
-- Não mostra nome de produto, de pessoa, e-mail nem documento: só cliente_id
-- (identificador técnico), a unidade gravada (entre aspas, para ver espaços)
-- e contagens.
--
-- Colunas (uma linha por cliente_id × unidade fora do domínio):
--   produtos               produtos com essa unidade
--   estoque_diferente_zero quantos deles têm estoque_atual ≠ 0
--   lotes                  linhas de EstoqueLoteNota (qualquer status)
--   movimentos             linhas de MovimentacaoEstoque (qualquer status)
--   itens_por_status       itens de OperacaoFinanceiraItem por status do lançamento
--   aceites_tanque_ativos  aceites ativos em tanque do Patrimônio (TanqueBemProduto)
--   acao                   leitura sugerida da linha
--
-- O que fazer com o resultado:
--   - só a linha "NENHUM": nada a migrar; a P1-02 pode seguir;
--   - produtos sem estoque, lote, movimento nem item: corrigir a unidade pelo
--     Cadastro de Produtos (PATCH para KG, SACO ou L) — sem SQL de escrita;
--   - com estoque, lote, movimento ou item: NÃO corrigir por SQL. Levar o
--     resultado ao proprietário; a migração desses dados exige decisão e GO
--     próprios (troca envolvendo L só sem histórico, D-PROD-162; nada de
--     conversão L ↔ KG). Itens em RASCUNHO/CONFIRMADO desses produtos deixam de
--     planejar (prévia, confirmação e retificação) até a correção.
-- =============================================================================
WITH
dominio(unidade) AS (
  SELECT unnest(ARRAY['KG', 'SACO', 'L']::text[])
),
-- Fora do domínio: NULL, minúsculas, espaços em volta, UN ou qualquer outro texto (comparação exata).
fora AS (
  SELECT p.cliente_id, p.id, p.unidade_principal_estoque AS unidade, p.estoque_atual
  FROM public."Produto" p
  WHERE p.unidade_principal_estoque IS NULL
     OR p.unidade_principal_estoque NOT IN (SELECT unidade FROM dominio)
),
por_produto AS (
  SELECT f.cliente_id, f.unidade, f.id,
         (f.estoque_atual <> 0) AS com_estoque,
         (SELECT count(*) FROM public."EstoqueLoteNota" l WHERE l.cliente_id = f.cliente_id AND l.produto_id = f.id) AS lotes,
         (SELECT count(*) FROM public."MovimentacaoEstoque" m WHERE m.cliente_id = f.cliente_id AND m.produto_id = f.id) AS movimentos,
         (SELECT count(*) FROM public."TanqueBemProduto" t WHERE t.cliente_id = f.cliente_id AND t.produto_id = f.id AND t.ativo) AS aceites
  FROM fora f
),
itens_status AS (
  SELECT f.cliente_id, f.unidade, o.status, count(*) AS n
  FROM fora f
  JOIN public."OperacaoFinanceiraItem" i ON i.cliente_id = f.cliente_id AND i.produto_id = f.id
  JOIN public."OperacaoFinanceira" o ON o.cliente_id = i.cliente_id AND o.id = i.operacao_id
  GROUP BY f.cliente_id, f.unidade, o.status
),
grupos AS (
  SELECT g.cliente_id, g.unidade,
         count(*) AS produtos,
         count(*) FILTER (WHERE g.com_estoque) AS estoque_diferente_zero,
         sum(g.lotes) AS lotes,
         sum(g.movimentos) AS movimentos,
         sum(g.aceites) AS aceites_tanque_ativos
  FROM por_produto g
  GROUP BY g.cliente_id, g.unidade
),
linhas AS (
  SELECT 1 AS ordem,
         g.cliente_id::text AS cliente_id,
         CASE WHEN g.unidade IS NULL THEN 'NULL' ELSE quote_literal(g.unidade) END AS unidade,
         g.produtos,
         g.estoque_diferente_zero,
         g.lotes,
         g.movimentos,
         coalesce((SELECT string_agg(s.status || ': ' || s.n, ', ' ORDER BY s.status)
                   FROM itens_status s
                   WHERE s.cliente_id = g.cliente_id AND s.unidade IS NOT DISTINCT FROM g.unidade), '0') AS itens_por_status,
         g.aceites_tanque_ativos,
         CASE WHEN g.estoque_diferente_zero = 0 AND g.lotes = 0 AND g.movimentos = 0
                   AND NOT EXISTS (SELECT 1 FROM itens_status s WHERE s.cliente_id = g.cliente_id AND s.unidade IS NOT DISTINCT FROM g.unidade)
              THEN 'CORRIGIR PELO CADASTRO (sem histórico)'
              ELSE 'PARAR: tem histórico; levar ao proprietário (exige GO)' END AS acao
  FROM grupos g
  UNION ALL
  SELECT 2, 'NENHUM', '-', 0, 0, 0, 0, '0', 0, 'OK: nenhum Produto fora de {KG, SACO, L}; nada a migrar'
  WHERE NOT EXISTS (SELECT 1 FROM fora)
)
SELECT cliente_id, unidade, produtos, estoque_diferente_zero, lotes, movimentos, itens_por_status, aceites_tanque_ativos, acao
FROM linhas
ORDER BY ordem, cliente_id, unidade;
