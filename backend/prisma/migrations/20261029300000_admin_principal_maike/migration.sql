-- PR145-R3 (D-PROD-70) — identidade independente do proprietário do produto MAIKE.
--
-- Tabelas globais do PRODUTO (sem cliente_id): não pertencem a tenant e não dão
-- acesso a dados de tenant. A coluna `AuditoriaCatalogoGlobal.admin_id` é aditiva;
-- registros históricos continuam com `operador_id`.
--
-- Aditiva e reversível (antes, voltar o backend para versão que não use estas tabelas):
--   ALTER TABLE "AuditoriaCatalogoGlobal" DROP CONSTRAINT "AuditoriaCatalogoGlobal_admin_id_fkey";
--   DROP INDEX "AuditoriaCatalogoGlobal_admin_id_createdAt_idx";
--   ALTER TABLE "AuditoriaCatalogoGlobal" DROP COLUMN "admin_id";
--   DROP TABLE "EventoSegurancaAdminMaike", "CodigoRecuperacaoAdminMaike", "SessaoAdminMaike", "AdminPrincipalMaike";

-- AlterTable
ALTER TABLE "AuditoriaCatalogoGlobal" ADD COLUMN     "admin_id" VARCHAR(64);

-- CreateTable
CREATE TABLE "AdminPrincipalMaike" (
    "id" TEXT NOT NULL,
    "login" VARCHAR(120) NOT NULL,
    "papel" VARCHAR(32) NOT NULL DEFAULT 'proprietario',
    "chave_proprietario" VARCHAR(32),
    "senha_hash" VARCHAR(255) NOT NULL,
    "mfa_segredo_cifrado" VARCHAR(512),
    "mfa_ativo" BOOLEAN NOT NULL DEFAULT false,
    "mfa_ultimo_passo" INTEGER,
    "tentativas_falhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMP(3),
    "senha_alterada_em" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminPrincipalMaike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessaoAdminMaike" (
    "id" TEXT NOT NULL,
    "admin_id" VARCHAR(64) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "mfa_verificado" BOOLEAN NOT NULL DEFAULT false,
    "tentativas_mfa" INTEGER NOT NULL DEFAULT 0,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "ultimo_uso_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogada_em" TIMESTAMP(3),
    "motivo_revogacao" VARCHAR(64),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessaoAdminMaike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoRecuperacaoAdminMaike" (
    "id" TEXT NOT NULL,
    "admin_id" VARCHAR(64) NOT NULL,
    "codigo_hash" VARCHAR(64) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodigoRecuperacaoAdminMaike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoSegurancaAdminMaike" (
    "id" TEXT NOT NULL,
    "admin_id" VARCHAR(64),
    "acao" VARCHAR(64) NOT NULL,
    "sucesso" BOOLEAN NOT NULL,
    "ip" VARCHAR(64),
    "request_id" VARCHAR(128) NOT NULL,
    "dados" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventoSegurancaAdminMaike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminPrincipalMaike_login_key" ON "AdminPrincipalMaike"("login");

-- CreateIndex
CREATE UNIQUE INDEX "AdminPrincipalMaike_chave_proprietario_key" ON "AdminPrincipalMaike"("chave_proprietario");

-- CreateIndex
CREATE UNIQUE INDEX "SessaoAdminMaike_token_hash_key" ON "SessaoAdminMaike"("token_hash");

-- CreateIndex
CREATE INDEX "SessaoAdminMaike_admin_id_revogada_em_idx" ON "SessaoAdminMaike"("admin_id", "revogada_em");

-- CreateIndex
CREATE INDEX "SessaoAdminMaike_expira_em_idx" ON "SessaoAdminMaike"("expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoRecuperacaoAdminMaike_codigo_hash_key" ON "CodigoRecuperacaoAdminMaike"("codigo_hash");

-- CreateIndex
CREATE INDEX "CodigoRecuperacaoAdminMaike_admin_id_usado_em_idx" ON "CodigoRecuperacaoAdminMaike"("admin_id", "usado_em");

-- CreateIndex
CREATE INDEX "EventoSegurancaAdminMaike_admin_id_createdAt_idx" ON "EventoSegurancaAdminMaike"("admin_id", "createdAt");

-- CreateIndex
CREATE INDEX "EventoSegurancaAdminMaike_createdAt_idx" ON "EventoSegurancaAdminMaike"("createdAt");

-- CreateIndex
CREATE INDEX "AuditoriaCatalogoGlobal_admin_id_createdAt_idx" ON "AuditoriaCatalogoGlobal"("admin_id", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditoriaCatalogoGlobal" ADD CONSTRAINT "AuditoriaCatalogoGlobal_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "AdminPrincipalMaike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessaoAdminMaike" ADD CONSTRAINT "SessaoAdminMaike_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "AdminPrincipalMaike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoRecuperacaoAdminMaike" ADD CONSTRAINT "CodigoRecuperacaoAdminMaike_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "AdminPrincipalMaike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventoSegurancaAdminMaike" ADD CONSTRAINT "EventoSegurancaAdminMaike_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "AdminPrincipalMaike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Supabase: mesmas proteções das tabelas do catálogo (REVOKE anon/authenticated, RLS,
-- política só para o papel do backend quando ele existir).
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY[
    'AdminPrincipalMaike',
    'SessaoAdminMaike',
    'CodigoRecuperacaoAdminMaike',
    'EventoSegurancaAdminMaike'
  ];
BEGIN
  FOREACH tbl IN ARRAY tabelas
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO maike_vercel USING (true) WITH CHECK (true)',
        pol_name,
        tbl
      );
    END IF;
  END LOOP;
END $$;
