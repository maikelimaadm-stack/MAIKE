# Auth produção — bypass removido + usuário de teste

**Data:** 2026-10-27  
**Ambiente:** `https://maike-five.vercel.app` · Supabase `uuemcasqcdjucflulkne`

## Ações executadas

1. **Vercel (`maike`):** `VITE_SKIP_NATIVE_LOGIN` esvaziado em Production e Preview (D-PROD-37 desligado no build).
2. **Redeploy Production:** `dpl_DEsQPYVnShq8ZfNH6yf5GAqmyN8y` (READY; alias `maike-five.vercel.app`).
3. **PostgreSQL:** tenant `Cliente` código `maike` já existia; usuário nativo `maike` ativo — senha redefinida via hash bcrypt (mesmo algoritmo do backend), **sem** commit de credencial.

## Smoke

| Verificação | Resultado |
|-------------|-----------|
| `GET /health` | `status: ok`, `banco: up` |
| `POST /auth/login` (`login` + `senha`, sem `cliente`) | **200**, JWT + `usuario.login` = `maike` |

## Operador

- Login na UI: **maike** + senha definida na sessão operacional (não versionada).
- Redefinir senha: `RESET_PASSWORD_LOGIN=maike RESET_PASSWORD_NOVA_SENHA='…' RESET_PASSWORD_CONFIRM=sim npm run auth:reset-password` com `DATABASE_URL` do Supabase (ver `AGENTS.md`).

## Pendência opcional

- `VITE_MAIKE_API_URL` em Production ainda aponta para `https://maike-five.vercel.app` (equivalente funcional ao monólito); esvaziar se quiser paridade estrita com D-PROD-36.
