-- =============================================================================
-- MAIKE · PR #145 · 04 — APAGA OS DADOS DE TESTE PRESERVANDO O CLIENTE E A CONTA
--                        "maike" EXISTENTES, E PROMOVE A CONTA A ADMINISTRADOR
--                                                              D-PROD-76 (G4-R5)
-- -----------------------------------------------------------------------------
-- Para o estado em que o ÚNICO cliente já é "maike" e a ÚNICA conta já é "maike"
-- (o 01 diz "MAIKE EXISTENTE — LIMPEZA CONTROLADA NECESSÁRIA"). Nesse estado o 02
-- recusa (ANOMALIA) — e deve: o 02 cria conta nova com senha nova.
--
-- COMO USAR: cole o arquivo INTEIRO, troque SÓ COLE_AQUI_A_IMPRESSAO pela
-- "impressao_inventario" do 01 (rodado agora), Run UMA vez. Depois rode o 03.
--
-- GARANTIAS (falha fechada; qualquer erro desfaz TUDO):
--   - Uma única transação; fora dela, para antes de alterar.
--   - Confere alvo, 25/25 migrations (as 7 da PR com o checksum do repositório),
--     o conjunto EXATO de 108 tabelas (53 + 5 do ledger R2E-P1/R1 + 3 de Gestão P1, D-PROD-146, + 1 de Gestão P2, D-PROD-153, + 8 de Gestão P3-01, D-PROD-155, + 1 de Gestão P3-02, D-PROD-156, + 1 de Gestão P3-03, D-PROD-158, + 10 de Patrimônio P1-01, D-PROD-157, + 3 de Patrimônio P1-02, D-PROD-159, − 13 + 7 do Patrimônio simplificado, D-PROD-162, + 1 TipoAtividade, D-PROD-182, + 1 CADESTACOES, D-PROD-188, + 1 CADCURVAGANHO, D-PROD-189, + 1 ApontamentoAtividade, D-PROD-190, + 2 de itens do apontamento, D-PROD-193, − 3 do apontamento antigo + 2 da atividade em dois níveis, D-PROD-200, + 3 das linhas de produto e de máquina, D-PROD-202, + 3 das Formulações, D-PROD-203, + 1 LEITURACOCHO, D-PROD-205, + 4 da mão de obra e do serviço, D-PROD-207, − Funcionario, D-PROD-208, + CADCULTURAS, D-PROD-215, + MEDICAOFORRAGEM, D-PROD-219, + AtividadeArea, D-PROD-249, + 3 das Entradas do Estoque, D-PROD-257, + MotivoEntradaEstoque, D-PROD-259, + 4 da saída manual do Estoque, D-PROD-264, + 3 do ajuste de inventário, D-PROD-269), cliente_id, ordem das FKs, nenhuma FK de
--     fora do tenant com linhas, RLS e grants; exatamente 1 cliente ("maike",
--     ativo) e 1 conta ("maike", ativa, nesse cliente); todas as linhas de tenant
--     desse cliente. Trava as tabelas e RECONFERE tudo, inclusive a impressão.
--   - Apaga SOMENTE as linhas das 93 tabelas de tenant do cliente "maike",
--     EXCETO a própria conta. O Cliente fica intacto.
--   - Preserva Usuario.id, senha_hash, login, nome, ativo e o vínculo; Cliente.id,
--     código, nome e ativo. Altera SÓ Usuario.papel_tenant → 'administrador'
--     (e updatedAt). NÃO gera, troca, mostra nem transmite senha.
--   - Grava 2 AuditLog (ops_inicializacao, papel_tenant) sem credencial.
--   - Nunca toca _prisma_migrations, catálogo global, MAIKE Admin, auth, storage,
--     schema, RLS, grants. Sem DROP/TRUNCATE/DDL.
--   - Rerun no estado final: JA_INICIALIZADO, nada muda. Já inicializado e com
--     dados novos, ou qualquer outro estado: ANOMALIA, nada apagado.
-- =============================================================================

