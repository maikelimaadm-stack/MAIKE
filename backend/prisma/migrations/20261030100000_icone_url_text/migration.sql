-- D-PROD-79 — ícones do mapa: a imagem enviada pela tela vira data URL
-- (`/arquivos/upload`), quase sempre maior que 1024 caracteres. Com VARCHAR(1024)
-- o cadastro de ícone era recusado. Só alarga o tipo; nenhum dado muda.
--
-- Reversível (só se nenhum valor passar de 1024):
--   ALTER TABLE "ConfiguracaoIcone" ALTER COLUMN "icone_url" TYPE VARCHAR(1024), ALTER COLUMN "sub_icone_url" TYPE VARCHAR(1024);
--   ALTER TABLE "PontoReferencia" ALTER COLUMN "icone_url" TYPE VARCHAR(1024), ALTER COLUMN "sub_icone_url" TYPE VARCHAR(1024);

-- AlterTable
ALTER TABLE "ConfiguracaoIcone" ALTER COLUMN "icone_url" SET DATA TYPE TEXT,
ALTER COLUMN "sub_icone_url" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "PontoReferencia" ALTER COLUMN "icone_url" SET DATA TYPE TEXT,
ALTER COLUMN "sub_icone_url" SET DATA TYPE TEXT;
