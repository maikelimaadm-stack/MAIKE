-- Runbook: bucket Storage do catálogo global (D-PROD-57 / slice 1 R1).
-- Executar somente em ambiente controlado (dashboard Supabase ou credencial admin).
-- NÃO executar automaticamente em CI/produção nesta missão.

-- 1) Criar bucket (público para leitura de assets oficiais; upload só service_role/backend)
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('maike-catalogo-global', 'maike-catalogo-global', true)
-- ON CONFLICT (id) DO NOTHING;

-- 2) Variáveis server-only no backend (Vercel / .env — nunca VITE_):
--    SUPABASE_URL
--    SUPABASE_SERVICE_ROLE_KEY
--    CATALOGO_STORAGE_BUCKET=maike-catalogo-global (opcional, default no código)

-- 3) Convenção de objetos: v{revisao_catalogo}/{sha256_prefix}.{ext}
--    x-upsert: false — overwrite silencioso proibido; nova revisão de catálogo → novo prefixo.

-- 4) Pós-merge backend: npm run deploy:migrate (ou prisma migrate deploy)
-- 5) Bootstrap operador: scripts/catalogo/bootstrap-operador-produto.mjs
