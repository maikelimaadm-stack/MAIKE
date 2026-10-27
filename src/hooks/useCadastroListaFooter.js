import { useCallback, useState } from "react";
import { useCadastroListaPagination } from "@/hooks/useCadastroListaPagination";

/**
 * Métricas de rodapé + paginação incremental para `CadastroListaChrome` + `CadastroBase1Grade`.
 *
 * @param {string} storageKey prefixo localStorage da grade
 * @param {unknown} resetToken valor que dispara reset do “carregar mais”
 */
export function useCadastroListaFooter(storageKey, resetToken) {
  const { pageSize, setPageSize, displayLimit, loadMore } = useCadastroListaPagination(
    storageKey,
    resetToken,
  );
  const [metrics, setMetrics] = useState({ filtrados: 0, totais: 0 });

  const onListMetrics = useCallback(({ filtrados, totais }) => {
    setMetrics((prev) => {
      if (prev.filtrados === filtrados && prev.totais === totais) return prev;
      return { filtrados, totais };
    });
  }, []);

  const listados = Math.min(displayLimit, metrics.filtrados);
  const hasMore = listados < metrics.filtrados;

  return {
    chromeFooter: {
      pageSize,
      onPageSizeChange: setPageSize,
      hasMore,
      loadingMore: false,
      onLoadMore: loadMore,
      listados,
      filtrados: metrics.filtrados,
      totais: metrics.totais,
    },
    gradePaging: {
      displayLimit,
      onListMetrics,
    },
  };
}
