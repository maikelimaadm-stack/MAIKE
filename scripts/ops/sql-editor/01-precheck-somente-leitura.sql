-- =============================================================================
-- MAIKE · PR #145 · 01 — PRECHECK (SOMENTE LEITURA)          D-PROD-74 (G4-R2)
-- -----------------------------------------------------------------------------
-- Onde: Supabase → projeto MAIKE → SQL Editor → New query → cole TUDO → Run.
-- O que faz: só SELECT. Não altera nada. Não mostra senha, hash, e-mail nem nome.
-- Rode ANTES das migrations (espera "MIGRAR PRIMEIRO") e DE NOVO depois delas:
-- a linha "impressao_inventario" desta segunda execução é o código que vai no 02
-- (banco sem "maike") ou no 04 (cliente e conta "maike" já existentes).
-- Leia a coluna "status": qualquer PARAR = não prossiga; o VEREDITO nunca é
-- positivo se alguma linha disser PARAR (G4-R5).
-- =============================================================================
WITH
esperado AS (
  SELECT '7692130048193495360'::text AS sid, 'postgres'::text AS banco
),
-- 38 tabelas de tenant (com cliente_id) na ordem segura de exclusão (filha → mãe) + Cliente.
tenant(nome, ord) AS (
  SELECT * FROM unnest(ARRAY[
    'AplicacaoMedicamento','AuditLog','Bebedouro','BebedouroAlerta','BebedouroHistorico','BebedouroSanidade',
    'Categoria','CategoriaManejo','ConfiguracaoIcone','Empresa','EntidadeCodigoSequencia','EstoqueLoteNota',
    'EventoSanitario','Fornecedor','HistoricoLancamentoTarefa','LinhaGeografica','LocalEstoque',
    'ManejoTecnicoRebanho','Marca','MovimentacaoEstoque','MovimentacaoMapa','MovimentacaoPecuaria',
    'OperacaoIdempotente','Permissao','PontoReferencia','PontoSuplementacao','Produto','RegistroAnexo',
    'SuplementacaoEvento','SuplementacaoLote','UnidadeMedida','LancamentoTarefa','Usuario','Lote',
    'TipoTarefa','AreaPastagem','GrupoAtividade','Setor','Cliente'
  ]::text[]) WITH ORDINALITY
),
-- Preservadas: catálogo global + identidade do proprietário (nunca tocadas).
preservada(nome) AS (
  SELECT unnest(ARRAY[
    'AdminPrincipalMaike','AuditoriaCatalogoGlobal','CatalogoAsset','CatalogoCategoriaVisual','CatalogoIcone',
    'CatalogoMeta','CatalogoRegraMisto','CatalogoRegraMistoCategoria','CatalogoTipoEntidade',
    'CodigoRecuperacaoAdminMaike','EventoSegurancaAdminMaike','OperadorProdutoMaike','SessaoAdminMaike'
  ]::text[])
),
migracoes_novas(nome) AS (
  SELECT unnest(ARRAY[
    '20261028250000_catalogo_global_slice1','20261028250100_catalogo_global_slice1_schema_fix',
    '20261028250200_catalogo_global_slice1_r1_assets','20261029100000_scale01_usuario_keyset_index',
    '20261029200000_categoria_manejo_vinculo_catalogo','20261029300000_admin_principal_maike',
    '20261029400000_usuario_papel_tenant'
  ]::text[])
),
contagem AS (
  SELECT t.nome, t.ord,
         CASE WHEN to_regclass(format('public.%I', t.nome)) IS NULL THEN -1
              ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.nome), false, true, '')))[1]::text::int
         END AS n
    FROM tenant t
),
contagem_preservada AS (
  SELECT p.nome,
         CASE WHEN to_regclass(format('public.%I', p.nome)) IS NULL THEN -1
              ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', p.nome), false, true, '')))[1]::text::int
         END AS n
    FROM preservada p
),
tabelas AS (
  SELECT c.relname::text AS nome, c.relkind::text AS tipo, c.relrowsecurity AS rls
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS com_falha,
         (SELECT count(*) FROM migracoes_novas mn
           WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" m WHERE m.migration_name = mn.nome AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)) AS novas_pendentes
    FROM "_prisma_migrations"
),
estado AS (
  SELECT (SELECT count(*) FROM "Cliente") AS clientes,
         (SELECT count(*) FROM "Cliente" WHERE codigo = 'maike') AS cliente_maike,
         (SELECT count(*) FROM "Usuario" WHERE lower(login) = 'maike') AS login_maike,
         (SELECT count(*) FROM "Usuario") AS usuarios,
         (SELECT count(*) FROM "Usuario" u JOIN "Cliente" c ON c.id = u.cliente_id
           WHERE c.codigo = 'maike' AND u.login = 'maike' AND u.ativo AND c.ativo) AS maike_vinculada,
         (SELECT count(*) FROM "Usuario" u JOIN "Cliente" c ON c.id = u.cliente_id
           WHERE c.codigo = 'maike' AND u.login = 'maike' AND u.papel_tenant = 'administrador') AS maike_admin,
         (SELECT coalesce(sum(n), 0) FROM contagem WHERE nome NOT IN ('Usuario', 'AuditLog', 'Cliente')) AS extra,
         (SELECT count(*) FROM "AuditLog") AS auditoria,
         (SELECT count(*) FROM "AuditLog" WHERE acao NOT IN ('ops_inicializacao', 'papel_tenant')) AS auditoria_fora,
         (SELECT count(*) FROM "AuditLog" WHERE acao = 'ops_inicializacao') AS inicializacoes
),
-- nenhum = sem "maike" (caminho 02) · inicializado = contrato do 03 integral ·
-- existente = único cliente/conta "maike" ainda não inicializado, com dados ou papel
--   a corrigir (caminho 04) ·
-- anomalo = qualquer outra combinação com "maike" (PARAR).
estado_tipo AS (
  SELECT CASE
           WHEN cliente_maike + login_maike = 0 THEN 'nenhum'
           WHEN clientes = 1 AND cliente_maike = 1 AND usuarios = 1 AND login_maike = 1 AND maike_vinculada = 1
                AND maike_admin = 1 AND extra = 0 AND auditoria_fora = 0 AND auditoria >= 2 THEN 'inicializado'
           WHEN clientes = 1 AND cliente_maike = 1 AND usuarios = 1 AND login_maike = 1 AND maike_vinculada = 1
                AND inicializacoes = 0 THEN 'existente'
           ELSE 'anomalo'
         END AS tipo
    FROM estado
),
impressao AS (
  SELECT left(md5('v1|'
           || (SELECT string_agg(nome, ',' ORDER BY nome) FROM tabelas) || '|'
           || (SELECT string_agg(nome || '=' || n, ',' ORDER BY ord) FROM contagem) || '|'
           || (SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM "Cliente")), 12) AS codigo
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'alvo: banco lógico', current_database(), (SELECT banco FROM esperado),
         CASE WHEN current_database() = (SELECT banco FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas', (SELECT concluidas::text FROM mig), '18 antes / 25 depois',
         CASE WHEN (SELECT concluidas FROM mig) IN (18, 25) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'migrations com falha', (SELECT com_falha::text FROM mig), '0',
         CASE WHEN (SELECT com_falha FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'das 7 migrations da PR, pendentes', (SELECT novas_pendentes::text FROM mig), '7 antes / 0 depois',
         CASE WHEN ((SELECT concluidas FROM mig), (SELECT novas_pendentes FROM mig)) IN ((18, 7), (25, 0)) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'tabelas em public', (SELECT count(*)::text FROM tabelas), '40 antes / 53 depois',
         CASE WHEN (SELECT count(*) FROM tabelas) = CASE WHEN (SELECT concluidas FROM mig) = 25 THEN 53 ELSE 40 END THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'views/partições/estrangeiras em public', (SELECT count(*)::text FROM tabelas WHERE tipo <> 'r'), '0',
         CASE WHEN (SELECT count(*) FROM tabelas WHERE tipo <> 'r') = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'tabelas fora do schema conhecido',
         coalesce((SELECT string_agg(nome, ', ') FROM tabelas WHERE nome NOT IN (SELECT nome FROM tenant UNION SELECT nome FROM preservada UNION SELECT '_prisma_migrations')), '-'), '-',
         CASE WHEN EXISTS (SELECT 1 FROM tabelas WHERE nome NOT IN (SELECT nome FROM tenant UNION SELECT nome FROM preservada UNION SELECT '_prisma_migrations')) THEN 'PARAR' ELSE 'OK' END
  UNION ALL
  SELECT 9, 'tabelas sem RLS', (SELECT count(*)::text FROM tabelas WHERE NOT rls), '0',
         CASE WHEN (SELECT count(*) FROM tabelas WHERE NOT rls) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'grants para anon/authenticated em public',
         (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')), '0',
         CASE WHEN (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'pgcrypto (crypt/gen_salt/gen_random_bytes) em extensions',
         CASE WHEN to_regprocedure('extensions.crypt(text,text)') IS NOT NULL AND to_regprocedure('extensions.gen_salt(text,integer)') IS NOT NULL
                   AND to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL THEN 'presente' ELSE 'ausente' END, 'presente',
         CASE WHEN to_regprocedure('extensions.crypt(text,text)') IS NOT NULL AND to_regprocedure('extensions.gen_salt(text,integer)') IS NOT NULL
                   AND to_regprocedure('extensions.gen_random_bytes(integer)') IS NOT NULL THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 12, 'clientes (tenants)', (SELECT clientes::text FROM estado), '1 (retrato 30/10)',
         CASE WHEN (SELECT clientes FROM estado) = 1 THEN 'OK' ELSE 'ATENÇÃO: revise antes' END
  UNION ALL
  SELECT 13, 'cliente "maike" / login "maike" já existem',
         (SELECT cliente_maike || ' / ' || login_maike FROM estado), '0 / 0 (02) ou 1 / 1 (04)',
         CASE (SELECT tipo FROM estado_tipo)
           WHEN 'nenhum' THEN 'OK (caminho 02)'
           WHEN 'existente' THEN 'MAIKE EXISTENTE (caminho 04)'
           WHEN 'inicializado' THEN 'INICIALIZADO'
           ELSE 'PARAR (combinação inesperada com "maike")' END
  UNION ALL
  SELECT 16, 'conta "maike": papel_tenant administrador', (SELECT maike_admin::text FROM estado), '1 depois do 02/04',
         CASE WHEN (SELECT tipo FROM estado_tipo) = 'inicializado' THEN 'OK'
              WHEN (SELECT tipo FROM estado_tipo) IN ('nenhum', 'existente') THEN 'AINDA NÃO' ELSE 'PARAR' END
  UNION ALL
  SELECT 17, 'linhas de tenant além do cliente, da conta e da auditoria', (SELECT extra::text FROM estado), '0 depois do 02/04',
         CASE WHEN (SELECT extra FROM estado) = 0 THEN 'OK' ELSE 'CONFIRA (serão apagadas pelo 02/04)' END
  UNION ALL
  SELECT 18, 'AuditLog fora de ops_inicializacao/papel_tenant', (SELECT auditoria_fora::text FROM estado), '0 depois do 02/04',
         CASE WHEN (SELECT auditoria_fora FROM estado) = 0 THEN 'OK' ELSE 'CONFIRA (serão apagadas pelo 02/04)' END
  UNION ALL
  SELECT 14, 'linhas de teste (todas as tabelas de tenant)', (SELECT sum(n)::text FROM contagem WHERE n > 0), '~126 (retrato 30/10)', 'CONFIRA'
  UNION ALL
  SELECT 15, 'linhas nas tabelas preservadas (fora a CatalogoMeta criada pela migration)',
         (SELECT sum(greatest(n, 0)) FILTER (WHERE nome <> 'CatalogoMeta')::text FROM contagem_preservada), '0',
         CASE WHEN (SELECT sum(greatest(n, 0)) FILTER (WHERE nome <> 'CatalogoMeta') FROM contagem_preservada) = 0
               AND (SELECT n FROM contagem_preservada WHERE nome = 'CatalogoMeta') IN (-1, 0, 1)
              THEN 'OK' ELSE 'ATENÇÃO: serão preservadas; revise' END
  UNION ALL
  SELECT 100 + ord, '  linhas em ' || nome, n::text, '-', CASE WHEN n < 0 THEN 'ausente' ELSE 'CONFIRA' END FROM contagem WHERE n <> 0
  UNION ALL
  SELECT 900, 'impressao_inventario (copie para o 02 depois das migrations)', (SELECT codigo FROM impressao), '-',
         CASE WHEN (SELECT concluidas FROM mig) = 25 THEN 'USE NO 02 OU NO 04' ELSE 'ainda não (migrações pendentes)' END
),
contrato AS (
  SELECT (SELECT concluidas FROM mig) = 25 AND (SELECT novas_pendentes FROM mig) = 0
         AND (SELECT count(*) FROM tabelas) = 53
         AND (SELECT count(*) FROM tabelas WHERE tipo <> 'r') = 0
         AND NOT EXISTS (SELECT 1 FROM tabelas WHERE nome NOT IN (SELECT nome FROM tenant UNION SELECT nome FROM preservada UNION SELECT '_prisma_migrations'))
         AND (SELECT count(*) FROM tabelas WHERE NOT rls) = 0
         AND (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')) = 0
         AS ok
),
linhas(ordem, item, valor, esperado, status) AS (
  SELECT * FROM base
  UNION ALL
  SELECT 999, 'VEREDITO',
         CASE
           WHEN (SELECT system_identifier::text FROM pg_control_system()) <> (SELECT sid FROM esperado) OR current_database() <> (SELECT banco FROM esperado) THEN 'PARAR: banco errado'
           WHEN (SELECT com_falha FROM mig) > 0 THEN 'PARAR: migration com falha'
           WHEN EXISTS (SELECT 1 FROM base WHERE status LIKE 'PARAR%') THEN 'PARAR: há linha PARAR acima; revise antes de qualquer script'
           WHEN (SELECT concluidas FROM mig) = 18 AND (SELECT novas_pendentes FROM mig) = 7 THEN 'MIGRAR PRIMEIRO (npm run deploy:migrate); depois rode este 01 de novo'
           WHEN NOT (SELECT ok FROM contrato) THEN 'PARAR: schema, RLS ou grants fora do contrato'
           WHEN (SELECT tipo FROM estado_tipo) = 'nenhum' THEN 'PRONTO PARA O 02 (confira as contagens e use a impressão acima)'
           WHEN (SELECT tipo FROM estado_tipo) = 'existente' THEN 'MAIKE EXISTENTE — LIMPEZA CONTROLADA NECESSÁRIA: não rode o 02; use o 04 com a impressão acima'
           WHEN (SELECT tipo FROM estado_tipo) = 'inicializado' THEN 'INICIALIZADO: não rode o 02 nem o 04; confira com o 03-postcheck'
           ELSE 'PARAR: estado inesperado; revise as linhas acima'
         END, '-', '-'
)
SELECT item, valor, esperado, status FROM linhas ORDER BY ordem;
