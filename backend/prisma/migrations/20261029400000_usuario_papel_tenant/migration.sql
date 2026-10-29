-- PR145-R4 (D-PROD-71) — autoridade de administrador da fazenda, server-owned.
--
-- Aditiva e SEM promoção: todos os usuários existentes ficam `usuario`. Ninguém
-- vira administrador por esta migration (nem o primeiro usuário de cada tenant,
-- nem quem tem `Permissao.is_admin = true`). A atribuição é individual e
-- explícita, pelo script operacional `scripts/auth/papel-tenant.mjs` (runbook).
--
-- Reversível (antes, voltar o backend para versão que não leia a coluna):
--   ALTER TABLE "Usuario" DROP CONSTRAINT "Usuario_papel_tenant_check";
--   ALTER TABLE "Usuario" DROP COLUMN "papel_tenant";

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "papel_tenant" VARCHAR(32) NOT NULL DEFAULT 'usuario';

-- Valores fechados: um typo não pode virar papel novo.
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_papel_tenant_check" CHECK ("papel_tenant" IN ('usuario', 'administrador'));
