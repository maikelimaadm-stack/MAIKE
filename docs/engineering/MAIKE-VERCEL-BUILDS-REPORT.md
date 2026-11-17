# MAIKE — Redução de builds na Vercel (2026-11-17)

## Motivo
Pedido do proprietário: o uso da Vercel estava alto. Entre 04h47 e 18h50 de 2026-11-17
foram 100 deploys (93 previews e 7 de produção), em dois projetos a cada push (`maike` e
`admmakgestao`), quase todos vindos das branches `claude/*`.

## Mudança
- `vercel.json` (projeto `maike`): `ignoreCommand` pula o build de toda branch que não seja
  `main`. As PRs continuam validadas pelo GitHub Actions (`verify:all`); só deixam de ter
  link de preview.
- `apps/admin/vercel.json` (projeto `admmakgestao`): pula o build fora da `main` e, na
  `main`, quando o commit não mexe em `apps/admin`, `package.json` nem `package-lock.json`.
  Se o commit anterior não estiver disponível no clone, o `git diff` falha e o build roda
  (falha aberta para o deploy, nunca para pular).

Convenção da Vercel: `ignoreCommand` com saída 0 pula o build; diferente de 0, builda.

## Sem efeito em
Código, banco, rotas, rewrites, cabeçalhos e funções. Produção continua sendo publicada a
cada merge na `main`.

## Verificação
Testes `tests/smoke/adminVercelConfig.test.js`, `vercelSpaRoutes.test.js`,
`vercelFunctionDuration.test.js` e `scripts/tests/gates/admin-isolation.test.mjs` verdes;
comando conferido localmente (`main` → builda; `claude/*` → pula).

## Reversão
Remover a chave `ignoreCommand` dos dois arquivos.
