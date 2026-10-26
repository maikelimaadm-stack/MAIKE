/**
 * Limpar filtros de coluna + busca global — paridade CDE `clearAll` (portal compras / Base1List).
 * Piloto Marcas; demais cadastros podem adotar no rollout pós H.5.
 *
 * @param {{
 *   clearFilters: () => void;
 *   setSearchInput: (v: string) => void;
 *   applySearch: (next?: string) => void;
 * }} chrome
 */
export function clearCadastroListaFiltersAndSearch(chrome) {
  chrome.clearFilters();
  chrome.setSearchInput("");
  chrome.applySearch("");
}
