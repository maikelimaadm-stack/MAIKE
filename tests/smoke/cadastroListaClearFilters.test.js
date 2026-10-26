import { describe, it, expect, vi } from "vitest";
import { clearCadastroListaFiltersAndSearch } from "@/lib/cadastroListaClearFilters";

describe("clearCadastroListaFiltersAndSearch — paridade CDE clearAll (H.5 §7)", () => {
  it("zera busca aplicada, filtros de coluna e seleção (paridade CDE clearAll)", () => {
    const clearFilters = vi.fn();
    const setSearchInput = vi.fn();
    const applySearch = vi.fn();
    const setSelectedIds = vi.fn();

    clearCadastroListaFiltersAndSearch({
      clearFilters,
      setSearchInput,
      applySearch,
      setSelectedIds,
    });

    expect(clearFilters).toHaveBeenCalledOnce();
    expect(setSearchInput).toHaveBeenCalledWith("");
    expect(applySearch).toHaveBeenCalledWith("");
    expect(setSelectedIds).toHaveBeenCalledWith([]);
  });
});
