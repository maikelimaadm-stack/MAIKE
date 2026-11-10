-- D-PROD-157 — MAIKE Gestão P3-03: EDITAR (retificar), EXCLUIR (lógico) e
-- DUPLICAR lançamentos confirmados da Central Única de Lançamentos.
--  - Retificação: no mesmo registro (NO_LUGAR, `versao+1`) quando a assinatura
--    física não muda; senão SUBSTITUIÇÃO atômica — o documento antigo é estornado
--    e cancelado (com `retificado_em`) e um documento novo e confirmado assume o
--    mesmo número de negócio.
--  - Exclusão LÓGICA de documento confirmado: estorna como o cancelamento e marca
--    `excluido_em`; nunca há DELETE de documento confirmado.
--  - Os dois deixam a versão anterior num snapshot verificável numa tabela NOVA
--    de eventos, com FKs (nenhuma regra lê o snapshot para decidir).
--
-- EXPAND-ONLY (classificador `premergeMigrateLib.classificarMigrations`):
--  - "OperacaoFinanceira"."excluido_em" e "retificado_em": colunas NOVAS anuláveis,
--    sem DEFAULT e sem NOT NULL, sem CHECK (CHECK em tabela antiga não é expand) e
--    sem backfill. NULL = documento operacional (o backend antigo não as lê).
--  - "OperacaoFinanceiraEvento": tabela NOVA, com CHECK/UNIQUE/índices/FKs só
--    nela. As FKs para tabelas antigas são compostas por (cliente_id, …) e
--    RESTRICT: nada some em cascata. Os alvos das FKs já têm unique.
--
-- Escopo garantido pelo banco: toda FK inclui cliente_id; o evento herda a
-- empresa do documento (e do documento novo, na substituição) pelas FKs
-- compostas (cliente_id, empresa_id, …); o autor é do mesmo tenant pela FK
-- (cliente_id, usuario_id). Um documento nasce de no máximo uma substituição
-- (unique (cliente_id, operacao_nova_id); NULLs repetidos são permitidos).
--
-- Reversão operacional (não executada em produção): a tabela nova não é
-- referenciada por nenhuma outra; removê-la e depois as duas colunas anuláveis
-- não afeta os dados da P3-01/P3-02 (perde-se só o histórico de revisões e a
-- marca de excluído/retificado — os documentos continuam CANCELADO com motivo).

ALTER TABLE "OperacaoFinanceira" ADD COLUMN "excluido_em" TIMESTAMP(3);

ALTER TABLE "OperacaoFinanceira" ADD COLUMN "retificado_em" TIMESTAMP(3);

CREATE TABLE "OperacaoFinanceiraEvento" (
    "id" TEXT NOT NULL,
    "cliente_id" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "operacao_id" VARCHAR(64) NOT NULL,
    "tipo" VARCHAR(16) NOT NULL,
    "modo" VARCHAR(16),
    "operacao_nova_id" VARCHAR(64),
    "numero_original" VARCHAR(32) NOT NULL,
    "versao_anterior" INTEGER NOT NULL,
    "versao_nova" INTEGER NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "usuario_id" VARCHAR(64),
    "snapshot_anterior" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperacaoFinanceiraEvento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperacaoFinanceiraEvento_operacao_idx" ON "OperacaoFinanceiraEvento"("cliente_id", "empresa_id", "operacao_id", "createdAt");

CREATE INDEX "OperacaoFinanceiraEvento_operacao_nova_idx" ON "OperacaoFinanceiraEvento"("cliente_id", "empresa_id", "operacao_nova_id");

CREATE UNIQUE INDEX "OperacaoFinanceiraEvento_cliente_id_id_key" ON "OperacaoFinanceiraEvento"("cliente_id", "id");

CREATE UNIQUE INDEX "OperacaoFinanceiraEvento_cliente_id_operacao_nova_id_key" ON "OperacaoFinanceiraEvento"("cliente_id", "operacao_nova_id");

ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_operacao_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "operacao_id") REFERENCES "OperacaoFinanceira"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_operacao_nova_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "operacao_nova_id") REFERENCES "OperacaoFinanceira"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_usuario_fkey" FOREIGN KEY ("cliente_id", "usuario_id") REFERENCES "Usuario"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domínios fechados e invariantes por CHECK (sem enum Prisma), só na tabela nova.
-- `modo IS NOT NULL` explícito na retificação: com NULL, `modo IN (…)` daria
-- NULL e o CHECK (que só recusa FALSE) aceitaria retificação sem modo.
ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_tipo_check" CHECK ("tipo" IN ('RETIFICACAO', 'EXCLUSAO') AND ("modo" IS NULL OR "modo" IN ('NO_LUGAR', 'SUBSTITUICAO')));
ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_forma_check" CHECK (("tipo" = 'EXCLUSAO' AND "modo" IS NULL AND "operacao_nova_id" IS NULL) OR ("tipo" = 'RETIFICACAO' AND "modo" IS NOT NULL AND "modo" IN ('NO_LUGAR', 'SUBSTITUICAO') AND (("modo" = 'SUBSTITUICAO') = ("operacao_nova_id" IS NOT NULL))));
ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_motivo_check" CHECK (char_length(btrim("motivo")) > 0);
ALTER TABLE "OperacaoFinanceiraEvento" ADD CONSTRAINT "OperacaoFinanceiraEvento_versao_check" CHECK ("versao_anterior" >= 1 AND "versao_nova" > "versao_anterior");

-- Supabase Data API: mesmo padrão das migrations anteriores — REVOKE de
-- anon/authenticated, RLS ligado sem FORCE e política só para o papel do backend.
-- Só a tabela NOVA (as colunas novas herdam a RLS/grants da tabela da P3-01).
DO $$
DECLARE
  tbl text;
  pol_name constant text := 'maike_backend_all';
  tabelas constant text[] := ARRAY['OperacaoFinanceiraEvento'];
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
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO maike_vercel USING (true) WITH CHECK (true)', pol_name, tbl);
    END IF;
  END LOOP;
END $$;
