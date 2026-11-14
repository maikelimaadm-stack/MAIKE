-- MAIKE-PESO-PROJETADO — a Categoria de Manejo ("CADCATEGORIA") ganha o PESO
-- OBJETIVO (kg por cabeça), opcional. Decisão, relatório e runbook em
-- docs/engineering/ (MAIKE-PESO-PROJETADO-*.md). O número da decisão fica FORA
-- deste arquivo de propósito: renumerar a decisão nunca muda o checksum aplicado.
--
-- Modo EXPAND puro: uma coluna anulável, sem DEFAULT, numa tabela antiga. Nada
-- é reescrito nem travado além do instante do ALTER (catálogo); categorias que
-- já existem ficam com o campo vazio. Reversão: migration nova com DROP COLUMN.
ALTER TABLE "CADCATEGORIA" ADD COLUMN "peso_objetivo_kg" DECIMAL(10,2);
