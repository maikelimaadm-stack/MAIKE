-- MAIKE-ABASTECIMENTO-FK-APONTAMENTO — reforço no banco do abastecimento ligado à
-- atividade: o apontamento gravado em "AbastecimentoBem" passa a ter de ser DA
-- atividade gravada na mesma linha. Hoje a FK do apontamento só confere (cliente,
-- empresa, apontamento) e a da atividade só (cliente, empresa, atividade): as duas
-- juntas aceitam um apontamento de OUTRA atividade (só o servidor deriva a atividade
-- do apontamento). Decisão, runbook e relatório em docs/engineering/
-- (MAIKE-ABASTECIMENTO-FK-APONTAMENTO-*.md). O número da decisão fica FORA deste
-- arquivo de propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- CONTRACT condicionado (entrada fechada em MIGRATIONS_CONTRACT_APROVADAS), nesta
-- ordem:
--   1. guarda (falha fechada antes de tocar em qualquer coisa): lock_timeout 5s e
--      statement_timeout 120s locais à transação, a trava consultiva do prisma
--      migrate (72707369), o estado esperado (as 2 tabelas existem, a FK
--      "AbastecimentoBem_apontamento_fkey" ainda é a de 3 colunas para
--      "AtividadeApontamento", o CHECK "AbastecimentoBem_atividade_check" existe e o
--      UNIQUE novo ainda não), "AtividadeApontamento" travada em SHARE ROW EXCLUSIVE
--      (a referenciada primeiro, a trava que a FK nova pede nela) e "AbastecimentoBem"
--      em ACCESS EXCLUSIVE, as duas até o COMMIT, ANTES de conferir que NENHUM
--      abastecimento aponta para um apontamento de outra atividade. Qualquer linha
--      assim aborta a transação inteira: nada muda. Uma transação do app que segure
--      as duas na ordem inversa faz o lock_timeout (5 s) ou o detector de deadlock
--      abortar esta migration, também sem aplicar nada;
--   2. as 3 instruções pinadas em tabelas antigas: o UNIQUE (cliente_id, empresa_id,
--      atividade_id, id) em "AtividadeApontamento" (trivialmente único, o id já é;
--      é o alvo que a FK composta exige), sai a FK de 3 colunas e volta, com o mesmo
--      nome, a de 4 colunas (cliente_id, empresa_id, atividade_id, apontamento_id),
--      RESTRICT. Com MATCH SIMPLE e o CHECK do apontamento ⇒ atividade, toda linha
--      com apontamento tem as 4 colunas preenchidas: a FK sempre confere.
--
-- Nenhuma coluna, tabela ou dado muda; a FK da atividade fica como está.

-- Guarda: falha fechada se o banco não estiver no estado que o reforço conhece.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  PERFORM pg_advisory_xact_lock(72707369);
  IF to_regclass('public."AbastecimentoBem"') IS NULL
     OR to_regclass('public."AtividadeApontamento"') IS NULL THEN
    RAISE EXCEPTION 'guarda: "AbastecimentoBem" e "AtividadeApontamento" têm de existir';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."AbastecimentoBem"')
                   AND conname = 'AbastecimentoBem_apontamento_fkey' AND contype = 'f'
                   AND confrelid = to_regclass('public."AtividadeApontamento"')
                   AND array_length(conkey, 1) = 3)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public."AbastecimentoBem"')
                      AND conname = 'AbastecimentoBem_atividade_check' AND contype = 'c')
     OR to_regclass('public."AtividadeApontamento_empresa_atividade_id_key"') IS NOT NULL THEN
    RAISE EXCEPTION 'guarda: o vínculo do abastecimento com o apontamento não está no formato anterior (FK de 3 colunas ausente, CHECK da atividade ausente ou UNIQUE novo já presente)';
  END IF;
  -- Trava ANTES de conferir, a referenciada primeiro: até o COMMIT ninguém grava no apontamento nem no abastecimento (o que a guarda conferiu é o que a FK nova valida).
  LOCK TABLE public."AtividadeApontamento" IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public."AbastecimentoBem" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public."AbastecimentoBem" a
               JOIN public."AtividadeApontamento" p
                 ON p.cliente_id = a.cliente_id AND p.empresa_id = a.empresa_id AND p.id = a.apontamento_id
              WHERE a.apontamento_id IS NOT NULL AND p.atividade_id IS DISTINCT FROM a.atividade_id) THEN
    RAISE EXCEPTION 'guarda: há abastecimento ligado a um apontamento de outra atividade; este reforço só roda sem nenhum';
  END IF;
END $$;

-- CreateIndex (o alvo da FK composta: o id já é único, então o UNIQUE de 4 colunas também é)
CREATE UNIQUE INDEX "AtividadeApontamento_empresa_atividade_id_key" ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id");

-- AlterTable (a FK do apontamento sai e volta com o mesmo nome, agora com a atividade)
ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_apontamento_fkey";
ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_apontamento_fkey" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
