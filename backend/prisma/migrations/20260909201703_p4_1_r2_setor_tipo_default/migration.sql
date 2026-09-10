-- P4.1-R2 — default de `Setor.tipo`, divergência do contrato legado.
--
-- `base44/entities/Setor.jsonc` declara `"default": "Próprio"` para `tipo`. A
-- migration da P4.1 criou a coluna como `VARCHAR(32) NOT NULL`, sem DEFAULT: o
-- enum e a obrigatoriedade vieram, o default não.
--
-- A migration da P4.1 já está mergeada e aplicada no ambiente real. Editá-la
-- mudaria o checksum de uma migration já registrada em `_prisma_migrations` e
-- quebraria todo `migrate deploy` seguinte. A correção é aditiva, como manda o
-- versionamento: a cadeia passa a ter dois passos, e o estado final é o certo.
--
-- Isto NÃO torna `tipo` opcional na API. `POST /setores` continua exigindo o
-- campo: o default é última barreira de persistência, não permissão para o
-- cliente omitir a intenção do usuário.

-- AlterTable
ALTER TABLE "Setor" ALTER COLUMN "tipo" SET DEFAULT 'Próprio';
