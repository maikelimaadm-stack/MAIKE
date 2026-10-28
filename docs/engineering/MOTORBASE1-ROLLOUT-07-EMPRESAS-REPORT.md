# MOTORBASE1-ROLLOUT-07 — Empresas (Cadastro completo Base1)

## Identidade

| Campo | Valor |
|---|---|
| Missão | MOTORBASE1-EMPRESAS-01 / PR #123 |
| Baseline main | `009db6893c92c2b505965166f8606e405f31fce8` (merge PR #122) |
| Branch | `cursor/motorbase1-empresas-completo-516d` |
| HEAD (registrar após push) | ver `git rev-parse HEAD` no CI |
| PR | DRAFT #123 (GitHub) |

## Antes / depois

| Área | Antes | Depois |
|---|---|---|
| Página | `CadastroWorkspace` + `CadastroListaChrome` + hooks legados | `useCadastroBase1FullListController` + `CadastroBase1Screen` |
| Formulário | `Card` + `CadastroFormField` + barra Salvar/Cancelar duplicada | `CadastroFormShell` + `B1Field` + `MgSelect` + `Base1PanelTabs` + toolbar Base1 |
| Tabela | Grade + busca/confirmação/delete fake na tabela | `CadastroBase1Grade` only; exclusão via motor |
| Exclusão | Loop `deleteEmpresa` + toast genérico | `excluirEmpresas` → `{ excluidos, bloqueados }` |
| Hook órfão | `useCadastroDuplicateAction` (só Empresa) | Removido; duplicar via motor |

## Arquivos tocados

- `src/pages/Empresa.jsx`
- `src/components/empresa/FormularioEmpresa.jsx`
- `src/components/empresa/TabelaEmpresas.jsx`
- `src/services/empresaService.js`
- `src/hooks/useCadastroDuplicateAction.js` (removido)
- `tests/smoke/empresaPage.test.jsx`, `empresaBase1Rollout.test.jsx`, `formularioEmpresa.test.jsx`
- `docs/engineering/CADASTROS-E-MODULOS-STATUS.md`

## Contratos preservados

- Query key `['empresas']`, lista tenant-global (sem filtro por empresa selecionada).
- `colunas_empresas_v2`, `droppableId='colunas-empresas'`, `EMPRESAS_COLUNAS`, `getEmpresaFieldValue`.
- `projetarPayloadEmpresa`, POST/PATCH sem `id`/`cliente_id`/`numero_empresa`.
- Offline: toast `Pendente de sincronização`, número `Atribuído após sincronizar`.
- 409 `EMPRESA_NAME_CONFLICT`: campos mantidos, formulário aberto.

## Riscos / pendências

- **Visual E2E autenticado:** PENDING VISUAL — homologar viewports 360/768/1280 após deploy.
- **Empresa selecionada excluída:** Layout reconcilia via invalidação de lista + `localStorage`; validar manualmente com FK vinculada.
- **Backend tests locais:** exigem `DATABASE_URL` (CI postgres).

## Comandos (HEAD de trabalho)

```bash
npm run test:smoke -- tests/smoke/empresaPage.test.jsx tests/smoke/empresaBoundary.test.js tests/smoke/nativeHttpClientEmpresa.test.js tests/smoke/empresaBase1Rollout.test.jsx tests/smoke/formularioEmpresa.test.jsx
npm run verify:all   # test:backend FAIL local sem DATABASE_URL; demais etapas PASS
```
