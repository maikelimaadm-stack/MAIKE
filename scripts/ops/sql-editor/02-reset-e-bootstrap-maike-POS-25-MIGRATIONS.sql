-- =============================================================================
-- MAIKE · PR #145 · 02 — APAGA OS DADOS DE TESTE E CRIA O TENANT "maike"
--                                  com a conta "maike" (ADMINISTRADOR DA FAZENDA)
--                                                              D-PROD-74 (G4-R2)
-- -----------------------------------------------------------------------------
-- SÓ DEPOIS de: (1) as 7 migrations aplicadas pelo runner oficial
-- (npm run deploy:migrate) e (2) o 01-precheck mostrar "PRONTO PARA O 02".
--
-- COMO USAR (Supabase → projeto MAIKE → SQL Editor → New query):
--   1. Cole este arquivo INTEIRO.
--   2. No bloco PARÂMETROS abaixo, troque SÓ o texto COLE_AQUI_A_IMPRESSAO pelo
--      código "impressao_inventario" que o 01 mostrou (12 letras/números).
--   3. Clique Run UMA vez, com o arquivo inteiro (nada selecionado).
--   4. O resultado mostra a SENHA da conta "maike" UMA ÚNICA VEZ: copie-a já
--      para o seu gerenciador de senhas. Ela não fica gravada em lugar nenhum
--      (só o hash bcrypt) e NÃO aparece de novo.
--   5. Rode o 03-postcheck.
--
-- GARANTIAS (falha fechada; qualquer erro desfaz TUDO, nada parcial):
--   - Tudo roda numa única transação: se o editor não executar o arquivo
--     inteiro de uma vez, ele para ANTES de alterar qualquer coisa.
--   - Confere o banco (system_identifier + nome do banco), 25/25 migrations,
--     o conjunto EXATO de 53 tabelas, só tabelas comuns em public, as colunas
--     cliente_id esperadas, a ordem das FKs, nenhuma linha de tabela
--     preservada apontando para o tenant, e a impressão do inventário (com as
--     tabelas travadas contra escrita — mudança desde o 01 = para).
--   - Apaga SOMENTE linhas das 38 tabelas de tenant (por cliente_id) e os
--     clientes de teste. Nunca toca _prisma_migrations, catálogo global,
--     identidade do proprietário (MAIKE Admin), auth, storage, schema, RLS,
--     grants. Sem DROP/TRUNCATE/DDL.
--   - Cria 1 cliente "maike" e 1 conta "maike" (Maike) ativa com
--     papel_tenant = 'administrador', com AuditLog da inicialização e da
--     concessão do papel. Não usa Permissao.is_admin.
--   - Senha: 24 caracteres aleatórios gerados NO BANCO (gen_random_bytes);
--     grava só o hash bcrypt (custo 10, compatível com o login do MAIKE).
--   - Reexecutar no estado já inicializado: não altera nada e NÃO mostra senha.
--     Estado "maike" + outros dados: ANOMALIA, não apaga nada.
-- =============================================================================

-- >>> PARÂMETROS (troque só COLE_AQUI_A_IMPRESSAO) ------------------------------
SET LOCAL maike_op.sid = '7692130048193495360';
SET LOCAL maike_op.banco = 'postgres';
SET LOCAL maike_op.clientes = '1';
SET LOCAL maike_op.impressao = 'COLE_AQUI_A_IMPRESSAO';
-- <<< FIM DOS PARÂMETROS --------------------------------------------------------

-- Resultado só desta transação (some no COMMIT; se o editor não rodar tudo numa
-- transação, esta tabela já não existe quando o bloco abaixo conferir → para).
CREATE TEMP TABLE maike_bootstrap_resultado (
  status text, conta_login text, senha_mostrada_uma_vez text, linhas_apagadas int, observacao text
) ON COMMIT DROP;

DO $maike$
DECLARE
  -- Ordem segura de exclusão (filha → mãe), conferida contra as FKs reais abaixo.
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
  c_novas constant text[] := ARRAY[
    '20261028250000_catalogo_global_slice1','20261028250100_catalogo_global_slice1_schema_fix',
    '20261028250200_catalogo_global_slice1_r1_assets','20261029100000_scale01_usuario_keyset_index',
    '20261029200000_categoria_manejo_vinculo_catalogo','20261029300000_admin_principal_maike',
    '20261029400000_usuario_papel_tenant'];
  v_ordem text[] := c_tenant || ARRAY['Cliente'];
  v_esperadas text[];
  v_sid text; v_banco text; v_clientes_esp int; v_impressao_esp text;
  v_impressao text; v_ids text[]; v_n int; v_total int := 0; v_tab text; v_txt text;
  v_preservadas_antes text; v_preservadas_depois text; v_mig_antes int; v_mig_depois int;
  v_cliente_maike int; v_login_maike int; v_extra int; v_aud_fora int;
  v_cliente_id text; v_usuario_id text; v_senha text; v_hash text; v_req text;
  r record;
