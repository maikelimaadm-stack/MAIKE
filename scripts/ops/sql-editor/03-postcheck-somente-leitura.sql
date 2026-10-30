-- =============================================================================
-- MAIKE · PR #145 · 03 — POSTCHECK (SOMENTE LEITURA)          D-PROD-74 (G4-R2)
-- -----------------------------------------------------------------------------
-- Onde: Supabase → projeto MAIKE → SQL Editor → New query → cole TUDO → Run.
-- Só SELECT. Não mostra senha, hash, e-mail nem ids. Esperado: tudo "OK" e
-- VEREDITO "INICIALIZADO".
-- =============================================================================
WITH
tenant(nome) AS (
  SELECT unnest(ARRAY[
    'AplicacaoMedicamento','AuditLog','Bebedouro','BebedouroAlerta','BebedouroHistorico','BebedouroSanidade',
    'Categoria','CategoriaManejo','ConfiguracaoIcone','Empresa','EntidadeCodigoSequencia','EstoqueLoteNota',
    'EventoSanitario','Fornecedor','HistoricoLancamentoTarefa','LinhaGeografica','LocalEstoque',
    'ManejoTecnicoRebanho','Marca','MovimentacaoEstoque','MovimentacaoMapa','MovimentacaoPecuaria',
    'OperacaoIdempotente','Permissao','PontoReferencia','PontoSuplementacao','Produto','RegistroAnexo',
    'SuplementacaoEvento','SuplementacaoLote','UnidadeMedida','LancamentoTarefa','Usuario','Lote',
    'TipoTarefa','AreaPastagem','GrupoAtividade','Setor'
  ]::text[])
),
contagem AS (
  SELECT nome,
         CASE WHEN to_regclass(format('public.%I', nome)) IS NULL THEN -1
              ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', nome), false, true, '')))[1]::text::int
         END AS n
    FROM tenant
),
conta AS (
  SELECT count(*) AS n,
         count(*) FILTER (WHERE u.login = 'maike' AND u.nome = 'Maike' AND u.ativo AND u.papel_tenant = 'administrador'
                            AND c.codigo = 'maike' AND c.ativo AND u.senha_hash LIKE '$2%') AS certas
    FROM "Usuario" u JOIN "Cliente" c ON c.id = u.cliente_id
),
linhas(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'migrations concluídas',
         (SELECT count(*)::text FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), '25',
         CASE WHEN (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 25
               AND NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'clientes (todos) / com código maike',
         (SELECT count(*) || ' / ' || count(*) FILTER (WHERE codigo = 'maike' AND ativo) FROM "Cliente"), '1 / 1',
         CASE WHEN (SELECT count(*) = 1 AND count(*) FILTER (WHERE codigo = 'maike' AND ativo) = 1 FROM "Cliente") THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'contas (todas) / maike ativa administradora com hash bcrypt',
         (SELECT n || ' / ' || certas FROM conta), '1 / 1',
         CASE WHEN (SELECT n = 1 AND certas = 1 FROM conta) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'linhas de tenant além da conta e da auditoria',
         (SELECT sum(n)::text FROM contagem WHERE nome NOT IN ('Usuario', 'AuditLog')), '0',
         CASE WHEN (SELECT sum(n) FROM contagem WHERE nome NOT IN ('Usuario', 'AuditLog')) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'AuditLog (só inicialização e concessão do papel)',
         (SELECT count(*) || ' (' || coalesce(string_agg(DISTINCT acao, ', '), '-') || ')' FROM "AuditLog"), '2 (ops_inicializacao, papel_tenant)',
         CASE WHEN (SELECT count(*) FILTER (WHERE acao NOT IN ('ops_inicializacao', 'papel_tenant')) = 0 AND count(*) >= 2 FROM "AuditLog") THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'Lote / MovimentacaoMapa / AreaPastagem',
         (SELECT (SELECT n FROM contagem WHERE nome = 'Lote') || ' / ' || (SELECT n FROM contagem WHERE nome = 'MovimentacaoMapa') || ' / ' || (SELECT n FROM contagem WHERE nome = 'AreaPastagem')),
         '0 / 0 / 0',
         CASE WHEN (SELECT sum(n) FROM contagem WHERE nome IN ('Lote','MovimentacaoMapa','AreaPastagem')) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'Permissao.is_admin (não é autoridade)', (SELECT count(*)::text FROM "Permissao" WHERE is_admin), '0', 'OK'
  UNION ALL
  SELECT 8, 'proprietário do produto (MAIKE Admin) não criado', (SELECT count(*)::text FROM "AdminPrincipalMaike"), '0',
         CASE WHEN (SELECT count(*) FROM "AdminPrincipalMaike") = 0 THEN 'OK' ELSE 'ATENÇÃO (fora deste pacote)' END
  UNION ALL
  SELECT 9, 'tabelas sem RLS em public',
         (SELECT count(*)::text FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity), '0',
         CASE WHEN (SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'grants para anon/authenticated em public',
         (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')), '0',
         CASE WHEN (SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 999, 'VEREDITO',
         CASE WHEN (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 25
               AND (SELECT count(*) = 1 AND count(*) FILTER (WHERE codigo = 'maike' AND ativo) = 1 FROM "Cliente")
               AND (SELECT n = 1 AND certas = 1 FROM conta)
               AND (SELECT sum(n) FROM contagem WHERE nome NOT IN ('Usuario', 'AuditLog')) = 0
               AND (SELECT count(*) FILTER (WHERE acao NOT IN ('ops_inicializacao', 'papel_tenant')) = 0 FROM "AuditLog")
              THEN 'INICIALIZADO: 1 cliente "maike", 1 conta "maike" administradora, sem dados de teste'
              ELSE 'PARAR: revise as linhas acima' END,
         '-', '-'
)
SELECT item, valor, esperado, status FROM linhas ORDER BY ordem;
