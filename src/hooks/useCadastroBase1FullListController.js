import { useCallback } from "react";
import { useCadastroBase1HierarchicalController } from "@/hooks/useCadastroBase1HierarchicalController";

/**
 * Filtra lista plana por busca aplicada ou pick de sugestão (sem hierarquia).
 * @template T
 * @param {T[]} items
 * @param {{ appliedSearch: string, searchPickId: string|null }} ctx
 * @param {(item: T) => string} getSearchHaystack
 * @param {(item: T, id: string) => boolean} matchRowId
 */
function filterFlatList(items, ctx, getSearchHaystack, matchRowId) {
  if (ctx.searchPickId) {
    return items.filter((item) => matchRowId(item, ctx.searchPickId));
  }
  const q = ctx.appliedSearch.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => getSearchHaystack(item).toLowerCase().includes(q));
}

/**
 * Motor Base1 — cadastro de lista completa (GET array), mesma superfície que keyset/hierárquico.
 * Evita duplicar orquestração em telas tenant-global (grupos, tipos) e similares.
 *
 * @template {{ id?: string }} T
 * @param {Omit<Parameters<typeof useCadastroBase1HierarchicalController>[0], 'filterRecordNavRows' | 'prepareExportRows'>} config
 */
export function useCadastroBase1FullListController(config) {
  const filterRecordNavRows = useCallback(
    (items, ctx) => filterFlatList(items, ctx, config.getSearchHaystack, config.matchRowId),
    [config.getSearchHaystack, config.matchRowId],
  );

  const prepareExportRows = useCallback(
    (items, ctx) => filterFlatList(items, ctx, config.getSearchHaystack, config.matchRowId),
    [config.getSearchHaystack, config.matchRowId],
  );

  return useCadastroBase1HierarchicalController({
    ...config,
    filterRecordNavRows,
    prepareExportRows,
  });
}