BEGIN
  -- 0. Executado como um todo, numa única transação, com os parâmetros desta execução?
  IF to_regclass('pg_temp.maike_bootstrap_resultado') IS NULL THEN
    RAISE EXCEPTION 'MAIKE-02: rode o arquivo INTEIRO de uma vez (Run sem seleção). Nada foi alterado.';
  END IF;
  v_sid := current_setting('maike_op.sid', true);
  v_banco := current_setting('maike_op.banco', true);
  v_clientes_esp := nullif(current_setting('maike_op.clientes', true), '')::int;
  v_impressao_esp := current_setting('maike_op.impressao', true);
  IF v_sid IS NULL OR v_banco IS NULL OR v_clientes_esp IS NULL OR v_impressao_esp IS NULL THEN
    RAISE EXCEPTION 'MAIKE-02: parâmetros ausentes (rode o arquivo inteiro). Nada foi alterado.';
  END IF;
  IF v_impressao_esp !~ '^[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'MAIKE-02: cole no parâmetro a impressao_inventario (12 caracteres) mostrada pelo 01. Nada foi alterado.';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);

  -- 1. Alvo.
  IF (SELECT system_identifier::text FROM pg_control_system()) <> v_sid OR current_database() <> v_banco THEN
    RAISE EXCEPTION 'MAIKE-02: este NÃO é o banco esperado. Nada foi alterado.';
  END IF;

  -- 2. Schema: as 25 migrations concluídas, nenhuma com falha, as 7 da PR presentes.
  SELECT count(*) INTO v_mig_antes FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF v_mig_antes < 25
     OR EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL)
     OR (SELECT count(*) FROM unnest(c_novas) n
          WHERE EXISTS (SELECT 1 FROM "_prisma_migrations" m WHERE m.migration_name = n AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL)) <> 7 THEN
    RAISE EXCEPTION 'MAIKE-02: as 7 migrations ainda não foram aplicadas pelo runner oficial (precisa das 25 migrations até a PR #145). Nada foi alterado.';
  END IF;

  -- 3. Conjunto EXATO de tabelas; nada além de tabelas comuns em public.
  v_esperadas := v_ordem || c_preservadas || ARRAY['_prisma_migrations'];
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relkind IN ('p','v','m','f')) THEN
    RAISE EXCEPTION 'MAIKE-02: há view/partição/tabela estrangeira em public; revise antes. Nada foi alterado.';
  END IF;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_txt
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relname = ANY (v_esperadas));
  IF v_txt IS NOT NULL THEN
    RAISE EXCEPTION 'MAIKE-02: tabela(s) fora do schema conhecido: %. Nada foi alterado.', v_txt;
  END IF;
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY (v_esperadas)) <> cardinality(v_esperadas) THEN
    RAISE EXCEPTION 'MAIKE-02: falta tabela esperada em public. Nada foi alterado.';
  END IF;

  -- 4. cliente_id exatamente nas 38 de tenant (+ OperadorProdutoMaike, preservada).
  IF (SELECT array_agg(table_name::text ORDER BY table_name) FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'cliente_id')
     IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(c_tenant || ARRAY['OperadorProdutoMaike']) x) THEN
    RAISE EXCEPTION 'MAIKE-02: as tabelas com cliente_id não são as esperadas. Nada foi alterado.';
  END IF;

  -- 5. Ordem de FK: toda filha sai antes da mãe; auto-referência só em Categoria (anulável).
  FOR r IN
    SELECT c.conrelid::regclass::text AS filha_q, c.confrelid::regclass::text AS mae_q,
           (SELECT relname FROM pg_class WHERE oid = c.conrelid)::text AS filha,
           (SELECT relname FROM pg_class WHERE oid = c.confrelid)::text AS mae
      FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
     WHERE c.contype = 'f' AND ns.nspname = 'public'
  LOOP
    IF r.mae = ANY (v_ordem) AND NOT (r.filha = ANY (v_ordem)) THEN
      -- preservada → tenant: só pode existir se a preservada não referenciar ninguém
      EXECUTE format('SELECT count(*) FROM public.%I', r.filha) INTO v_n;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'MAIKE-02: a tabela preservada % tem linhas que podem referenciar o tenant; revise. Nada foi alterado.', r.filha;
      END IF;
    ELSIF r.filha = ANY (v_ordem) AND r.mae = ANY (v_ordem) THEN
      IF r.filha = r.mae AND r.filha <> 'Categoria' THEN
        RAISE EXCEPTION 'MAIKE-02: auto-referência inesperada em %. Nada foi alterado.', r.filha;
      END IF;
      IF r.filha <> r.mae AND array_position(v_ordem, r.filha) > array_position(v_ordem, r.mae) THEN
        RAISE EXCEPTION 'MAIKE-02: ordem de FK inválida (% → %). Nada foi alterado.', r.filha, r.mae;
      END IF;
    END IF;
  END LOOP;

  -- 6. Estado: já inicializado / anômalo / a inicializar.
  SELECT count(*) INTO v_cliente_maike FROM "Cliente" WHERE codigo = 'maike';
  SELECT count(*) INTO v_login_maike FROM "Usuario" WHERE lower(login) = 'maike';
  IF v_cliente_maike + v_login_maike > 0 THEN
    SELECT count(*) INTO v_aud_fora FROM "AuditLog" WHERE acao NOT IN ('ops_inicializacao', 'papel_tenant');
    v_extra := 0;
    FOREACH v_tab IN ARRAY c_tenant LOOP
      CONTINUE WHEN v_tab IN ('Usuario', 'AuditLog');
      EXECUTE format('SELECT count(*) FROM public.%I', v_tab) INTO v_n;
      v_extra := v_extra + v_n;
    END LOOP;
    IF (SELECT count(*) FROM "Cliente") = 1 AND v_cliente_maike = 1
       AND (SELECT count(*) FROM "Usuario") = 1 AND v_login_maike = 1
       AND EXISTS (SELECT 1 FROM "Usuario" u JOIN "Cliente" c ON c.id = u.cliente_id
                    WHERE c.codigo = 'maike' AND u.login = 'maike' AND u.ativo AND c.ativo AND u.papel_tenant = 'administrador')
       AND v_extra = 0 AND v_aud_fora = 0 THEN
      INSERT INTO maike_bootstrap_resultado VALUES
        ('JA_INICIALIZADO', 'maike', NULL, 0, 'Nada foi alterado. A senha NÃO é mostrada de novo (use a que você guardou ou troque-a no MAIKE).');
      RETURN;
    END IF;
    RAISE EXCEPTION 'MAIKE-02: ANOMALIA — o cliente/login "maike" já existe junto com outros dados ou com papel diferente de administrador. Nada foi apagado; revisão humana.';
  END IF;

  -- 7. Trava as tabelas de tenant contra escrita e confere a impressão do inventário.
  LOCK TABLE "AplicacaoMedicamento","AuditLog","Bebedouro","BebedouroAlerta","BebedouroHistorico","BebedouroSanidade",
    "Categoria","CategoriaManejo","ConfiguracaoIcone","Empresa","EntidadeCodigoSequencia","EstoqueLoteNota",
    "EventoSanitario","Fornecedor","HistoricoLancamentoTarefa","LinhaGeografica","LocalEstoque",
    "ManejoTecnicoRebanho","Marca","MovimentacaoEstoque","MovimentacaoMapa","MovimentacaoPecuaria",
    "OperacaoIdempotente","Permissao","PontoReferencia","PontoSuplementacao","Produto","RegistroAnexo",
    "SuplementacaoEvento","SuplementacaoLote","UnidadeMedida","LancamentoTarefa","Usuario","Lote",
    "TipoTarefa","AreaPastagem","GrupoAtividade","Setor","Cliente" IN EXCLUSIVE MODE;
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
    RAISE EXCEPTION 'MAIKE-02: o inventário mudou desde o 01 (impressão %, esperada %): rode o 01 de novo e confira. Nada foi alterado.', v_impressao, v_impressao_esp;
  END IF;
  SELECT array_agg(id ORDER BY id) INTO v_ids FROM "Cliente";
  IF coalesce(cardinality(v_ids), 0) <> v_clientes_esp THEN
    RAISE EXCEPTION 'MAIKE-02: % cliente(s) no banco; o parâmetro autoriza %. Nada foi alterado.', coalesce(cardinality(v_ids), 0), v_clientes_esp;
  END IF;

  SELECT string_agg(p || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', p), false, true, '')))[1]::text, ',' ORDER BY p)
    INTO v_preservadas_antes FROM unnest(c_preservadas) p;

  -- 8. Apaga só as linhas dos clientes de teste (auto-referência de Categoria primeiro).
  UPDATE "Categoria" SET categoria_pai_id = NULL WHERE cliente_id = ANY (v_ids) AND categoria_pai_id IS NOT NULL;
  FOREACH v_tab IN ARRAY c_tenant LOOP
    EXECUTE format('DELETE FROM public.%I WHERE cliente_id = ANY ($1)', v_tab) USING v_ids;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;
  DELETE FROM "Cliente" WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total := v_total + v_n;

  -- 9. Cria o tenant técnico e a conta administradora (senha só na memória desta transação).
  v_cliente_id := 'c' || substr(md5(gen_random_uuid()::text), 1, 24);
  v_usuario_id := 'c' || substr(md5(gen_random_uuid()::text), 1, 24);
  v_senha := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
  v_hash := extensions.crypt(v_senha, extensions.gen_salt('bf', 10));
  v_req := 'ops-sqleditor-' || gen_random_uuid()::text;
  INSERT INTO "Cliente" (id, codigo, nome, ativo, "createdAt", "updatedAt")
    VALUES (v_cliente_id, 'maike', 'MAIKE', true, now(), now());
  INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, ativo, papel_tenant, "createdAt", "updatedAt")
    VALUES (v_usuario_id, v_cliente_id, 'Maike', 'maike', v_hash, true, 'administrador', now(), now());
  INSERT INTO "AuditLog" (id, cliente_id, usuario_id, acao, entidade, entidade_id, dados_anteriores, dados_novos, request_id, "createdAt", "updatedAt")
    VALUES
    ('c' || substr(md5(gen_random_uuid()::text), 1, 24), v_cliente_id, NULL, 'ops_inicializacao', 'Cliente', v_cliente_id,
     jsonb_build_object('clientes', cardinality(v_ids), 'linhas', v_total),
     jsonb_build_object('cliente_codigo', 'maike', 'conta_login', 'maike', 'via', 'scripts/ops/sql-editor/02-reset-e-bootstrap-maike-POS-25-MIGRATIONS.sql'),
     v_req, now(), now()),
    ('c' || substr(md5(gen_random_uuid()::text), 1, 24), v_cliente_id, NULL, 'papel_tenant', 'Usuario', v_usuario_id,
     jsonb_build_object('papel_tenant', NULL, 'motivo', 'bootstrap inicial autorizado pelo proprietário'),
     jsonb_build_object('papel_tenant', 'administrador', 'via', 'scripts/ops/sql-editor/02-reset-e-bootstrap-maike-POS-25-MIGRATIONS.sql'),
     v_req, now(), now());

  -- 10. Confere o estado final antes do COMMIT (qualquer desvio desfaz tudo).
  IF extensions.crypt(v_senha, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'MAIKE-02: verificação do hash falhou; desfeito.';
  END IF;
  FOREACH v_tab IN ARRAY c_tenant LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_tab) INTO v_n;
    IF v_n <> (CASE v_tab WHEN 'Usuario' THEN 1 WHEN 'AuditLog' THEN 2 ELSE 0 END) THEN
      RAISE EXCEPTION 'MAIKE-02: estado final inesperado em % (%); desfeito.', v_tab, v_n;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM "Cliente") <> 1 THEN RAISE EXCEPTION 'MAIKE-02: estado final inesperado em Cliente; desfeito.'; END IF;
  SELECT string_agg(p || '=' || (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', p), false, true, '')))[1]::text, ',' ORDER BY p)
    INTO v_preservadas_depois FROM unnest(c_preservadas) p;
  SELECT count(*) INTO v_mig_depois FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF v_preservadas_depois IS DISTINCT FROM v_preservadas_antes OR v_mig_depois <> v_mig_antes THEN
    RAISE EXCEPTION 'MAIKE-02: tabelas preservadas ou migrations mudaram; desfeito.';
  END IF;

  INSERT INTO maike_bootstrap_resultado VALUES
    ('CONCLUIDO', 'maike', v_senha, v_total,
     'Copie a senha AGORA para o seu gerenciador de senhas: ela não fica gravada e não aparece de novo. Depois rode o 03-postcheck.');
END
$maike$;

SELECT status, conta_login, senha_mostrada_uma_vez, linhas_apagadas, observacao FROM maike_bootstrap_resultado;
