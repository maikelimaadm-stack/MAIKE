-- =============================================================================
-- MAIKE · PR #145 · 03 — POSTCHECK (SOMENTE LEITURA)          D-PROD-74 (G4-R2)
-- -----------------------------------------------------------------------------
-- Onde: Supabase → projeto MAIKE → SQL Editor → New query → cole TUDO → Run.
-- Só SELECT. Não mostra senha, hash, e-mail nem ids. Esperado: tudo "OK" e
-- VEREDITO "INICIALIZADO".
-- Vale depois do 02 (conta nova) e do 04 (conta existente preservada: o nome
-- de exibição não é conferido, só login, atividade, papel e hash bcrypt).
-- =============================================================================
WITH
tenant(nome) AS (
  SELECT unnest(ARRAY[
    -- D-PROD-207 (Fatia 4): as linhas de mão de obra e de serviço saem PRIMEIRO — a de mão de obra referencia o
    -- apontamento, o funcionário e os usuários; a de serviço referencia o apontamento, o serviço, o parceiro (Fornecedor)
    -- e os usuários; nenhuma outra tabela as referencia. O Funcionario e o Servico saem logo depois — referenciam a
    -- empresa (e o serviço, a UnidadeMedida e o CentroCusto); só as duas linhas os referenciam.
    'AtividadeApontamentoMaoObra','AtividadeApontamentoServico','Funcionario','Servico',
    -- D-PROD-202 (Fatia 3): as linhas de produto e de máquina saem logo depois — a fatia FIFO do produto referencia a linha de
    -- produto e o lote; a linha de produto referencia o apontamento, o produto, o local, os 2 movimentos e os usuários;
    -- a linha de máquina referencia o apontamento, o bem (e o implemento) e os usuários; nenhuma outra tabela as referencia.
    'AtividadeApontamentoProdutoConsumoLote','AtividadeApontamentoProduto','AtividadeApontamentoMaquina',
    -- D-PROD-200: o apontamento do dia (AtividadeApontamento) sai logo depois — referencia a atividade, os usuários e a
    -- empresa; só as linhas (acima, D-PROD-202 e D-PROD-207) o referenciam. As 3 tabelas do apontamento antigo (D-PROD-190/D-PROD-193) saíram.
    'AtividadeApontamento',
    -- D-PROD-200: a atividade (cabeçalho) sai logo depois — referencia o tipo e o grupo de atividade, a área, o setor, o
    -- bem, os centros, a unidade, a tarefa, os usuários e a empresa; só o apontamento do dia (acima) a referencia.
    'Atividade',
    -- D-PROD-197: o tipo de atividade sai logo depois da atividade (a única tabela que o referencia, D-PROD-200) e ANTES dos
    -- centros de custo e de resultado e da UnidadeMedida, que ele referencia como padrão (FKs RESTRICT).
    'TipoAtividade',
    'HistoricoLancamentoTarefa','LancamentoTarefa','PesoRebanho','PartidaRebanho','EventoRebanho','PosicaoRebanho','RebanhoLedgerAtivacao',
    -- D-PROD-155 (Gestão P3-01): filhas antes das mães; antes dos centros/naturezas que o rateio referencia.
    -- D-PROD-156 (Gestão P3-02): a linha do rateio por item sai antes do item, do documento, das naturezas e dos centros.
    -- D-PROD-158 (Gestão P3-03): o evento de retificação/exclusão sai antes dos documentos e do usuário que ele referencia.
    'OperacaoFinanceiraEvento','LiquidacaoFinanceiraEstorno','LiquidacaoFinanceira','TituloFinanceiro','OperacaoFinanceiraConsumoLote','OperacaoFinanceiraItemRateio','OperacaoFinanceiraItem','OperacaoFinanceiraRateio','OperacaoFinanceira','PerfilFinanceiroEmpresa',
    -- D-PROD-157/159 (Patrimônio P1-01/P1-02): antes de CentroCusto/Empresa/Fornecedor/Usuario/AreaPastagem, do Produto e dos lotes/movimentos/local que eles referenciam.
    -- D-PROD-162: o Patrimônio simplificado (sem perfis, medições, combustíveis e fator) — filhas antes das mães
    -- (fatias FIFO → abastecimento → Produto aceito pelo tanque → tanque → bem → tipo → família).
    'AbastecimentoBemConsumoLote','AbastecimentoBem','TanqueBemProduto','TanqueBem','BemPatrimonial','TipoPatrimonial','FamiliaPatrimonial',
    'CentroCustoResultado','CentroCusto','CentroResultado','NaturezaFinanceira',
    -- D-PROD-188: CADESTACOES (estações da fazenda) antes de Empresa, que ela referencia.
    'CADESTACOES',
    -- D-PROD-203: as formulações de suplemento — regras e ingredientes (filhas) antes da formulação, e as três antes
    -- de CADCATEGORIA, Produto e Empresa, que elas referenciam (FKs RESTRICT).
    'CADFORMULACAOREGRA','CADFORMULACAOINGREDIENTE','CADFORMULACAO',
    -- D-PROD-205: as leituras de cocho antes de PontoSuplementacao (CASCADE) e de Empresa (RESTRICT), que elas referenciam.
    'LEITURACOCHO',
    'AplicacaoMedicamento','AuditLog','Bebedouro','BebedouroAlerta','BebedouroHistorico','BebedouroSanidade',
    -- D-PROD-187: CategoriaManejo passou a se chamar CADCATEGORIA (nome físico; o model Prisma não mudou).
    -- D-PROD-189/D-PROD-195: CADCURVAGANHO (curvas de ganho) depois de CADCATEGORIA, que a referencia, e antes de Empresa.
    'Categoria','CADCATEGORIA','CADCURVAGANHO','ConfiguracaoIcone','Empresa','EntidadeCodigoSequencia','EstoqueLoteNota',
    'EventoSanitario','Fornecedor','LinhaGeografica','LocalEstoque',
    'ManejoTecnicoRebanho','Marca','MovimentacaoEstoque','MovimentacaoMapa','MovimentacaoPecuaria',
    'OperacaoIdempotente','Permissao','PontoReferencia','PontoSuplementacao','Produto','RegistroAnexo',
    'SuplementacaoEvento','SuplementacaoLote','UnidadeMedida','Usuario','Lote',
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
         count(*) FILTER (WHERE u.login = 'maike' AND u.ativo AND u.papel_tenant = 'administrador'
                            AND c.codigo = 'maike' AND c.ativo AND u.senha_hash LIKE '$2%') AS certas
    FROM "Usuario" u JOIN "Cliente" c ON c.id = u.cliente_id
),
linhas(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'migrations concluídas',
         (SELECT count(*)::text FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL), '25 ou mais',
         CASE WHEN (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) >= 25
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
         CASE WHEN (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) >= 25
               AND (SELECT count(*) = 1 AND count(*) FILTER (WHERE codigo = 'maike' AND ativo) = 1 FROM "Cliente")
               AND (SELECT n = 1 AND certas = 1 FROM conta)
               AND (SELECT sum(n) FROM contagem WHERE nome NOT IN ('Usuario', 'AuditLog')) = 0
               AND (SELECT count(*) FILTER (WHERE acao NOT IN ('ops_inicializacao', 'papel_tenant')) = 0 FROM "AuditLog")
              THEN 'INICIALIZADO: 1 cliente "maike", 1 conta "maike" administradora, sem dados de teste'
              ELSE 'PARAR: revise as linhas acima' END,
         '-', '-'
)
SELECT item, valor, esperado, status FROM linhas ORDER BY ordem;
