/**
 * Emenda 1 da D-PROD-252: "Dias lançados" saiu da tela. Estes módulos não são
 * montados na UI; o import existe para o fechamento do grafo
 * (`gate:source-closure`) e para os testes de fumaça do legado
 * (`tests/smoke/helpers/diasLegadoNoTeste.jsx`).
 */
export { default as ListaApontamentos } from "./ListaApontamentos.jsx";
export { default as FormularioApontamento } from "./FormularioApontamento.jsx";
export { default as LinhasDoApontamento } from "./LinhasDoApontamento.jsx";
export { default as LinhasDoLancamento } from "./LinhasDoLancamento.jsx";
