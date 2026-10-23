# Login sem código de cliente

**Data:** 2026-10-23  
**Decisão:** D-PROD-33  
**Branch:** `cursor/auth-login-sem-cliente-516d`

## Objetivo

Simplificar a entrada: **usuário + senha** apenas. O tenant (`cliente_id`) continua
vindo da sessão após autenticação — regra R11 inalterada.

## Mudanças

| Camada | Alteração |
|--------|-----------|
| UI | `NativeLoginForm` — removido campo Cliente |
| Frontend | `nativeSessionApi.login` envia `{ login, senha }` |
| Backend | `POST /auth/login` schema; `authService` resolve usuário por login |
| DB | Sem índice só em `login` (violaria `gate:indices`); busca filtrada até P6 |
| Gates | `gate:native-api` exige login+senha e reprova `cliente`/`cliente_id` no corpo |

## O que **não** mudou (e por quê)

A tabela **`Cliente`** e o `cliente_id` em cada registro **permanecem** — são a
raiz de tenancy (D-PROD-22, R9). Isso **não** significa que o operador digita
“cliente” no login: o backend descobre o tenant pela linha do `Usuario`
autenticado. Em operação de um único cliente há **um** `Cliente` no banco
(invisível na UI).

Duplicata de login ativo entre tenants quebrava a entrada; a migration
`p6_1_login_global_hygiene` (D-PROD-35) deduplica e impõe login global único.

## Administração de usuários

Gestão completa (criar, desativar) na **P6**. Para **redefinir senha** no banco
(produção ou local), sem campo cliente:

```bash
RESET_PASSWORD_LOGIN=admin \
RESET_PASSWORD_NOVA_SENHA='…' \
RESET_PASSWORD_CONFIRM=sim \
npm run auth:reset-password
```

Bootstrap local (`npm run auth:bootstrap:local`) cria o primeiro par
cliente/usuário só em desenvolvimento.

## Verificação

- `npm run gate:native-api`, `npm run test:gates`, `npm run test:smoke`
- `npm run typecheck:backend` (testes de backend com PostgreSQL na CI)
