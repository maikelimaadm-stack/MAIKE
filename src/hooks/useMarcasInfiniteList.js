import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  listarMarcasPagina,
  MARCAS_MAX_JANELA_CLIENTE,
} from "@/services/marcaService";
import { LIMITE_MAXIMO } from "@/lib/cadastroListaScale";

/**
 * Lista Marcas por keyset (D-PROD-54) — nunca materializa o tenant inteiro.
 *
 * @param {{
 *   empresaId: string|null|undefined,
 *   q?: string,
 *   pageSize: number,
 * }} opts
 */
export function useMarcasInfiniteList({ empresaId, q = "", pageSize }) {
  const limit = Math.min(Math.max(1, pageSize || 100), LIMITE_MAXIMO);

  const query = useInfiniteQuery({
    queryKey: ["marcas", "page", empresaId, q, limit],
    enabled: Boolean(empresaId),
    initialPageParam: /** @type {string|null} */ (null),
    queryFn: ({ pageParam }) =>
      listarMarcasPagina(empresaId, {
        limit,
        cursor: pageParam,
        q: q || undefined,
      }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
  });

  const items = useMemo(() => {
    const flat = (query.data?.pages ?? []).flatMap((p) => p.items ?? []);
    if (flat.length <= MARCAS_MAX_JANELA_CLIENTE) return flat;
    return flat.slice(0, MARCAS_MAX_JANELA_CLIENTE);
  }, [query.data]);

  const total = query.data?.pages?.[0]?.total ?? 0;
  const serverHasMore = Boolean(query.hasNextPage);
  const janelaCheia = items.length >= MARCAS_MAX_JANELA_CLIENTE;
  const hasMore = serverHasMore && !janelaCheia;

  const loadMore = useCallback(() => {
    if (!hasMore || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [hasMore, query]);

  return {
    marcas: items,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasMore,
    serverHasMore,
    janelaCheia,
    loadMore,
    refetch: query.refetch,
    queryKey: ["marcas", "page", empresaId, q, limit],
  };
}
