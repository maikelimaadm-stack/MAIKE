import { describe, it, expect, vi } from "vitest";
import { clearCadastroListaFiltersAndSearch } from "@/lib/cadastroListaClearFilters";

describe("clearCadastroListaFiltersAndSearch — paridade CDE clearAll (H.5 §7)", () => {
  it("zera busca aplicada e incrementa reset de filtros de coluna", () => {
    const clearFilters = vi.fn();
    const setSearchInput = vi.fn();
    const applySearch = vi.fn();

    clearCadastroListaFiltersAndSearch({
      clearFilters,
      setSearchInput,
      applySearch,
    });

    expect(clearFilters).toHaveBeenCalledOnce();
    expect(setSearchInput).toHaveBeenCalledWith("");
    expect(applySearch).toHaveBeenCalledWith("");
  });
});
