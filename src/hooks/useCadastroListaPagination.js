import { useCallback, useEffect, useState } from "react";
import {
  CADASTRO_B1_DEFAULT_PAGE_SIZE,
  CADASTRO_B1_PAGE_SIZES,
} from "@/components/cadastro/base1/cadastroBase1List";

/**
 * Paginação incremental no cliente (paridade rodapé Base1 — “Carregar mais”).
 *
 * @param {string} storageKey prefixo localStorage (mesmo da grade)
 * @param {unknown} resetToken muda quando busca/filtros resetam (ex.: resetFiltersKey + appliedSearch)
 */
export function useCadastroListaPagination(storageKey, resetToken) {
  const [pageSize, setPageSizeState] = useState(() => {
    try {
      const raw = localStorage.getItem(`${storageKey}_pageSize`);
      const n = Number(raw);
      return CADASTRO_B1_PAGE_SIZES.includes(n) ? n : CADASTRO_B1_DEFAULT_PAGE_SIZE;
    } catch {
      return CADASTRO_B1_DEFAULT_PAGE_SIZE;
    }
  });

  const [displayLimit, setDisplayLimit] = useState(pageSize);

  useEffect(() => {
    setDisplayLimit(pageSize);
  }, [resetToken, pageSize]);

  const setPageSize = useCallback(
    (n) => {
      const size = CADASTRO_B1_PAGE_SIZES.includes(n) ? n : CADASTRO_B1_DEFAULT_PAGE_SIZE;
      setPageSizeState(size);
      try {
        localStorage.setItem(`${storageKey}_pageSize`, String(size));
      } catch {
        /* sem storage */
      }
      setDisplayLimit(size);
    },
    [storageKey],
  );

  const loadMore = useCallback(() => {
    setDisplayLimit((c) => c + pageSize);
  }, [pageSize]);

  return { pageSize, setPageSize, displayLimit, loadMore };
}
