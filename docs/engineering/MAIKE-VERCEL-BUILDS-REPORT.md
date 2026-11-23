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
  `main`, quando nada mudou em `apps/admin`, `package.json` nem `package-lock.json` desde o
  último deploy bem-sucedido (`VERCEL_GIT_PREVIOUS_SHA`; cobre push com vários commits e
  deploy anterior que falhou). Sem esse SHA, ou se ele não estiver no clone, o build roda
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

---

# Custo mínimo na Vercel (2026-11-23, D-PROD-275)

FATIA: MAIKE-VERCEL-CUSTO-MINIMO · BRANCH: `chore/vercel-custo-minimo` · PR: #361

## Diagnóstico (cobrança diária da Vercel, 31/10 a 22/11)

| Serviço | US$ | % |
|---|---|---|
| Build CPU Minutes | 52,68 | 77% |
| Assinatura Pro | 12,94 | 19% |
| Function Storage + Deployment Storage | 1,68 | 2% |
| Funções, tráfego e observabilidade | ≈1,4 | 2% |
| **Total** | **68,73** | |

- Dias de pico: 14/11 (US$ 7,02), 13/11 (6,65), 06/11 (6,09), 10/11 (6,06). Em 14/11 foram mais de 100 builds; só 12 da `main`, o resto prévias de branches `claude/*`, `feat/*`, `codex/*`.
- Depois da mudança de 17/11 (#314): 20/11 US$ 0,95, 21/11 US$ 0,96, 22/11 US$ 0,81 — quase só a assinatura Pro (≈ US$ 0,67/dia).
- Um build da `main` (`58c0697b`): ≈ 70 s em máquina padrão (4 núcleos, 8 GB), `npm ci` 18 s, Vite 16 s; ≈ US$ 0,02.
- Projetos `projetomg` e `controle-de-estoque`: nenhum deploy desde 01/11.

## Mudança

- `vercel.json`: `ignoreCommand` só libera a `main`; as cinco exceções antigas saem (todas mergeadas). Na `main`, pula o build quando o diff desde o último deploy bem-sucedido só toca `docs/`, `tests/`, `backend/tests/`, `.github/` ou `*.md`. Sem SHA anterior no clone, builda.
- Conferido localmente: branch fora da `main` → pula; `main` sem SHA ou com SHA ausente → builda; commit só de docs (`a01c1f35`, `790857ea`) → pula; commit de código (`11c6bbb5`) → builda.
- Testes `adminVercelConfig`, `vercelSpaRoutes`, `vercelFunctionDuration` e `admin-isolation` verdes; gates estáticos verdes.

## O que ainda pode ser feito no painel da Vercel (pelo proprietário)

- **Spend Management** (Settings → Billing): definir um teto/alerta mensal, para um pico não passar despercebido.
- **Deployment Retention** (Project Settings → Security/Deployment Retention): guardar prévias e deploys antigos por menos tempo reduz `Deployment Storage` (centavos por mês).
- O custo fixo que sobra é a assinatura Pro (US$ 20/mês).
