-- P6.1 / D-PROD-35 — Higiene de login global (entrada só usuário + senha).
--
-- O tenant (Cliente) continua no schema; o operador não informa código de cliente.
-- Autenticação resolve Usuario pelo login entre contas ativas — ambiguidade vira
-- "credenciais inválidas". Esta migration:
--   1) normaliza login (trim + minúsculas);
--   2) desativa duplicatas ativas, mantendo a conta mais antiga;
--   3) garante no máximo um login ativo por valor (case-insensitive);
--   4) em instalação única, alinha login legado de bootstrap "maike" → "admin".

UPDATE "Usuario"
SET login = lower(trim(login)),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE login <> lower(trim(login));

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY lower(login)
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "Usuario"
  WHERE ativo = true
)
UPDATE "Usuario" u
SET ativo = false,
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked r
WHERE u.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Usuario_login_ativo_global_key"
  ON "Usuario" (lower(login))
  WHERE ativo = true;

UPDATE "Usuario" u
SET login = 'admin',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE u.ativo = true
  AND lower(u.login) = 'maike'
  AND (SELECT COUNT(*)::int FROM "Usuario" WHERE ativo = true) = 1
  AND NOT EXISTS (
    SELECT 1 FROM "Usuario" o
    WHERE o.login = 'admin' AND o.id <> u.id
  );
