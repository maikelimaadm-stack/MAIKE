# FIX-LOTES-NAV — Cadastro de Lotes e congelamento de navegação

**Data:** 2026-10-27  
**Branch:** `cursor/fix-lotes-nav-freeze-516d`

## Sintomas

1. **Cadastro de Lotes** — salvar falhava (400 no POST `/lotes`) ou a lista/query não
   carregava; usuário via tela vazia ou toast genérico de erro.
2. **Navegação entre menus** — ao trocar de módulo, o app parecia “travar” por vários
   segundos (splash, spinner, permissões recarregando).

## Causa raiz

### Lotes

| # | Problema | Efeito |
|---|----------|--------|
| L1 | `CadastroLotes` / `FormularioLote` liam só `localStorage` para `empresa_id`, sem fallback `clienteId` do JWT | Query desabilitada até o Layout gravar storage; POST sem `empresa_id` válido |
| L2 | Autocomplete de motivo usava ids `COMPRA`, `AJUSTE`, … | Schema Fastify exige `Compra`, `Ajuste`, `Inventário`, `Outros` → **400** |
| L3 | `motivo_entrada` não era obrigatório na validação do formulário | Payload inválido ou default ausente no cliente |

### Navegação

| # | Problema | Efeito |
|---|----------|--------|
| N1 | Cada `<Route>` em `App.jsx` montava um **Layout novo** | A cada clique no menu: splash mínimo 5s, `getCurrentUser`, `listarPermissoes`, query `empresas` de novo |
| N2 | `isChangingEmpresa` ficava `true` para sempre após trocar empresa | Efeitos de fallback de empresa deixavam de rodar |
| N3 | Gate de permissão podia reabrir diálogo na mesma rota | Sensação de UI bloqueada ao navegar com permissões restritas |

## Correção

- **`App.jsx`:** shell único `AppShell` + `<Outlet />`; Layout persiste entre rotas.
- **`useEmpresaSelecionadaId`:** fallback `clienteId`; escuta evento `maike:empresa-selecionada`.
- **`Layout`:** `persistirEmpresaSelecionada`, reset de `isChangingEmpresa`, gate de permissão com ref.
- **Lotes:** hook de empresa em `CadastroLotes` / `FormularioLote`; ids canônicos de motivo;
  `normalizarMotivoEntrada` + default `Inventário` em `loteCadastroService.criarLote`.

## Verificação

```bash
npm run verify:all
```

Testes relevantes:

- `tests/smoke/manejoServices.test.js` — L4, L4b (motivo e empresa)
- `tests/smoke/scope.test.jsx` — contrato AppShell/Outlet
- `tests/smoke/appShell.test.jsx` — navegação no shell (inalterado em comportamento)

## Arquivos tocados

- `src/App.jsx`
- `src/Layout.jsx`
- `src/hooks/useEmpresaSelecionadaId.js`
- `src/pages/CadastroLotes.jsx`
- `src/components/lotes/FormularioLote.jsx`
- `src/services/loteCadastroService.js`
- `tests/smoke/manejoServices.test.js`
- `tests/smoke/scope.test.jsx`
