# MotorBase1 — Split Usuários / Permissões

**Missão:** PR prevista #125 · Branch `cursor/usuarios-permissoes-split-516d`  
**Base:** `origin/main` @ `d4e07df960f58acfb9eee65a8ee08909a6d9f7c5` (pós PR #124 Empresas)

## Entregas

| Rota | Página | Escopo |
|------|--------|--------|
| `/Usuarios` | `src/pages/Usuarios.jsx` | Contas nativas (`listarContasAcesso`, criar/atualizar, `validarPatchContaAcesso`). MotorBase1: `CadastroBase1Screen` + `useCadastroBase1FullListController`. Sem matriz de permissões, sem Excluir. |
| `/Permissoes` | `src/pages/Permissoes.jsx` | Matriz legada (`listarUsuarios`, `listarPermissoes`, `FormularioUsuario`, `ConfiguracaoPermissoesTelas`). Sem contas/senha. |

## Menu / escopo

- `adm-usuarios` → rótulo **Usuários**, URL `Usuarios` (ID preservado).
- `adm-permissoes` → **Permissões**, URL `Permissoes` (entre Usuários e Configurações Gerais).
- `config/mapa-manejo-scope.json`: `Permissoes` em `allowedPages`.
- `vercel.json` resincronizado via `scripts/vercel/sync-vercel-json.mjs`.

## Autorização (sem escalonamento por ID novo)

- `src/lib/permissions.js`: alias `adm-permissoes` → linha `adm-usuarios` em `permissoes_telas` (`resolvePermissionPageId` / `getPagePermission`).
- **Retrocompat:** quem tinha acesso à tela combinada mantém ambas as rotas enquanto a linha for `adm-usuarios`.
- **Risco conhecido (pré-existente):** `canAccessPage` continua fail-open quando não há linha de tela (`permissoes_telas` vazio + módulo liberado). Documentado em testes red-team; não introduzido por este split.
- **`permissaoMinimaNativa`:** inalterado (`is_admin: true` quando Base44 de permissões falha) — fora do escopo desta PR.
- **Backend:** endpoints de permissão/contas não auditados aqui como RBAC por rota; apenas gate de menu + alias client-side.

## Mapa / congelados

Nenhuma alteração em `MapaGeral`, `MapaCadastro`, `src/components/mapa/**`, `mapaGeralPermissions.js`, Prisma, auth backend.

## Testes

- `tests/smoke/usuariosPermissoesSplit.test.jsx` — menu, MotorBase1, red-team alias, DOM mínimo.
- `tests/smoke/r3PostPr96Bugfix.test.jsx` — contas em Usuarios; restrito em Permissoes.
- `tests/smoke/vercelSpaRoutes.test.js` — 17 páginas SPA.

## Evidências visuais

**PENDING VISUAL** — breakpoints 360/390/768/1024/1280 não homologados neste ambiente.

## Veredito técnico

**GO** condicionado a `npm run verify:all` verde na branch e CI da PR DRAFT.
