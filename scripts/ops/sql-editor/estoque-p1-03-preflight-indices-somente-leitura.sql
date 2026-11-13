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
-- veredito.estado = SEGUIR | JA_APLICADA | PARAR (fail-closed; JA_APLICADA só
-- com as 2 definições EXATAS, válidas, na tabela certa). Leitura no
-- runbook MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md §3.
--
-- Base da release (R2): o histórico de produção é conferido, por NOME, contra a
-- lista fixa `base_release` = as 43 migrations da main 776befe9 (inclui a
-- CADESTACOES, D-PROD-188, aplicada antes do merge). SEGUIR exige exatamente
-- essas 43 concluídas e a P1-03 ausente; JA_APLICADA exige as 43 + a P1-03 (44).
-- Migration da base ausente, migration concluída fora da base (que não seja a
-- P1-03), nome concluído em duplicidade ou falhada pendente → PARAR. A P1-03 tem
-- carimbo anterior ao da CADESTACOES, mas em produção entra por último: a ordem
-- não é critério. Checksum NÃO é conferido aqui: isso é do
-- `premerge-migrate --verificar-alvo`. Se a main ganhar outra migration antes do
-- GO-2, este preflight dá PARAR até a PR integrar a main e a lista ser refeita.
-- =============================================================================
WITH
-- As 43 migrations da base da release (main 776befe9), sem a P1-03. Um teste confere a lista contra a pasta.
base_release(nome) AS (
  VALUES
    ('20260908174141_p3_foundation'),
    ('20260909112833_p4_1_setor_native'),
    ('20260909201703_p4_1_r2_setor_tipo_default'),
    ('20260910190000_p4_2_area_pastagem_native'),
    ('20261023180000_p4_3_map_geography_native'),
    ('20261023210000_p6_1_login_global_hygiene'),
    ('20261027140000_p4_marcas_native'),
    ('20261027180000_p4_5_unidade_medida_native'),
    ('20261027190000_p5_grupo_tipo_tarefa_native'),
    ('20261027200000_p51_lote_native'),
    ('20261027210000_p52_categoria_local_produto_native'),
    ('20261027220000_p53_lancamento_tarefa_native'),
    ('20261027230000_p54_base44_exit_movimentacao'),
    ('20261028120000_p55_base44_exit_final'),
    ('20261028200000_p54_marca_list_keyset_indexes'),
    ('20261028210000_empresa_numero_empresa'),
    ('20261028230000_operacao_idempotente'),
    ('20261028240000_p8_supabase_public_revoke_rls'),
    ('20261028250000_catalogo_global_slice1'),
    ('20261028250100_catalogo_global_slice1_schema_fix'),
    ('20261028250200_catalogo_global_slice1_r1_assets'),
    ('20261029100000_scale01_usuario_keyset_index'),
    ('20261029200000_categoria_manejo_vinculo_catalogo'),
    ('20261029300000_admin_principal_maike'),
    ('20261029400000_usuario_papel_tenant'),
    ('20261030100000_icone_url_text'),
    ('20261101100000_lote_exclusao_logica'),
    ('20261102200000_rebanho_ledger_posicoes'),
    ('20261103100000_rebanho_ledger_r1_manejos'),
    ('20261104200000_empresa_fuso_horario'),
    ('20261106200000_s04_p1_sessao_epoca'),
    ('20261107200000_s04_p2_troca_senha_inicial'),
    ('20261107300000_gestao_p1_centros_custo_resultado'),
    ('20261108100000_gestao_p2_naturezas_financeiras'),
    ('20261109100000_gestao_p3_01_central_lancamentos'),
    ('20261109200000_gestao_p3_02_rateio_por_item'),
    ('20261109300000_gestao_p3_03_editar_excluir'),
    ('20261110100000_patrimonio_p1_01_cadastros'),
    ('20261110200000_patrimonio_p1_02_abastecimentos'),
    ('20261110300000_patrimonio_simplifica'),
    ('20261113100000_tipo_atividade_cadastro'),
    ('20261113200000_tipo_tarefa_drop_colunas'),
    ('20261113400000_cadestacoes_cadastro')
),
-- Veredito único (fail-closed): SEGUIR só no estado "antes" limpo (as 43 da base, nada mais); JA_APLICADA só
-- com os 2 índices exatos e a migration concluída (44); qualquer outra combinação (índice parcial ou à mão,
-- migration falhada, base incompleta, migration desconhecida ou duplicada, índice inválido, CONTRACT
-- pendente) → PARAR e investigar, sem `migrate resolve`, DROP ou retry sem GO.
estado AS (
  SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
       AND c.relname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx')) AS ocupados,
    -- Índice com o nome, na tabela certa, com a definição EXATA da migration, válido e pronto.
    (SELECT count(*) FROM pg_indexes i JOIN pg_class c ON c.relname = i.indexname JOIN pg_index x ON x.indexrelid = c.oid
       WHERE i.schemaname = 'public' AND x.indisvalid AND x.indisready
         AND (i.indexname, i.tablename, i.indexdef) IN (
           ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'OperacaoIdempotente',
            'CREATE INDEX "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx" ON public."OperacaoIdempotente" USING btree (cliente_id, tipo_operacao, "createdAt")'),
           ('MovimentacaoEstoque_keyset_empresa_idx', 'MovimentacaoEstoque',
            'CREATE INDEX "MovimentacaoEstoque_keyset_empresa_idx" ON public."MovimentacaoEstoque" USING btree (cliente_id, empresa_id, data_movimentacao DESC, id DESC)'))) AS exatos,
    (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid
       WHERE t.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente') AND NOT x.indisvalid) AS invalidos,
    (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS falhadas,
    (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261113200000_tipo_tarefa_drop_colunas'
       AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS contract_ok,
    (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261113300000_estoque_p1_03_indices'
       AND rolled_back_at IS NULL) AS p103_vivas,
    (SELECT count(*) FROM public._prisma_migrations WHERE migration_name = '20261113300000_estoque_p1_03_indices'
       AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS p103_ok,
    -- Histórico contra a base da release (só nomes; checksum é do premerge-migrate).
    (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
    (SELECT count(*) FROM base_release b WHERE NOT EXISTS (SELECT 1 FROM public._prisma_migrations m
       WHERE m.migration_name = b.nome AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)) AS base_ausentes,
    (SELECT count(DISTINCT m.migration_name) FROM public._prisma_migrations m WHERE m.rolled_back_at IS NULL
       AND m.migration_name <> '20261113300000_estoque_p1_03_indices'
       AND m.migration_name NOT IN (SELECT nome FROM base_release)) AS desconhecidas,
    (SELECT count(*) FROM (SELECT m.migration_name FROM public._prisma_migrations m WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL
       GROUP BY m.migration_name HAVING count(*) > 1) d) AS duplicadas,
    (SELECT count(*) FROM base_release) AS base_total
),
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
  -- Qualquer relação (tabela, view, sequência, índice…) com um dos 2 nomes: o CREATE INDEX falharia (42P07).
  SELECT 'indice', 'nomes_ocupados_qualquer_tipo',
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
            AND c.relname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx'))::text,
         '0 antes do GO-2; 2 no postcheck'
  UNION ALL
  SELECT 'indice', 'definicoes_exatas_validas', (SELECT exatos FROM estado)::text, '0 antes do GO-2; 2 no postcheck'
  UNION ALL
  SELECT 'indice', 'invalidos_nas_2_tabelas',
         (SELECT count(*) FROM pg_index x JOIN pg_class t ON t.oid = x.indrelid
            WHERE t.relname IN ('MovimentacaoEstoque', 'OperacaoIdempotente') AND NOT x.indisvalid)::text,
         '0'
),
migracoes AS (
  SELECT 'migration', 'concluidas', count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text,
         '43 antes do GO-2 (a base da release); 44 no postcheck (com a P1-03)'
  FROM public._prisma_migrations
  UNION ALL
  SELECT 'migration', 'base_ausentes', (SELECT base_ausentes FROM estado)::text, '0 (das 43 da base, quantas não estão concluídas; com >0: PARAR)'
  UNION ALL
  SELECT 'migration', 'desconhecidas', (SELECT desconhecidas FROM estado)::text, '0 (migration fora da base e que não é a P1-03; com >0: PARAR)'
  UNION ALL
  SELECT 'migration', 'desconhecidas_nomes',
         COALESCE((SELECT string_agg(DISTINCT m.migration_name, ', ') FROM public._prisma_migrations m WHERE m.rolled_back_at IS NULL
            AND m.migration_name <> '20261113300000_estoque_p1_03_indices' AND m.migration_name NOT IN (SELECT nome FROM base_release)), '-'),
         'informativo (nomes das desconhecidas)'
  UNION ALL
  SELECT 'migration', 'duplicadas', (SELECT duplicadas FROM estado)::text, '0 (mesmo nome concluído 2 vezes: PARAR)'
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
         'informativo: 20261113400000_cadestacoes_cadastro antes do GO-2; 20261113300000_estoque_p1_03_indices no postcheck (ordem de aplicação, não de nome)'
  UNION ALL
  SELECT 'migration', 'cadestacoes_aplicada',
         (SELECT CASE WHEN count(*) = 1 THEN 'SIM' ELSE 'NAO' END FROM public._prisma_migrations
            WHERE migration_name = '20261113400000_cadestacoes_cadastro' AND finished_at IS NOT NULL AND rolled_back_at IS NULL),
         'SIM (D-PROD-188; com NAO: PARAR)'
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
veredito AS (
  SELECT 'veredito', 'estado',
         CASE
           WHEN e.invalidos > 0 OR e.falhadas > 0 OR e.contract_ok <> 1
             OR e.base_ausentes > 0 OR e.desconhecidas > 0 OR e.duplicadas > 0 THEN 'PARAR'
           WHEN e.ocupados = 0 AND e.p103_vivas = 0 AND e.concluidas = e.base_total THEN 'SEGUIR'
           WHEN e.ocupados = 2 AND e.exatos = 2 AND e.p103_vivas = 1 AND e.p103_ok = 1 AND e.concluidas = e.base_total + 1 THEN 'JA_APLICADA'
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
