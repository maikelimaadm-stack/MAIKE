# MAIKE — Menu administrativo pelo papel real da fazenda (D-PROD-77)

## Problema

- Qualquer conta via **Usuários**, **Permissões** e **Configurações Gerais** no menu. A regra antiga era `Permissao.is_admin`, e a permissão mínima nativa já marca `is_admin: true` para quem não tem registro.
- O backend já recusava as ações (403, D-PROD-71). O defeito era só de interface, mas confundia.

## Mudança

| Camada | O quê |
|---|---|
| Backend | `GET /auth/contexto` devolve `administrador_fazenda`, relido de `Usuario.papel_tenant` a cada chamada (`authRepository.buscarPapelTenant`, `authService.ehAdministradorDaFazenda`). |
| SPA | `nativeSessionApi.obterUsuarioAtualLegado` carrega `administrador_fazenda`; `ehAdministrador(usuario)` usa só esse campo. |
| Menu | `PAGINAS_SO_ADMINISTRADOR` (`menuConfig.js`) some do menu para não administradores; a URL direta abre o aviso "Tela bloqueada" (`Layout.jsx`). |

A autorização de cada ação continua no servidor (`exigirAdminTenant`).

## Provas

- `backend/tests/authContextoPapel.test.mjs`:
  - ACP-01: administrador `true`, comum `false`;
  - ACP-02: rebaixado no banco, a mesma sessão passa a ver `false`.
- `tests/smoke/menuAdministradorFazenda.test.js`: ADM-01..04.
- `tests/smoke/suporteServices.test.js` SE6 atualizado. A regra antiga (`is_admin` decide) era exatamente o defeito.

## Fora do escopo — catálogo de ícones (MAIKE Admin)

- **Onde fica:** os ícones do mapa são cadastrados no **MAIKE Admin** (`apps/admin`, D-PROD-70), não no MAIKE da fazenda. É um app separado, com endereço próprio e login próprio do proprietário do produto (senha + código do autenticador).
- **Estado em produção (30/10):** a API responde `503 ADMIN_INDISPONIVEL`. Faltam:
  - publicar o app;
  - `ADMIN_MAIKE_CHAVE` e `ADMIN_ORIGINS` no servidor;
  - o bucket das imagens;
  - criar a conta do proprietário (0 em `AdminPrincipalMaike`).
- **Próximo passo:** missão própria.
