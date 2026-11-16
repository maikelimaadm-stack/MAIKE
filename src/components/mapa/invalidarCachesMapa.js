/**
 * Invalida as leituras do Mapa Geral e das telas de cadastro do mapa depois de
 * criar, editar ou excluir área, ponto, linha, cocho, depósito ou bebedouro.
 *
 * O Mapa Geral lê tudo pela chave `['mapa-cache', <entidade>, <empresa>, ...]`
 * com `staleTime` de 5 minutos; sem esta invalidação ele voltava mostrando o
 * dado antigo depois de um cadastro feito em outra tela.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string[]} [prefixosExtras] primeiros elementos de queryKey a invalidar além do cache do mapa
 */
export function invalidarCachesDoMapa(queryClient, prefixosExtras = []) {
  if (!queryClient) return Promise.resolve();
  const prefixos = new Set(["mapa-cache", ...prefixosExtras]);
  return queryClient.invalidateQueries({
    predicate: (query) => Array.isArray(query.queryKey) && prefixos.has(query.queryKey[0]),
  });
}