-- >>> PARÂMETROS (troque só COLE_AQUI_A_IMPRESSAO) ------------------------------
SET LOCAL maike_op.sid = '7692130048193495360';
SET LOCAL maike_op.banco = 'postgres';
SET LOCAL maike_op.impressao = 'COLE_AQUI_A_IMPRESSAO';
-- <<< FIM DOS PARÂMETROS --------------------------------------------------------

CREATE TEMP TABLE maike_limpeza_resultado (
  status text, conta_login text, papel_tenant text, linhas_apagadas int, observacao text
) ON COMMIT DROP;

DO $maike$
DECLARE
  c_tenant constant text[] := ARRAY[
    -- D-PROD-207 (Fatia 4): as linhas de mão de obra e de serviço saem PRIMEIRO — a de mão de obra referencia o
    -- apontamento, o parceiro (Fornecedor; D-PROD-208: o funcionário é papel do parceiro e a tabela Funcionario saiu) e
    -- os usuários; a de serviço referencia o apontamento, o serviço, o parceiro e os usuários; nenhuma outra tabela as
    -- referencia. O Servico sai logo depois — referencia a empresa, a UnidadeMedida e o CentroCusto; só a linha de
    -- serviço o referencia.
    'AtividadeApontamentoMaoObra','AtividadeApontamentoServico','Servico',
    -- D-PROD-202 (Fatia 3): as linhas de produto e de máquina saem logo depois — a fatia FIFO do produto referencia a linha de
    -- produto e o lote; a linha de produto referencia o apontamento, o produto, o local, os 2 movimentos e os usuários;
    -- a linha de máquina referencia o apontamento, o bem (e o implemento) e os usuários; nenhuma outra tabela as referencia.
    'AtividadeApontamentoProdutoConsumoLote','AtividadeApontamentoProduto','AtividadeApontamentoMaquina',
    -- D-PROD-211 (Fatia 5): o abastecimento (e as fatias FIFO dele) sai antes do apontamento e da atividade, que ele
    -- passa a referenciar, e antes do tanque, do bem e dos centros (abaixo); só as fatias FIFO o referenciam.
    'AbastecimentoBemConsumoLote','AbastecimentoBem',
    -- D-PROD-200: o apontamento do dia (AtividadeApontamento) sai logo depois — referencia a atividade, os usuários e a
    -- empresa; só as linhas (acima, D-PROD-202 e D-PROD-207) e o abastecimento (D-PROD-211) o referenciam. As 3 tabelas do apontamento antigo (D-PROD-190/D-PROD-193) saíram.
    'AtividadeApontamento',
    -- D-PROD-249: a área da atividade (AtividadeArea) sai logo depois do apontamento, que a referencia (FK composta), e
    -- antes da atividade, da área (AreaPastagem), do setor e dos usuários, que ela referencia.
    'AtividadeArea',
    -- D-PROD-200: a atividade (cabeçalho) sai logo depois — referencia o tipo e o grupo de atividade, a área, o setor, o
    -- bem, os centros, a unidade, a tarefa, os usuários e a empresa; só o apontamento do dia, a área da atividade (D-PROD-249) e o abastecimento (acima) a referenciam.
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
    'TanqueBemProduto','TanqueBem','BemPatrimonial','TipoPatrimonial','FamiliaPatrimonial',
    -- D-PROD-257/259: as entradas manuais de estoque (evento e item antes do cabeçalho) saem ANTES dos centros de
    -- custo e de resultado, do fornecedor, do lote, do movimento, do produto e do local que elas referenciam (FKs
    -- RESTRICT); o cadastro de motivos (a entrada o referencia) logo depois delas.
    'EntradaEstoqueEvento','EntradaEstoqueItem','EntradaEstoque','MotivoEntradaEstoque',
    -- D-PROD-264: as saídas manuais de estoque (evento e item antes do cabeçalho) saem ANTES dos centros de custo e
    -- de resultado, do movimento, do produto, do local e da fazenda que elas referenciam (FKs RESTRICT); o cadastro de
    -- motivos de saída (a saída o referencia) logo depois delas.
    'SaidaEstoqueEvento','SaidaEstoqueItem','SaidaEstoque','MotivoSaidaEstoque',
    -- D-PROD-269: os ajustes de inventário (evento e item antes do cabeçalho) saem ANTES dos centros de custo e de
    -- resultado, do lote, do movimento, do produto, do local e da fazenda que eles referenciam (FKs RESTRICT).
    'AjusteEstoqueEvento','AjusteEstoqueItem','AjusteEstoque',
    'CentroCustoResultado','CentroCusto','CentroResultado','NaturezaFinanceira',
    -- D-PROD-188: CADESTACOES (estações da fazenda) antes de Empresa, que ela referencia.
    'CADESTACOES',
    -- D-PROD-203: as formulações de suplemento — regras e ingredientes (filhas) antes da formulação, e as três antes
    -- de CADCATEGORIA, Produto e Empresa, que elas referenciam (FKs RESTRICT).
    'CADFORMULACAOREGRA','CADFORMULACAOINGREDIENTE','CADFORMULACAO',
    -- D-PROD-205: as leituras de cocho antes de PontoSuplementacao (CASCADE) e de Empresa (RESTRICT), que elas referenciam.
    'LEITURACOCHO',
    -- D-PROD-219: as medições de forragem antes de AreaPastagem, CADCULTURAS e Empresa (RESTRICT), que elas referenciam.
    'MEDICAOFORRAGEM',
    -- D-PROD-215: o Cadastro de Culturas referencia Empresa (RESTRICT). D-PROD-216: a Área passou a referenciar a
    -- cultura (RESTRICT): a CADCULTURAS sai logo DEPOIS de AreaPastagem, e a Empresa foi para o fim (antes de Cliente) —
    -- nenhuma tabela da lista a referencia depois dela, e ela só referencia Cliente.
    'AplicacaoMedicamento','AuditLog','Bebedouro','BebedouroAlerta','BebedouroHistorico','BebedouroSanidade',
    -- D-PROD-187: CategoriaManejo passou a se chamar CADCATEGORIA (nome físico; o model Prisma não mudou).
    -- D-PROD-189/D-PROD-195: CADCURVAGANHO (curvas de ganho) depois de CADCATEGORIA, que a referencia, e antes de Empresa.
    'Categoria','CADCATEGORIA','CADCURVAGANHO','ConfiguracaoIcone','EntidadeCodigoSequencia','EstoqueLoteNota',
    'EventoSanitario','Fornecedor','LinhaGeografica','LocalEstoque',
    'ManejoTecnicoRebanho','Marca','MovimentacaoEstoque','MovimentacaoMapa','MovimentacaoPecuaria',
    'OperacaoIdempotente','Permissao','PontoReferencia','PontoSuplementacao','Produto','RegistroAnexo',
    'SuplementacaoEvento','SuplementacaoLote','UnidadeMedida','Usuario','Lote',
    'TipoTarefa','AreaPastagem','CADCULTURAS','GrupoAtividade','Setor','Empresa'];
  c_preservadas constant text[] := ARRAY[
    'AdminPrincipalMaike','AuditoriaCatalogoGlobal','CatalogoAsset','CatalogoCategoriaVisual','CatalogoIcone',
    'CatalogoMeta','CatalogoRegraMisto','CatalogoRegraMistoCategoria','CatalogoTipoEntidade',
    'CodigoRecuperacaoAdminMaike','EventoSegurancaAdminMaike','OperadorProdutoMaike','SessaoAdminMaike'];
  -- As 7 migrations da PR com o checksum (sha256) do migration.sql versionado.
  c_novas constant text[] := ARRAY[
    '20261028250000_catalogo_global_slice1=232bbb449d21f7e8fe8229533b5875955ebce3fa55f89b671413695ac131eb41',
    '20261028250100_catalogo_global_slice1_schema_fix=970776414a00fdff5f64996d797e5cc1acfda8121dda446219dac48d9da7ac6c',
    '20261028250200_catalogo_global_slice1_r1_assets=5c187e30267a3c43f507402d8f4dfafbcd68465d893667f400cbed7c8e72ffb7',
    '20261029100000_scale01_usuario_keyset_index=7642328529b63c83d04d23b0ae0ed33a998e2e09cc44f933a19ef35cbef46be6',
    '20261029200000_categoria_manejo_vinculo_catalogo=da35a27346128add8fc3e7f09b905469509f55c412adcf83344bf366d1a13e38',
    '20261029300000_admin_principal_maike=ccea6c4fd4f2478c5b8ad89af416e6cceeae00fec2c57f8179d12cae3355c86b',
    '20261029400000_usuario_papel_tenant=4e0631d1b015da7e9b72a8033eebf1dcb34003aff374500cfb8873e9c0b5e381'];
  v_ordem text[] := c_tenant || ARRAY['Cliente'];
  v_esperadas text[];
  v_sid text; v_banco text; v_impressao_esp text; v_impressao text;
  v_n int; v_total int := 0; v_tab text; v_txt text; v_rodada int;
  v_cliente_id text; v_cliente_antes text; v_usuario_id text; v_usuario_antes text; v_hash_antes text; v_papel_antes text;
  v_preservadas_antes text; v_preservadas_depois text; v_mig_antes text; v_mig_depois text;
  v_seguranca_antes text; v_seguranca_depois text; v_apagadas jsonb := '{}'::jsonb; v_req text;
  r record;
