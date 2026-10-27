import { useCallback, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  CADASTRO_B1_MAX_JANELA,
  LIMITE_MAXIMO,
  normalizarLimiteCliente,
} from "@/lib/cadastroListaScale";

/**
 * Motor Base1 — listagem infinita por keyset (D-PROD-55).
 *
 * Entidade-agnóstico: a tela passa `queryKey` + `fetchPage`. Mudanças aqui
 * valem para todo cadastro que consumir o motor (Marcas, Produtos, …).
 *
 * @template T
 * @param {{
 *   queryKey: unknown[],
 *   enabled?: boolean,
 *   pageSize?: number,
 *   maxJanela?: number,
 *   fetchPage: (args: { limit: number, cursor: string|null }) => Promise<{
 *     items: T[],
 *     next_cursor: string|null,
 *     has_more: boolean,
 *     total: number,
 *     limit: number,
 *   }>,
 * }} opts
 */
export function useCadastroInfiniteList({
  queryKey,
  enabled = true,
  pageSize,
  maxJanela = CADASTRO_B1_MAX_JANELA,
  fetchPage,
}) {
  const limit = normalizarLimiteCliente(pageSize, { maximo: LIMITE_MAXIMO });
  const key = useMemo(() => [...queryKey, limit], [queryKey, limit]);

  const query = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: /** @type {string|null} */ (null),
    queryFn: ({ pageParam }) => fetchPage({ limit, cursor: pageParam }),
    getNextPageParam: (last) => (last.has_more ? last.next_cursor : undefined),
  });

  const items = useMemo(() => {
    const flat = (query.data?.pages ?? []).flatMap((p) => p.items ?? []);
    if (flat.length <= maxJanela) return flat;
    return flat.slice(0, maxJanela);
  }, [query.data, maxJanela]);

  const total = query.data?.pages?.[0]?.total ?? 0;
  const serverHasMore = Boolean(query.hasNextPage);
  const janelaCheia = items.length >= maxJanela;
  const hasMore = serverHasMore && !janelaCheia;

  const loadMore = useCallback(() => {
    if (!hasMore || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [hasMore, query]);

  return {
    items,
    total,
    limit,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    isFetchingNextPage: query.isFetchingNextPage,
    hasMore,
    serverHasMore,
    janelaCheia,
    loadMore,
    refetch: query.refetch,
    queryKey: key,
  };
}
