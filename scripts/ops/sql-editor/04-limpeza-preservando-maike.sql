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
--     o conjunto EXATO de 53 tabelas, cliente_id, ordem das FKs, nenhuma FK de
--     fora do tenant com linhas, RLS e grants; exatamente 1 cliente ("maike",
--     ativo) e 1 conta ("maike", ativa, nesse cliente); todas as linhas de tenant
--     desse cliente. Trava as tabelas e RECONFERE tudo, inclusive a impressão.
--   - Apaga SOMENTE as linhas das 38 tabelas de tenant do cliente "maike",
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
    'AplicacaoMedicamento','AuditLog','Bebedouro','BebedouroAlerta','BebedouroHistorico','BebedouroSanidade',
    'Categoria','CategoriaManejo','ConfiguracaoIcone','Empresa','EntidadeCodigoSequencia','EstoqueLoteNota',
    'EventoSanitario','Fornecedor','HistoricoLancamentoTarefa','LinhaGeografica','LocalEstoque',
    'ManejoTecnicoRebanho','Marca','MovimentacaoEstoque','MovimentacaoMapa','MovimentacaoPecuaria',
    'OperacaoIdempotente','Permissao','PontoReferencia','PontoSuplementacao','Produto','RegistroAnexo',
    'SuplementacaoEvento','SuplementacaoLote','UnidadeMedida','LancamentoTarefa','Usuario','Lote',
    'TipoTarefa','AreaPastagem','GrupoAtividade','Setor'];
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
      LOCK TABLE "AplicacaoMedicamento","AuditLog","Bebedouro","BebedouroAlerta","BebedouroHistorico","BebedouroSanidade",
        "Categoria","CategoriaManejo","ConfiguracaoIcone","Empresa","EntidadeCodigoSequencia","EstoqueLoteNota",
        "EventoSanitario","Fornecedor","HistoricoLancamentoTarefa","LinhaGeografica","LocalEstoque",
        "ManejoTecnicoRebanho","Marca","MovimentacaoEstoque","MovimentacaoMapa","MovimentacaoPecuaria",
        "OperacaoIdempotente","Permissao","PontoReferencia","PontoSuplementacao","Produto","RegistroAnexo",
        "SuplementacaoEvento","SuplementacaoLote","UnidadeMedida","LancamentoTarefa","Usuario","Lote",
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

    -- 4. cliente_id exatamente nas 38 de tenant (+ OperadorProdutoMaike, preservada).
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
        IF r.filha = r.mae AND r.filha <> 'Categoria' THEN
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
  FOREACH v_tab IN ARRAY c_tenant LOOP
    CONTINUE WHEN v_tab = 'Usuario';
    EXECUTE format('DELETE FROM public.%I WHERE cliente_id = $1', v_tab) USING v_cliente_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN v_apagadas := v_apagadas || jsonb_build_object(v_tab, v_n); END IF;
    v_total := v_total + v_n;
  END LOOP;

  -- 11. Promove a conta existente (só o papel) e audita, sem credencial.
  UPDATE "Usuario" SET papel_tenant = 'administrador', "updatedAt" = now() WHERE id = v_usuario_id;
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
