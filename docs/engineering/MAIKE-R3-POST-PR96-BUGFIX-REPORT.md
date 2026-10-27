# MAIKE-R3 — Relatório pós-merge PR #96

## Base

| Campo | Valor |
|---|---|
| Branch | `cursor/maike-pos-pr96-bugfix-r3` |
| Base declarada (prompt) | `main` @ `4ec0033504ecb7ba29b4da8934b6d85b6c9e8520` (merge #96) |
| HEAD analisado | `origin/main` @ `4ec00335` (mesmo merge #96) |
| PRs #95 / #96 abertas | **Não** — ambas **MERGED**; missão em branch única nova |
| PR desta missão | **Abrir manualmente (DRAFT):** https://github.com/maikelimaadm-stack/MAIKE/compare/main...cursor/maike-pos-pr96-bugfix-r3 |

## Resumo por item

### R3-01 — Empresa selecionada reativa

**Causa:** `Produtos`, `CadastroSetores` e `MapaGeral` liam `localStorage.getItem('empresa_selecionada_id')` no render, sem assinar `EVENTO_EMPRESA_SELECIONADA`.

**Correção:** `useEmpresaSelecionadaId()` nas três páginas; componentes de Produtos (`FormularioProduto`, `FichaProduto`) e filhos do mapa usados pelo Mapa Geral migrados para o mesmo hook.

**Antes:** troca A→B no seletor do Layout não invalidava queries montadas nessas telas.

**Depois:** evento + estado React refetch com `queryKey` dependente de `empresaSelecionadaId`.

**Testes:** `tests/smoke/r3PostPr96Bugfix.test.jsx` — R3-01 (estático + evento).

### R3-02 — Cache e localStorage entre sessões

**Causa:** `queryClientInstance` global não era limpo no logout/login; `empresa_selecionada_id` sobrevivia sem vínculo ao tenant do JWT.

**Correção:**

- `resetAppQueryCache()` em `src/lib/query-client.js`, chamado em `logout`, `encerrarValidacaoEIrParaLogin` e `entrar` (`AuthContext`).
- `empresa_selecionada_cliente_id` gravado com a seleção; hook ignora ID salvo se o tenant divergir; `limparEmpresaSelecionadaSessao()` no logout.
- Query keys de `Usuarios` escopadas por `sessaoKey` (`clienteId` / `user.id`).

**Testes:** R3-02 em `r3PostPr96Bugfix.test.jsx`.

### R3-03 — Shell PascalCase / barra final

**Causa:** `pageNameFromPathname` comparava pathname literal; rota não reconhecida montava conteúdo sem `Layout`; `PageNotFound` ficava fora do shell.

**Correção:** `normalizeAppPathname()`; redirect canônico no `AppShell`; `Layout` sempre envolve `AppRouteContent`; `PageNotFound` dentro do `AppShell`.

**Testes:** R3-03 estático + `normalizeAppPathname`; aliases PascalCase permanecem como `<Navigate>` legado.

### R3-04 — JSON.parse filtros Mapa Geral

**Causa:** `JSON.parse(saved)` sem tratamento em `MapaGeral.jsx`.

**Correção:** `lerFiltrosMapaGeral` / `salvarFiltrosMapaGeral` em `src/lib/mapaGeralFiltrosStorage.js`.

**Testes:** R3-04 unitário + montagem com storage corrompido.

### R3-05 — Usuários: erro vs vazio

**Causa:** `catch { return [] }` mascarava falhas reais.

**Correção:** `isUsuariosListagemRestrita()` (`REQUEST_REJECTED` → lista vazia P0); demais erros propagam com banner âmbar; loading/vazio/erro distinguíveis.

**Testes:** R3-05 (indisponível, restrito, vazio real).

## Validação Vercel Accept / HTTP

**PENDING** — ambiente do agente sem deploy autorizado testável (Vercel MCP exige `teamId`; sem GET autenticado em produção/preview nesta sessão).

Simulador `headerValueMatchesPattern` / gerador **não alterados** — sem falha demonstrada em runtime real.

## Navegação Lotes / regressão

- Reutilizados contratos em `menuNavFreeze.test.jsx` (inalterados, verdes).
- Novo: `R3-NAV` em `r3PostPr96Bugfix.test.jsx` (URL + conteúdo via MemoryRouter).
- `render.test.jsx`: wrapper passa a incluir `AuthProvider` (MapaGeral usa hook de empresa).

## CI / verify:all

Executado localmente (branch de trabalho):

| Etapa | Resultado |
|---|---|
| Gates, lint, smoke (620), build | **PASS** |
| `gate:types` | **PASS** (1746, sem regressão) |
| `typecheck:backend` | **PASS** |
| `test:backend` | **FAIL** — `DATABASE_URL` ausente (sem Docker neste pod) |

CI GitHub com Postgres: esperado verde nas mesmas etapas que main.

## Arquivos principais alterados

- `src/hooks/useEmpresaSelecionadaId.js`, `src/lib/query-client.js`, `src/lib/AuthContext.jsx`, `src/Layout.jsx`
- `src/App.jsx`, `src/lib/navigation/normalizeAppPathname.js`, `src/lib/mapaGeralFiltrosStorage.js`, `src/lib/usuariosListQuery.js`
- `src/pages/Produtos.jsx`, `CadastroSetores.jsx`, `MapaGeral.jsx`, `Usuarios.jsx`
- Componentes mapa/produtos (hook empresa)
- `tests/smoke/r3PostPr96Bugfix.test.jsx`, `tests/smoke/render.test.jsx`

## Riscos residuais

- E2E autenticado em browser real: **PENDENTE**.
- HTTP Accept em deploy Vercel: **PENDENTE**.
- Outras páginas fora do escopo R3-01 ainda podem ler `localStorage` direto (cadastros secundários).

## EVIDÊNCIA E2E

**PENDENTE** — cobertura via Vitest + React Testing Library apenas.
