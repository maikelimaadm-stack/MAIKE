-- P8 / D-PROD-56 — bloquear Data API (anon/authenticated) em public
-- e habilitar RLS sem políticas abertas para papéis de PostgREST.
--
-- Contexto (Supabase MAIKE, 2026-10-28):
--   • 40 tabelas public com relrowsecurity = false
--   • anon + authenticated com SELECT/INSERT/UPDATE/DELETE em todas
--   • App MAIKE acessa só via Fastify/Prisma (papel de servidor), sem supabase-js
--
-- Estratégia:
--   1. REVOKE de anon/authenticated em tabelas, sequências e rotinas de public
--   2. ALTER DEFAULT PRIVILEGES para o grantor efetivo (postgres / current_user)
--      não recriar grants inseguros em objetos novos
--   3. ENABLE ROW LEVEL SECURITY em toda tabela public (SEM FORCE)
--   4. Política explícita só para o papel de backend `maike_vercel` (se existir),
--      porque ele NÃO tem BYPASSRLS e não é owner — sem política o Prisma quebra.
--      Políticas USING (true) para anon/authenticated são PROIBIDAS.
--
-- Isolamento multi-tenant permanece na API (cliente_id / empresa_id).
-- NÃO aplica auth.uid() — o JWT do MAIKE não popula claim Supabase Auth.
-- NÃO toca schemas auth/storage/realtime.
--
-- Idempotente: REVOKE/ENABLE RLS/DROP+CREATE POLICY e ALTER DEFAULT PRIVILEGES
-- podem rodar de novo sem erro. Papéis ausentes (lab local) são ignorados.

-- ---------------------------------------------------------------------------
-- 1) Revogar privilégios de papéis da Data API
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Default privileges — futuras tabelas/sequências/funções do grantor
--    Não tenta alterar defaults de supabase_admin (exige privilégio de owner
--    daquele papel); isso fica no runbook operacional se ainda restar ACL.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  grantor_name text;
BEGIN
  FOREACH grantor_name IN ARRAY ARRAY['postgres', current_user::text]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantor_name) THEN
      CONTINUE;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon',
        grantor_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon',
        grantor_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon',
        grantor_name
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated',
        grantor_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated',
        grantor_name
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated',
        grantor_name
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Habilitar RLS em todas as tabelas public (inclui _prisma_migrations)
--    SEM FORCE ROW LEVEL SECURITY — owner e papéis com bypassrls (postgres,
--    service_role) continuam operacionais para migrate/admin.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT c.relname AS nome
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.nome);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Backend role maike_vercel: acesso total sob RLS (tenant fica na API)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl record;
  pol_name constant text := 'maike_backend_all';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') THEN
    RETURN;
  END IF;

  FOR tbl IN
    SELECT c.relname AS nome
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      pol_name,
      tbl.nome
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO maike_vercel USING (true) WITH CHECK (true)',
      pol_name,
      tbl.nome
    );
  END LOOP;
END $$;
