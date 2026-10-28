# MOTORBASE1-COMPLETE-01 — Relatório de engenharia

## Escopo

Extrair orquestração de cadastro Base1 de Marcas para motor reutilizável; Unidades consome o mesmo núcleo com paridade funcional e paginação keyset real.

## Artefatos

- `src/hooks/useCadastroBase1Controller.js` — estados/transições lista/registro/busca/paginação/export.
- `src/components/cadastro/base1/CadastroBase1Screen.jsx` — composição workspace + chrome.
- `src/components/unidades-medida/FormularioUnidadeMedida.jsx`, `TabelaUnidadesMedida.jsx`.
- Backend `GET /unidades-medida/page` (legado `GET /unidades-medida` array preservado).

## Terceira entidade (fictícia)

Adapter declarativo (sem importar Marcas/Unidades):

```javascript
useCadastroBase1Controller({
  storageKey: "colunas_ficticia_v1",
  columnIds: ["codigo", "nome"],
  queryKey: ["ficticia", "page"],
  fetchPage: ({ limit, cursor, q }) => apiFicticia.listPage({ limit, cursor, q }),
  duplicateLabelField: "nome",
  // …getSearchHaystack, mapSearchSuggestion, CRUD callbacks no adapter da página
});
```

## Evidência

Ver matriz `MOTORBASE1-FULL-PARITY-MATRIX.md` e testes `motorbase1MarcasUnidadesParity.test.jsx`, `useCadastroBase1Controller.test.jsx`, backend `BE-P45-04`–`06`.
