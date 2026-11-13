-- =============================================================================
-- MAIKE · Estoque P1-03 · PREFLIGHT DOS ÍNDICES (SOMENTE LEITURA)     D-PROD-185
-- -----------------------------------------------------------------------------
-- Por quê: a migration `20261113300000_estoque_p1_03_indices` cria 2 índices
-- comuns (sem CONCURRENTLY) em tabelas existentes:
--   "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx" (LC-2)
--   "MovimentacaoEstoque_keyset_empresa_idx"                      (keyset)
-- A migration roda numa transação só: SHARE LOCK em OperacaoIdempotente e depois
-- em MovimentacaoEstoque, os dois até o COMMIT. Leituras seguem; ESCRITAS nas
-- duas tabelas esperam os dois builds somados. Este SELECT mede o alvo ANTES do GO de
-- aplicação: tamanho das tabelas, índices atuais, histórico de migrations,
-- sessões que travariam ou seriam travadas, e parâmetros de tempo.
--
-- REGRA: rodar em PRODUÇÃO só com GO explícito do proprietário (GO-1). Sem GO,
-- só em banco local/descartável.
-- Onde: Supabase → projeto MAIKE → SQL Editor → New query → cole TUDO → Run.
-- O que faz: um único SELECT sobre catálogos (pg_class, pg_indexes,
-- pg_stat_*, pg_locks, _prisma_migrations, current_setting). Nenhum DDL,
-- nenhum DML, nenhuma trava de escrita. Não lê linha de negócio nem dado
-- pessoal: só nomes de objeto, contagens, tamanhos e idades.
--
-- Resultado: linhas (secao, item, valor, esperado) e a linha final
-- veredito.estado = SEGUIR | JA_APLICADA | PARAR (fail-closed). Leitura no
-- runbook MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md §3.
-- =============================================================================
WITH
alvo AS (
  SELECT 'alvo'::text AS secao, 'banco'::text AS item, current_database()::text AS valor, 'o banco de produção do MAIKE'::text AS esperado
  UNION ALL SELECT 'alvo', 'postgres', current_setting('server_version'), '17.x (o runner já confere o alvo)'
  UNION ALL SELECT 'alvo', 'tamanho_banco', pg_size_pretty(pg_database_size(current_database())), 'informativo'
),
tabelas AS (
  SELECT 'tabela', c.relname || '.linhas_estimadas', c.reltuples::bigint::text, 'informativo (dimensiona o build)'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente')
  UNION ALL
  SELECT 'tabela', c.relname || '.tamanho_heap', pg_size_pretty(pg_relation_size(c.oid)), 'informativo'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente')
  UNION ALL
  SELECT 'tabela', c.relname || '.tamanho_indices', pg_size_pretty(pg_indexes_size(c.oid)), 'informativo (o novo fica perto do maior índice de 4 colunas)'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente')
  UNION ALL
  SELECT 'tabela', s.relname || '.vivas_mortas', s.n_live_tup || ' / ' || s.n_dead_tup, 'informativo'
  FROM pg_stat_user_tables s WHERE s.schemaname = 'public' AND s.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente')
),
indices AS (
  SELECT 'indice', i.tablename || '.existentes', count(*)::text || ': ' || string_agg(i.indexname, ', ' ORDER BY i.indexname), 'informativo'
  FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename IN ('MovimentacaoEstoque', 'OperacaoIdempotente')
  GROUP BY i.tablename
  UNION ALL
  SELECT 'indice', 'novos_ja_existem',
         (SELECT count(*) FROM pg_indexes i WHERE i.schemaname = 'public'
            AND i.indexname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx'))::text,
         '0 (com 1 ou 2: PARAR, alguém criou à mão)'
  UNION ALL
  SELECT 'indice', 'invalidos_nas_2_tabelas',
         (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid
            WHERE t.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente') AND NOT x.indisvalid)::text,
         '0'
),
migracoes AS (
  SELECT 'migration', 'concluidas', count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text, '42 (a main antes desta PR)'
  FROM public._prisma_migrations
  UNION ALL
  -- Falhada PENDENTE (o que trava o `migrate deploy`, P3018): sem finished_at e sem rolled_back_at.
  SELECT 'migration', 'falhadas_pendentes', count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::text, '0 (qualquer outro: PARAR)'
  FROM public._prisma_migrations
  UNION ALL
  -- Revertidas por `migrate resolve --rolled-back` no passado: histórico, não bloqueiam.
  SELECT 'migration', 'revertidas_historico', count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text, 'informativo'
  FROM public._prisma_migrations
  UNION ALL
  SELECT 'migration', 'ultima', (SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1),
         '20261113200000_tipo_tarefa_drop_colunas'
  UNION ALL
  SELECT 'migration', 'contract_d_prod_183_aplicada',
         (SELECT CASE WHEN count(*) = 1 THEN 'SIM' ELSE 'NAO' END FROM public._prisma_migrations
            WHERE migration_name = '20261113200000_tipo_tarefa_drop_colunas' AND finished_at IS NOT NULL AND rolled_back_at IS NULL),
         'SIM (com NAO: PARAR — a release desta PR não pode levar a CONTRACT junto)'
  UNION ALL
  SELECT 'migration', 'p1_03_registrada',
         (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261113300000_estoque_p1_03_indices')::text,
         '0'
),
-- Veredito único (fail-closed): SEGUIR só no estado "antes" limpo; JA_APLICADA só com os 2 índices e a
-- migration concluída; qualquer outra combinação (índice parcial ou à mão, migration falhada/revertida,
-- índice inválido, CONTRACT pendente) → PARAR e investigar, sem `migrate resolve`, DROP ou retry sem GO.
estado AS (
  SELECT
    (SELECT count(*) FROM pg_indexes i WHERE i.schemaname = 'public'
       AND i.indexname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx')) AS novos,
    (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid
       WHERE t.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente') AND NOT x.indisvalid) AS invalidos,
    (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS falhadas,
    (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261113200000_tipo_tarefa_drop_colunas'
       AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS contract_ok,
    (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261113300000_estoque_p1_03_indices'
       AND rolled_back_at IS NULL) AS p103_vivas,
    (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261113300000_estoque_p1_03_indices'
       AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS p103_ok
),
veredito AS (
  SELECT 'veredito', 'estado',
         CASE
           WHEN e.invalidos > 0 OR e.falhadas > 0 OR e.contract_ok <> 1 THEN 'PARAR'
           WHEN e.novos = 0 AND e.p103_vivas = 0 THEN 'SEGUIR'
           WHEN e.novos = 2 AND e.p103_vivas = 1 AND e.p103_ok = 1 THEN 'JA_APLICADA'
           ELSE 'PARAR'
         END,
         'SEGUIR antes do GO-2; JA_APLICADA no postcheck; PARAR: investigar (runbook §6), nada destrutivo sem GO'
  FROM estado e
),
atividade AS (
  SELECT 'atividade', 'sessoes_com_trava_nas_2_tabelas',
         (SELECT count(DISTINCT l.pid) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
            WHERE c.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente') AND l.pid <> pg_backend_pid())::text,
         'idealmente 0 na janela'
  UNION ALL
  SELECT 'atividade', 'transacao_aberta_mais_antiga_s',
         COALESCE((SELECT round(extract(epoch FROM max(now() - a.xact_start)))::text FROM pg_stat_activity a
            WHERE a.datname = current_database() AND a.xact_start IS NOT NULL AND a.pid <> pg_backend_pid()), '0'),
         'baixo (uma transação longa segura o SHARE LOCK do build)'
  UNION ALL
  SELECT 'atividade', 'idle_in_transaction',
         (SELECT count(*) FROM pg_stat_activity a WHERE a.datname = current_database() AND a.state = 'idle in transaction')::text,
         '0'
),
config AS (
  SELECT 'config', 'lock_timeout', current_setting('lock_timeout'), 'informativo (o runner usa a sessão dele)'
  UNION ALL SELECT 'config', 'statement_timeout', current_setting('statement_timeout'), 'informativo (o build não pode estourar)'
  UNION ALL SELECT 'config', 'maintenance_work_mem', current_setting('maintenance_work_mem'), 'informativo (memória do build)'
  UNION ALL SELECT 'config', 'max_parallel_maintenance_workers', current_setting('max_parallel_maintenance_workers'), 'informativo'
)
SELECT * FROM alvo
UNION ALL SELECT * FROM tabelas
UNION ALL SELECT * FROM indices
UNION ALL SELECT * FROM migracoes
UNION ALL SELECT * FROM atividade
UNION ALL SELECT * FROM config
UNION ALL SELECT * FROM veredito;
