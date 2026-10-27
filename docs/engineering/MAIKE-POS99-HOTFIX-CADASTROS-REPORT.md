# MAIKE — Hotfix pós PR #99: Empresas + Categorias (visibilidade e persistência)

Data: 2026-10-27  
Branch: `cursor/maike-pos99-hotfix-empresas-categorias`  
Base: `origin/main` @ `9b1936bf` (merge PR #99)

## Sintomas e causas comprovadas

| Sintoma | Camada | Causa comprovada | Correção |
|--------|--------|------------------|----------|
| Categoria filha “não aparece” após salvar | UI (`TabelaCategoriasProduto`) | `flattenVisible` só percorre filhos com `expanded[pai]=true`; pais iniciam `{}` | Auto-expandir ancestrais via `revealCategoriaId`; busca expande ramo até o match |
| Lista de categorias inconsistente ao trocar fazenda | Offline cache | `tenantScoped` com chave por `empresa_selecionada_id` em catálogo global | `tenantCatalog: true` em `categoriaNativePort` |
| Empresa “não salva” (jurídica sem CNPJ) | Formulário | Validação exigia CNPJ/CPF; backend só exige `apelido`, `nome`, `tipo_pessoa` | Removida obrigatoriedade de documento no submit |
| Empresa sumindo / cache cruzado | Offline | `empresaNativePort` sem `tenantScoped` | `tenantScoped: true` + `tenantCatalog: true` |
| Grade vazia com erro de rede | Página Empresa | `initialData: []` mascarava `isError` | Banner de erro + retry (paridade com Categorias) |
| Sucesso falso offline | Páginas | Toast de “salvo” com id `offline_*` | Toast “Pendente de sincronização” |

## Evidência RED / GREEN

- **RED:** `tests/smoke/categoriaProdutoIntegridade.test.js` — filha oculta com pai recolhido.
- **GREEN:** mesmo arquivo — `revealIds` e `searchQuery` expõem filha/neta.
- **RED (relato):** formulário bloqueava POST sem CNPJ.
- **GREEN:** `tests/smoke/pos99HotfixCadastros.test.js` — submit jurídica sem CNPJ chama `onSubmit`.
- **Backend:** `backend/tests/pos99HotfixCadastrosNativo.test.mjs` — POST/GET/PATCH empresas; POST raiz/filha categorias.

## Arquivos alterados

- `src/components/categorias-produto/TabelaCategoriasProduto.jsx`
- `src/pages/Categorias.jsx`
- `src/pages/Empresa.jsx`
- `src/components/empresa/FormularioEmpresa.jsx`
- `src/services/empresaService.js`
- `src/apis/empresa/empresaNativePort.js`
- `src/apis/categorias/categoriaNativePort.js`
- `src/lib/offline/offlineEntityRuntime.js` (`tenantCatalog`)
- Testes smoke + backend acima

## Gates e CI

- `npm run verify:all` executado no push desta branch (ver SHA no commit).
- E2E browser autenticado em produção: **PENDING** (sem credenciais LAB neste ambiente).

## Riscos residuais

- Filas IndexedDB legadas (pré-`tenantScoped` em Empresa) permanecem na fila global; replay usa regras fail-closed existentes — não há migração destrutiva.
- Destaque visual da linha recém-criada depende de refetch bem-sucedido; falha de GET continua visível no banner.

## Escopo preservado

Sem alteração em Lotes/R6, ledger, migrations Prisma, auth/CORS, ou regras R5 de ciclos/hierarquia.
