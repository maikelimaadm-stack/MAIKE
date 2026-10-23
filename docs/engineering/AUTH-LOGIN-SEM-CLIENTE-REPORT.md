# Login sem código de cliente

**Data:** 2026-10-23  
**Decisão:** D-PROD-32  
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

## Administração de usuários

Gestão completa (criar, resetar senha, desativar) permanece missão **P6**.
Bootstrap local (`npm run auth:bootstrap:local`) segue criando o primeiro par
cliente/usuário para ambiente de desenvolvimento.

## Verificação

- `npm run gate:native-api`, `npm run test:gates`, `npm run test:smoke`
- `npm run typecheck:backend` (testes de backend com PostgreSQL na CI)
