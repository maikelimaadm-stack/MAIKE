/**
 * Chaves do cache do Mapa Geral (`mapaCacheService`) que cada prefixo de
 * queryKey passado pelos cadastros afeta. Só estas chaves são marcadas para a
 * próxima leitura ir ao servidor: marcar todas fazia cada cadastro disparar
 * ~12 GETs forçados (inclusive com o servidor em cooldown).
 */
const CHAVES_DO_MAPA_POR_PREFIXO = {
  areas: ["areas"],
  pontos: ["pontos"],
  "mapa-pontos": ["pontos"],
  bebedouros: ["pontos"],
  "bebedouros-form": ["pontos"],
  "pontos-suplementacao": ["pontosSuplementacao"],
  "pontos-suplementacao-form": ["pontosSuplementacao"],
  "pontos-supl": ["pontosSuplementacao"],
  "mapa-pontos-supl": ["pontosSuplementacao"],
  "locais-estoque": ["pontosSuplementacao"],
  "saldo-deposito": ["pontosSuplementacao"],
  linhas: ["linhas"],
  "mapa-estoque-lotes": ["estoqueLotes"],
  "estoque-lotes-transferencia": ["estoqueLotes"],
  "lotes-nota-suplementacao": ["estoqueLotes"],
  produtos: ["produtos"],
};

/** Nomes do próprio cache do mapa também valem como prefixo. */
const CHAVES_DO_MAPA = new Set(Object.values(CHAVES_DO_MAPA_POR_PREFIXO).flat());

let geracaoInvalidacao = 0;
/** @type {Map<string, number>} última geração marcada por chave do cache do mapa */
const geracaoMarcada = new Map();
/** @type {Map<string, number>} geração já atendida por chave do cache do mapa */
const geracaoAtendida = new Map();

/**
 * Invalida as leituras do Mapa Geral e das telas de cadastro do mapa depois de
 * criar, editar ou excluir área, ponto, linha, cocho, depósito ou bebedouro.
 *
 * O Mapa Geral lê tudo pela chave `['mapa-cache', <entidade>, <empresa>, ...]`
 * com `staleTime` de 5 minutos; sem esta invalidação ele voltava mostrando o
 * dado antigo depois de um cadastro feito em outra tela.
 *
 * Invalidar o React Query não basta: a leitura do Mapa Geral devolve primeiro
 * a cópia do IndexedDB e o refresh em segundo plano respeita o intervalo
 * mínimo de 60 s (`MIN_REFRESH_INTERVAL_MS`), então voltava a cópia velha. Por
 * isso a chamada também marca uma nova "geração" nas chaves do mapa afetadas
 * pelos `prefixosExtras` (ex.: `'areas'` → `areas`; `'mapa-pontos-supl'` →
 * `pontosSuplementacao`): a próxima leitura DESSAS chaves
 * (`mapaPrecisaBuscarNoServidor`) vai ao servidor com `force`. Prefixo que não
 * corresponde a nenhuma chave do mapa só invalida o React Query.
 *
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string[]} [prefixosExtras] primeiros elementos de queryKey a invalidar além do cache do mapa
 */
export function invalidarCachesDoMapa(queryClient, prefixosExtras = []) {
  if (!queryClient) return Promise.resolve();
  const afetadas = new Set();
  for (const prefixo of prefixosExtras) {
    for (const chave of CHAVES_DO_MAPA_POR_PREFIXO[prefixo] || []) afetadas.add(chave);
    if (CHAVES_DO_MAPA.has(prefixo)) afetadas.add(prefixo);
  }
  if (afetadas.size) {
    geracaoInvalidacao += 1;
    for (const chave of afetadas) geracaoMarcada.set(chave, geracaoInvalidacao);
  }
  const prefixos = new Set(["mapa-cache", ...prefixosExtras]);
  return queryClient.invalidateQueries({
    predicate: (query) => Array.isArray(query.queryKey) && prefixos.has(query.queryKey[0]),
  });
}

/**
 * Houve cadastro/exclusão que afeta esta chave do mapa desde a última leitura
 * dela? Devolve `true` uma única vez por chave e por invalidação (consome a
 * marca): quem chama deve então buscar no servidor com `force`. Fica no módulo
 * (e não no componente) porque o Mapa Geral é desmontado enquanto o usuário
 * está no cadastro.
 *
 * @param {string} cacheKey
 * @returns {boolean}
 */
export function mapaPrecisaBuscarNoServidor(cacheKey) {
  const marcada = geracaoMarcada.get(cacheKey) ?? 0;
  const atendida = geracaoAtendida.get(cacheKey) ?? 0;
  if (atendida >= marcada) return false;
  geracaoAtendida.set(cacheKey, marcada);
  return true;
}
