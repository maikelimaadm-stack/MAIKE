import { useQuery } from "@tanstack/react-query";

/**
 * Motor Base1 — listagem completa em memória (cadastros hierárquicos).
 * Não simula keyset: `GET` devolve o conjunto inteiro do tenant (D-PROD-55 rollout Categorias).
 *
 * @template T
 * @param {{
 *   queryKey: unknown[],
 *   enabled?: boolean,
 *   fetchAll: () => Promise<T[]>,
 * }} opts
 */
export function useCadastroBase1FullList({ queryKey, enabled = true, fetchAll }) {
  const query = useQuery({
    queryKey,
    queryFn: fetchAll,
    enabled,
  });

  const items = query.data ?? [];
  const limit = Math.max(items.length, 100);

  return {
    items,
    total: items.length,
    limit,
    queryKey,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
    /** Compatível com shape mínimo usado pela screen (sem paginação). */
    hasMore: false,
    serverHasMore: false,
    janelaCheia: false,
    isFetchingNextPage: false,
    loadMore: () => {},
  };
}
