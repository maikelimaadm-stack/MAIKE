-- Bootstrap idempotente do bucket de assets do catálogo global (D-PROD-57).
-- Executar somente em ambiente controlado com credencial de service role / dashboard.
-- NÃO executar automaticamente em produção nesta slice.

-- Supabase Storage buckets são criados via API ou dashboard; este script documenta
-- a política esperada:
--   • bucket: maike-catalogo-global (ou CATALOGO_STORAGE_BUCKET)
--   • leitura pública SELECT apenas para objetos publicados (política restrita)
--   • INSERT/UPDATE/DELETE apenas service_role / backend

-- Exemplo via SQL (storage schema) — requer permissões de admin Storage:
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('maike-catalogo-global', 'maike-catalogo-global', true)
-- ON CONFLICT (id) DO NOTHING;
