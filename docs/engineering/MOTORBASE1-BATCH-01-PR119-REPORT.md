# MOTORBASE1-BATCH-01 — PR #119 (draft)

**Data:** 2026-10-28  
**Branch:** `cursor/motorbase1-batch-01-ui-produtos-tarefas-516d`  
**Base `main`:** `0f790f7e6633315d9c4518c2e725c593af52bf84`

## Exceção controlada (R7)

Rollout em **uma PR** de três cadastros tenant-global / manejo (`GruposAtividades`, `TiposTarefa`, `CategoriasManejo`) solicitado pelo proprietário para acelerar paridade. Gates e testes smoke permanecem **por domínio** (`tests/smoke/motorbase1Batch01.test.jsx`).

## Matriz Antes / Depois

| Área | Antes | Depois |
|------|-------|--------|
| Produtos toolbar | 4 botões em `extraToolbar` | Ações só em **Mais opções** (`additionalMoreActions`) |
| Produtos formulário | `CadastroFormField` + shadcn grid 4 col | `B1Field` + `.mg-b1-form-grid` 12 col |
| Categorias produto CTA | `Nova categoria` | `Novo` |
| Grupos / Tipos / Cat. manejo | Chrome legado + forms Card | `CadastroBase1Screen` + `useCadastroBase1FullListController` |
| Badge ativo grupos/tipos | Sim/Não texto | `CadastroAtivoBadge` SSOT |

## Arquivos principais

- `src/components/cadastro/base1/CadastroListaChrome.jsx` — `additionalMoreActions`, `exportCsvLabel`
- `src/components/cadastro/base1/CadastroBase1Screen.jsx` — repasse props
- `src/hooks/useCadastroBase1FullListController.js` — lista plana full GET
- `src/pages/Produtos.jsx`, `FormularioProduto.jsx`
- `src/pages/Categorias.jsx`
- `src/pages/GruposAtividades.jsx`, `TiposTarefa.jsx`, `CategoriasManejo.jsx` + formulários/tabelas

## Testes

- `tests/smoke/motorbase1Batch01.test.jsx` — menu Produtos, form B1, Novo, integração grade real (grupos/tipos/manejo)

## Evidência visual

PENDING MANUAL — viewports 360/390/768/1024/1280 (ambiente agente sem sessão autenticada estável).

## Riscos residuais

- Categorias manejo: exclusão continua **individual**; multi-select mostra mensagem clara.
- Tipos: flags nativos exibidos como `B1ChaveRow` (antes só payload).
- Produtos: exportação janela ainda limitada ao keyset carregado (rótulo explícito no menu).

## Não realizado nesta PR

- Lançamentos operacionais de tarefas no mapa (fora de escopo).
- Backend / migrations / tenancy.
