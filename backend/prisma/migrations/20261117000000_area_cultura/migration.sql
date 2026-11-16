-- MAIKE-AREA-CULTURA — a Área do mapa ("AreaPastagem") passa a apontar para a Cultura
-- do cadastro de Culturas da MESMA fazenda ("CADCULTURAS"). Coluna nova e anulável
-- "cultura_id": área antiga, Reserva, APP e Infraestrutura ficam sem cultura.
-- Decisão, relatório e runbook em docs/engineering/ (MAIKE-AREA-CULTURA-*.md). O
-- número da decisão fica FORA deste arquivo de propósito: renumerar a decisão nunca
-- muda o checksum aplicado.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS). A mudança
-- é ADITIVA: nenhuma linha muda de valor, nenhuma coluna existente é tocada, nenhuma
-- tabela é criada ou apagada, nenhum DROP. Só é CONTRACT porque a allowlist EXPAND
-- recusa UNIQUE em tabela antiga e FK de tabela antiga para tabela ANTIGA (o mesmo
-- caminho da D-PROD-195 e da D-PROD-197). Nesta ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma
--      migrate (72707369), o estado esperado (as duas tabelas existem; a coluna, o
--      UNIQUE e a FK novos não existem) e "AreaPastagem" travada em ACCESS EXCLUSIVE
--      até o COMMIT. A coluna nasce vazia em todas as linhas, então nenhuma linha
--      existente pode violar a FK: a guarda não precisa conferir conteúdo;
--   2. as instruções pinadas em tabela antiga: a coluna anulável, o UNIQUE
--      (cliente_id, empresa_id, id) que a FK composta exige em "CADCULTURAS" e a FK
--      composta pelo tenant e pela empresa (mesma fazenda por construção), RESTRICT
--      (cultura em uso não sai);
--   3. o resto pela allowlist EXPAND: o índice não-único da FK, pelo cliente.
--
-- O vínculo das áreas atuais com a cultura é um passo de DADOS separado, com
-- aprovação própria do proprietário (ver o runbook). Nada é semeado aqui.
--
-- Reversão operacional (não executada em produção): DROP da FK, do índice, do UNIQUE
-- e da coluna; o texto "tipo_pastagem" continua gravado nas áreas.

-- Guarda: falha fechada se o banco não estiver no estado que a fatia conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."AreaPastagem"') IS NULL
     OR to_regclass('public."CADCULTURAS"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "AreaPastagem" e "CADCULTURAS" têm de existir';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
               AND table_name = 'AreaPastagem' AND column_name = 'cultura_id')
     OR to_regclass('public."CADCULTURAS_cliente_id_empresa_id_id_key"') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."AreaPastagem"')
                  AND conname = 'AreaPastagem_cliente_id_empresa_id_cultura_id_fkey') THEN
    RAISE EXCEPTION 'guarda: a área já está ligada à cultura (coluna, UNIQUE ou FK novos já presentes)';
  END IF;
  -- Trava até o COMMIT: ninguém grava em "AreaPastagem" enquanto a coluna e a FK entram.
  LOCK TABLE public."AreaPastagem" IN ACCESS EXCLUSIVE MODE;
END $$;

-- AlterTable (anulável, sem DEFAULT: todas as linhas existentes ficam sem cultura)
ALTER TABLE "AreaPastagem" ADD COLUMN "cultura_id" VARCHAR(64);

-- CreateIndex (alvo da FK composta: a cultura é da mesma fazenda por construção)
CREATE UNIQUE INDEX "CADCULTURAS_cliente_id_empresa_id_id_key" ON "CADCULTURAS"("cliente_id", "empresa_id", "id");

-- AddForeignKey (composta pelo tenant e pela empresa; RESTRICT: cultura em uso não sai)
ALTER TABLE "AreaPastagem" ADD CONSTRAINT "AreaPastagem_cliente_id_empresa_id_cultura_id_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "cultura_id") REFERENCES "CADCULTURAS"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AreaPastagem_cliente_id_empresa_id_cultura_id_idx" ON "AreaPastagem"("cliente_id", "empresa_id", "cultura_id");
