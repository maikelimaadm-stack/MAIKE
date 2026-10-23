# P6.0 — Administração mínima de usuários nativos

**Decisão:** D-PROD-34  
**Branch:** `cursor/p6-usuario-admin-minimo-516d`  
**Data:** 2026-10-23

## Objetivo

Permitir que o operador do tenant crie e mantenha **contas de entrada nativas**
(login/senha no backend MAIKE), sem remover a gestão de **Permissao** na Base44.

## Entregue

| Camada | Artefato |
|--------|----------|
| Backend | `backend/src/modules/usuarios/*` — listar, criar, atualizar com auditoria |
| API front | `src/apis/usuarios/*` — porta HTTP nativa |
| Service | `src/services/usuarioAdminService.js` |
| UI | `FormularioContaAcesso`, `TabelaContasAcesso`, integração em `Usuarios.jsx` |
| Testes | `backend/tests/usuarioAdminNativo.test.mjs` |
| Gate | `gate:usuario-admin` + `scripts/tests/gates/usuario-admin.test.mjs` |
| Erros UI | `USUARIO_*` em `ApiError` e `nativeHttpClient` |

## Contrato HTTP

- `GET /usuarios` — lista pública (sem hash de senha)
- `POST /usuarios` — `{ nome, login, senha }` → 201
- `PATCH /usuarios/:id` — `{ nome?, ativo?, nova_senha? }`
- Sem `DELETE`

## Não escopo

- Migração de `Permissao` / RBAC nativo
- Remoção de `User` do `base44Provider` (ainda usado indiretamente onde aplicável)
- Política de login global único entre clientes

## Verificação

```bash
npm run gate:usuario-admin
npm run test:backend   # exige DATABASE_URL + AUTH_SECRET
npm run verify:all
```

## Riscos remanescentes

- `getCurrentUser()` ainda pode vir do provider Base44; auto-desativação é
  garantida no backend por `usuario_id` do JWT e espelhada na UI por login.
- Dois tenants com o mesmo login continuam ambíguos no login global (D-PROD-33)
  até política futura.
