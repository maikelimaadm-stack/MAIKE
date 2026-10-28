-- Papéis mínimos da Data API do Supabase para laboratório local/CI.
-- Não concede privilégios em tabelas — só cria os roles NOLOGIN e permite
-- que o usuário da aplicação faça SET ROLE neles nos testes P8.
--
-- Aplicar como superuser uma vez por cluster (Postgres do host):
--   sudo -u postgres psql -d maike_dev -f scripts/db/lab-supabase-api-roles.sql
--
-- No Docker Compose oficial do MAIKE, `POSTGRES_USER=maike` é superuser do
-- container: o próprio teste P8 consegue CREATE ROLE. Este arquivo é para
-- clusters onde o app user NÃO tem CREATEROLE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike') THEN
    EXECUTE 'GRANT anon TO maike';
    EXECUTE 'GRANT authenticated TO maike';
  END IF;
END $$;