BEGIN
  -- 0. Executado como um todo, numa única transação?
  IF to_regclass('pg_temp.maike_limpeza_resultado') IS NULL THEN
    RAISE EXCEPTION 'MAIKE-04: rode o arquivo INTEIRO de uma vez (Run sem seleção). Nada foi alterado.';
  END IF;
  v_sid := current_setting('maike_op.sid', true);
  v_banco := current_setting('maike_op.banco', true);
  v_impressao_esp := current_setting('maike_op.impressao', true);
  IF v_sid IS NULL OR v_banco IS NULL OR v_impressao_esp IS NULL THEN
    RAISE EXCEPTION 'MAIKE-04: parâmetros ausentes (rode o arquivo inteiro). Nada foi alterado.';
  END IF;
  IF v_impressao_esp !~ '^[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'MAIKE-04: cole no parâmetro a impressao_inventario (12 caracteres) mostrada pelo 01. Nada foi alterado.';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);

  -- As conferências 1–6 rodam DUAS vezes: antes e depois da trava (rodada 2).
  FOR v_rodada IN 1..2 LOOP
    IF v_rodada = 2 THEN
      LOCK TABLE "AtividadeApontamentoMaoObra","AtividadeApontamentoServico","Servico","AtividadeApontamentoProdutoConsumoLote","AtividadeApontamentoProduto","AtividadeApontamentoMaquina","AtividadeApontamento","AtividadeArea","Atividade","TipoAtividade","HistoricoLancamentoTarefa","LancamentoTarefa","PesoRebanho","PartidaRebanho","EventoRebanho","PosicaoRebanho","RebanhoLedgerAtivacao",
        "OperacaoFinanceiraEvento","LiquidacaoFinanceiraEstorno","LiquidacaoFinanceira","TituloFinanceiro","OperacaoFinanceiraConsumoLote","OperacaoFinanceiraItemRateio","OperacaoFinanceiraItem","OperacaoFinanceiraRateio","OperacaoFinanceira","PerfilFinanceiroEmpresa","AbastecimentoBemConsumoLote","AbastecimentoBem","TanqueBemProduto","TanqueBem","BemPatrimonial","TipoPatrimonial","FamiliaPatrimonial","CentroCustoResultado","CentroCusto","CentroResultado","NaturezaFinanceira","CADESTACOES","CADFORMULACAOREGRA","CADFORMULACAOINGREDIENTE","CADFORMULACAO","LEITURACOCHO","MEDICAOFORRAGEM","CADCULTURAS",
    "AplicacaoMedicamento","AuditLog","Bebedouro","BebedouroAlerta","BebedouroHistorico","BebedouroSanidade",
        "Categoria","CADCATEGORIA","CADCURVAGANHO","ConfiguracaoIcone","Empresa","EntradaEstoqueEvento","EntradaEstoqueItem","EntradaEstoque","MotivoEntradaEstoque","SaidaEstoqueEvento","SaidaEstoqueItem","SaidaEstoque","MotivoSaidaEstoque","AjusteEstoqueEvento","AjusteEstoqueItem","AjusteEstoque","EntidadeCodigoSequencia","EstoqueLoteNota",
        "EventoSanitario","Fornecedor","LinhaGeografica","LocalEstoque",
        "ManejoTecnicoRebanho","Marca","MovimentacaoEstoque","MovimentacaoMapa","MovimentacaoPecuaria",
        "OperacaoIdempotente","Permissao","PontoReferencia","PontoSuplementacao","Produto","RegistroAnexo",
        "SuplementacaoEvento","SuplementacaoLote","UnidadeMedida","Usuario","Lote",
        "TipoTarefa","AreaPastagem","GrupoAtividade","Setor","Cliente","OperadorProdutoMaike" IN EXCLUSIVE MODE;
    END IF;

    -- 1. Alvo.
    IF (SELECT system_identifier::text FROM pg_control_system()) <> v_sid OR current_database() <> v_banco THEN
      RAISE EXCEPTION 'MAIKE-04: este NÃO é o banco esperado. Nada foi alterado.';
    END IF;

    -- 2. 25/25, nenhuma com falha, as 7 da PR com o checksum do repositório.
    IF (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) < 25
       OR EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL)
       OR (SELECT count(*) FROM unnest(c_novas) n
            WHERE EXISTS (SELECT 1 FROM "_prisma_migrations" m
                           WHERE m.migration_name || '=' || m.checksum = n AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)) <> 7 THEN
      RAISE EXCEPTION 'MAIKE-04: migrations fora do esperado (precisa das 25 migrations até a PR #145 e as 7 da PR com o checksum do repositório). Nada foi alterado.';
    END IF;

    -- 3. Conjunto EXATO de tabelas, só tabelas comuns, RLS em todas e nenhum grant público.
    v_esperadas := v_ordem || c_preservadas || ARRAY['_prisma_migrations'];
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE ns.nspname = 'public' AND c.relkind IN ('p','v','m','f')) THEN
      RAISE EXCEPTION 'MAIKE-04: há view/partição/tabela estrangeira em public. Nada foi alterado.';
    END IF;
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_txt
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relname = ANY (v_esperadas));
    IF v_txt IS NOT NULL THEN
      RAISE EXCEPTION 'MAIKE-04: tabela(s) fora do schema conhecido: %. Nada foi alterado.', v_txt;
    END IF;
    IF (SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY (v_esperadas)) <> cardinality(v_esperadas) THEN
      RAISE EXCEPTION 'MAIKE-04: falta tabela esperada em public. Nada foi alterado.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity)
       OR EXISTS (SELECT 1 FROM information_schema.role_table_grants
                   WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')) THEN
      RAISE EXCEPTION 'MAIKE-04: RLS desligado ou grant para anon/authenticated em public. Nada foi alterado.';
    END IF;

    -- 4. cliente_id exatamente nas 82 de tenant (+ OperadorProdutoMaike, preservada).
    IF (SELECT array_agg(table_name::text ORDER BY table_name) FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'cliente_id')
       IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(c_tenant || ARRAY['OperadorProdutoMaike']) x) THEN
      RAISE EXCEPTION 'MAIKE-04: as tabelas com cliente_id não são as esperadas. Nada foi alterado.';
    END IF;

    -- 5. Árvore REAL de FKs: filha antes da mãe; auto-referência só em Categoria;
    --    nenhuma FK de fora do tenant (outro schema ou preservada) com linhas.
    FOR r IN
      SELECT fs.nspname AS esquema_filha, f.relname::text AS filha, m.relname::text AS mae
        FROM pg_constraint c
        JOIN pg_class f ON f.oid = c.conrelid JOIN pg_namespace fs ON fs.oid = f.relnamespace
        JOIN pg_class m ON m.oid = c.confrelid JOIN pg_namespace ms ON ms.oid = m.relnamespace
       WHERE c.contype = 'f' AND ms.nspname = 'public'
    LOOP
      IF r.mae = ANY (v_ordem) AND NOT (r.esquema_filha = 'public' AND r.filha = ANY (v_ordem)) THEN
        EXECUTE format('SELECT count(*) FROM %I.%I', r.esquema_filha, r.filha) INTO v_n;
        IF v_n > 0 THEN
          RAISE EXCEPTION 'MAIKE-04: %.% (fora do tenant) tem linhas que podem referenciar o tenant; revise. Nada foi alterado.', r.esquema_filha, r.filha;
        END IF;
      ELSIF r.esquema_filha = 'public' AND r.filha = ANY (v_ordem) AND r.mae = ANY (v_ordem) THEN
        IF r.filha = r.mae AND r.filha NOT IN ('Categoria', 'CentroCusto', 'CentroResultado', 'NaturezaFinanceira') THEN
          RAISE EXCEPTION 'MAIKE-04: auto-referência inesperada em %. Nada foi alterado.', r.filha;
        END IF;
        IF r.filha <> r.mae AND array_position(v_ordem, r.filha) > array_position(v_ordem, r.mae) THEN
          RAISE EXCEPTION 'MAIKE-04: ordem de FK inválida (% → %). Nada foi alterado.', r.filha, r.mae;
        END IF;
        IF r.filha <> 'Usuario' AND r.mae = 'Usuario' THEN
          NULL; -- filhas da conta saem antes; a conta fica
        ELSIF r.filha = 'Usuario' AND r.mae <> 'Cliente' THEN
          RAISE EXCEPTION 'MAIKE-04: Usuario referencia % (seria apagada sob a conta preservada). Nada foi alterado.', r.mae;
        END IF;
      END IF;
    END LOOP;

    -- 6. Exatamente 1 cliente "maike" ativo e 1 conta "maike" ativa nele; todo o tenant é dele.
    IF (SELECT count(*) FROM "Cliente") <> 1
       OR (SELECT count(*) FROM "Cliente" WHERE codigo = 'maike' AND ativo) <> 1
       OR (SELECT count(*) FROM "Usuario") <> 1
       OR (SELECT count(*) FROM "Usuario" u JOIN "Cliente" c ON c.id = u.cliente_id
            WHERE u.login = 'maike' AND u.ativo AND c.codigo = 'maike' AND c.ativo) <> 1 THEN
      RAISE EXCEPTION 'MAIKE-04: ANOMALIA — o banco não tem exatamente 1 cliente "maike" ativo com 1 conta "maike" ativa (e mais nada). Nada foi alterado.';
    END IF;
    SELECT id INTO v_cliente_id FROM "Cliente" WHERE codigo = 'maike';
    FOREACH v_tab IN ARRAY c_tenant LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE cliente_id IS DISTINCT FROM $1', v_tab) INTO v_n USING v_cliente_id;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'MAIKE-04: % tem linhas de outro cliente. Nada foi alterado.', v_tab;
      END IF;
    END LOOP;
  END LOOP;

  -- 7. Já no estado final? (rerun) — não muda nada.
  SELECT count(*) INTO v_n FROM unnest(c_tenant) t WHERE t NOT IN ('Usuario', 'AuditLog')
     AND (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t), false, true, '')))[1]::text::int > 0;
  IF v_n = 0
     AND NOT EXISTS (SELECT 1 FROM "AuditLog" WHERE acao NOT IN ('ops_inicializacao', 'papel_tenant'))
     AND (SELECT count(*) FROM "AuditLog") >= 2
     AND (SELECT papel_tenant FROM "Usuario") = 'administrador' THEN
    INSERT INTO maike_limpeza_resultado VALUES
      ('JA_INICIALIZADO', 'maike', 'administrador', 0, 'Nada foi alterado. Confira com o 03-postcheck.');
    RETURN;
  END IF;
  -- Já inicializado antes e com dados novos: são dados de uso, não de teste.
  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE acao = 'ops_inicializacao') THEN
    RAISE EXCEPTION 'MAIKE-04: ANOMALIA — o tenant já foi inicializado e tem dados novos (de uso, não de teste). Nada foi apagado.';
  END IF;

  -- 8. Impressão do inventário com as tabelas travadas (mesma fórmula do 01).
  SELECT left(md5('v1|'
           || (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')) || '|'
           || (SELECT string_agg(t.nome || '=' ||
                 (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.nome), false, true, '')))[1]::text,
                 ',' ORDER BY t.ord)
                 FROM unnest(v_ordem) WITH ORDINALITY AS t(nome, ord)) || '|'
           || (SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM "Cliente")), 12)
    INTO v_impressao;
  IF v_impressao <> v_impressao_esp THEN
    RAISE EXCEPTION 'MAIKE-04: o inventário mudou desde o 01 (impressão %, esperada %): rode o 01 de novo e confira. Nada foi alterado.', v_impressao, v_impressao_esp;
  END IF;

  -- 9. Retrato do que tem de ficar igual (comparado só aqui dentro; nada é impresso).
  SELECT id, papel_tenant, md5(senha_hash),
         md5(concat_ws('|', id, cliente_id, login, nome, ativo::text, senha_hash, "createdAt"::text))
    INTO v_usuario_id, v_papel_antes, v_hash_antes, v_usuario_antes FROM "Usuario";
  SELECT md5(concat_ws('|', id, codigo, nome, ativo::text, "createdAt"::text, "updatedAt"::text)) INTO v_cliente_antes FROM "Cliente";
  SELECT string_agg(p || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', p), false, true, '')))[1]::text, ',' ORDER BY p)
    INTO v_preservadas_antes FROM unnest(c_preservadas) p;
  SELECT md5(string_agg(migration_name || ':' || checksum || ':' || coalesce(finished_at::text, '-') || ':' || coalesce(rolled_back_at::text, '-'), ',' ORDER BY migration_name, started_at))
    INTO v_mig_antes FROM "_prisma_migrations";
  SELECT md5((SELECT string_agg(relname || ':' || relrowsecurity::text, ',' ORDER BY relname) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE ns.nspname = 'public' AND c.relkind = 'r')
             || '|' || (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public')
             || '|' || (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'))
    INTO v_seguranca_antes;

  -- 10. Apaga só o teste do cliente "maike", exceto a própria conta (auto-referência primeiro).
  UPDATE "Categoria" SET categoria_pai_id = NULL WHERE cliente_id = v_cliente_id AND categoria_pai_id IS NOT NULL;
  -- D-PROD-146: árvores dos centros (FK composta com pai_id anulável).
  UPDATE "CentroCusto" SET pai_id = NULL WHERE cliente_id = v_cliente_id AND pai_id IS NOT NULL;
  UPDATE "CentroResultado" SET pai_id = NULL WHERE cliente_id = v_cliente_id AND pai_id IS NOT NULL;
  -- D-PROD-153: árvore das naturezas financeiras (FK composta com pai_id anulável).
  UPDATE "NaturezaFinanceira" SET pai_id = NULL WHERE cliente_id = v_cliente_id AND pai_id IS NOT NULL;
  FOREACH v_tab IN ARRAY c_tenant LOOP
    CONTINUE WHEN v_tab = 'Usuario';
    EXECUTE format('DELETE FROM public.%I WHERE cliente_id = $1', v_tab) USING v_cliente_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_apagadas := v_apagadas || jsonb_build_object(v_tab, v_n); END IF;
    v_total := v_total + v_n;
  END LOOP;

  -- 11. Promove a conta existente (só o papel) e audita, sem credencial.
  -- S04-P1: mudança de privilégio encerra as sessões anteriores da conta.
  UPDATE "Usuario" SET papel_tenant = 'administrador', sessao_epoca = COALESCE(sessao_epoca, 0) + 1, "updatedAt" = now() WHERE id = v_usuario_id;
  v_req := 'ops-sqleditor-04-' || gen_random_uuid()::text;
  INSERT INTO "AuditLog" (id, cliente_id, usuario_id, acao, entidade, entidade_id, dados_anteriores, dados_novos, request_id, "createdAt", "updatedAt")
    VALUES
    ('c' || substr(md5(gen_random_uuid()::text), 1, 24), v_cliente_id, NULL, 'ops_inicializacao', 'Cliente', v_cliente_id,
     jsonb_build_object('linhas_apagadas', v_total, 'por_tabela', v_apagadas),
     jsonb_build_object('cliente_codigo', 'maike', 'conta_login', 'maike', 'conta_preservada', true,
                        'via', 'scripts/ops/sql-editor/04-limpeza-preservando-maike.sql'),
     v_req, now(), now()),
    ('c' || substr(md5(gen_random_uuid()::text), 1, 24), v_cliente_id, NULL, 'papel_tenant', 'Usuario', v_usuario_id,
     jsonb_build_object('papel_tenant', v_papel_antes, 'motivo', 'bootstrap autorizado pelo proprietário, conta existente preservada'),
     jsonb_build_object('papel_tenant', 'administrador', 'via', 'scripts/ops/sql-editor/04-limpeza-preservando-maike.sql'),
     v_req, now(), now());

  -- 12. Estado final antes do COMMIT (qualquer desvio desfaz tudo).
  FOREACH v_tab IN ARRAY c_tenant LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_tab) INTO v_n;
    IF v_n <> (CASE v_tab WHEN 'Usuario' THEN 1 WHEN 'AuditLog' THEN 2 ELSE 0 END) THEN
      RAISE EXCEPTION 'MAIKE-04: estado final inesperado em % (%); desfeito.', v_tab, v_n;
    END IF;
  END LOOP;
  IF (SELECT md5(concat_ws('|', id, codigo, nome, ativo::text, "createdAt"::text, "updatedAt"::text)) FROM "Cliente") IS DISTINCT FROM v_cliente_antes
     OR (SELECT count(*) FROM "Cliente") <> 1 THEN
    RAISE EXCEPTION 'MAIKE-04: o cliente mudou; desfeito.';
  END IF;
  IF (SELECT md5(concat_ws('|', id, cliente_id, login, nome, ativo::text, senha_hash, "createdAt"::text)) FROM "Usuario") IS DISTINCT FROM v_usuario_antes
     OR (SELECT md5(senha_hash) FROM "Usuario") IS DISTINCT FROM v_hash_antes
     OR (SELECT id FROM "Usuario") IS DISTINCT FROM v_usuario_id
     OR (SELECT papel_tenant FROM "Usuario") <> 'administrador' THEN
    RAISE EXCEPTION 'MAIKE-04: a conta mudou além do papel; desfeito.';
  END IF;
  SELECT string_agg(p || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', p), false, true, '')))[1]::text, ',' ORDER BY p)
    INTO v_preservadas_depois FROM unnest(c_preservadas) p;
  SELECT md5(string_agg(migration_name || ':' || checksum || ':' || coalesce(finished_at::text, '-') || ':' || coalesce(rolled_back_at::text, '-'), ',' ORDER BY migration_name, started_at))
    INTO v_mig_depois FROM "_prisma_migrations";
  SELECT md5((SELECT string_agg(relname || ':' || relrowsecurity::text, ',' ORDER BY relname) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                WHERE ns.nspname = 'public' AND c.relkind = 'r')
             || '|' || (SELECT count(*)::text FROM information_schema.role_table_grants WHERE table_schema = 'public')
             || '|' || (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public'))
    INTO v_seguranca_depois;
  IF v_preservadas_depois IS DISTINCT FROM v_preservadas_antes OR v_mig_depois IS DISTINCT FROM v_mig_antes
     OR v_seguranca_depois IS DISTINCT FROM v_seguranca_antes THEN
    RAISE EXCEPTION 'MAIKE-04: preservadas, migrations, RLS, grants ou políticas mudaram; desfeito.';
  END IF;

  INSERT INTO maike_limpeza_resultado VALUES
    ('CONCLUIDO', 'maike', 'administrador', v_total,
     'Conta e senha preservadas; só o papel mudou. Rode o 03-postcheck.');
END
$maike$;

SELECT status, conta_login, papel_tenant, linhas_apagadas, observacao FROM maike_limpeza_resultado;
