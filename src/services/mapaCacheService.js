/**
 * Política de cache offline do mapa (P1.2).
 *
 * Antes, `src/components/offline/mapaOfflineCache.jsx` misturava IndexedDB,
 * política de refresh, deduplicação, cooldown **e** acesso direto à Base44.
 * A cadeia da P1.1 não permite isso. A separação agora é:
 *
 * ```
 * UI/hook → mapaCacheService → APIs explícitas de módulo
 *                            → IndexedDB (provider-agnostic)
 * ```
 *
 * Este arquivo conhece política. Não conhece provider: os dados vêm por
 * `@/apis/*`, e o armazenamento por `IndexedDBManager`, que nunca falou Base44.
 *
 * Semântica preservada da versão anterior, com teste para cada item:
 * chave por empresa com `__GLOBAL__`, stale-while-revalidate, leitura offline,
 * deduplicação de request em andamento, `MIN_REFRESH_INTERVAL_MS`, cooldown,
 * `force: true`, limpeza do mapa de promises em `finally`.
 */

import { getEntityCacheItems, setEntityCacheItems } from '@/components/offline/IndexedDBManager';
import { hasApiErrorCode, isApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import {
  listAreas,
  listPontos,
  listPontosSuplementacao,
  listLinhas,
  listIcones,
} from '@/apis/mapa';
import {
  listLotes,
  listMovimentacoes,
  listSuplementacaoEventos,
  listSuplementacaoLotes,
} from '@/apis/lotes';
import { listLotesNota, listMovimentacoes as listMovimentacoesEstoque, listProdutos } from '@/apis/estoque';
import { listLancamentos, listHistorico } from '@/apis/tarefas';
import { listPermissoes } from '@/apis/session';
import {
  listAplicacoesMedicamento,
  listEventosSanitarios,
  listManejosTecnicos,
} from '@/apis/rebanho';

export const MIN_REFRESH_INTERVAL_MS = 60000;
export const RATE_LIMIT_COOLDOWN_MS = 120000;
export const GLOBAL_EMPRESA_KEY = '__GLOBAL__';

const refreshPromises = new Map();
const lastRefreshAt = new Map();
const rateLimitedUntil = new Map();

/**
 * @param {any[]} items
 * @param {string} empresaId
 * @returns {any[]}
 */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);

/**
 * Capacidades do cache. Cada uma é uma função explícita — nada de
 * `entities[nome]`, nada de nome de entidade aberto (QLT-P12-03).
 */
const CAPACIDADES = {
  areas: async (empresaId) => daEmpresa(await listAreas(), empresaId).filter((a) => a.ativo !== false),
  pontos: async (empresaId) => daEmpresa(await listPontos(), empresaId).filter((p) => p.ativo !== false),
  pontosSuplementacao: async (empresaId) =>
    daEmpresa(await listPontosSuplementacao(), empresaId).filter((p) => p.status === 'Ativo'),
  linhas: async (empresaId) => daEmpresa(await listLinhas(), empresaId).filter((l) => l.ativo !== false),
  lotes: async (empresaId) => daEmpresa(await listLotes(), empresaId).filter((l) => l.status === 'Ativo'),
  icones: async () => (await listIcones()).filter((i) => i.ativo !== false),
  eventosSuplementacao: async (empresaId) => daEmpresa(await listSuplementacaoEventos(), empresaId),
  estoqueLotes: async (empresaId) =>
    daEmpresa(await listLotesNota(), empresaId).filter((item) => item.status === 'Disponivel'),
  tarefas: async (empresaId) =>
    daEmpresa(await listLancamentos(), empresaId).filter(
      (t) => t.coordenadas && (t.status === 'Pendente' || t.status === 'Em Andamento')
    ),
  movimentacoes: async (empresaId) => daEmpresa(await listMovimentacoes(), empresaId),
  permissoes: async () => listPermissoes(),
  historicoTarefa: async (empresaId) => daEmpresa(await listHistorico(), empresaId),
  suplementacaoLote: async (empresaId) => daEmpresa(await listSuplementacaoLotes(), empresaId),
  aplicacaoMedicamento: async (empresaId) => daEmpresa(await listAplicacoesMedicamento(), empresaId),
  eventoSanitario: async (empresaId) => daEmpresa(await listEventosSanitarios(), empresaId),
  manejoTecnico: async (empresaId) => daEmpresa(await listManejosTecnicos(), empresaId),
  movimentacaoEstoque: async (empresaId) => daEmpresa(await listMovimentacoesEstoque(), empresaId),
  /**
   * `produtos` faltava no registro anterior enquanto `MapaGeral` pedia a query.
   * O resultado era uma lista sempre vazia, em silêncio (seção 11.4).
   */
  produtos: async (empresaId) => daEmpresa(await listProdutos(), empresaId).filter((p) => p.ativo !== false),
};

export const CACHE_KEYS = Object.keys(CAPACIDADES);

/** Chaves cujo dado não pertence a uma empresa. */
const CHAVES_GLOBAIS = new Set(['icones', 'permissoes']);

export const isChaveGlobal = (cacheKey) => CHAVES_GLOBAIS.has(cacheKey);
export const temCapacidade = (cacheKey) => Object.prototype.hasOwnProperty.call(CAPACIDADES, cacheKey);

const normalizarEmpresa = (empresaId) => empresaId || GLOBAL_EMPRESA_KEY;
const chaveDeArmazenamento = (cacheKey) => `mapa_${cacheKey}`;

/** Leitura pura do cache, sem rede. */
export const getMapaCachedData = async (cacheKey, empresaId) =>
  getEntityCacheItems(chaveDeArmazenamento(cacheKey), normalizarEmpresa(empresaId));

/**
 * O erro merece cooldown?
 *
 * Antes: `String(error.message).includes('rate limit exceeded')`. Decidir por
 * substring de mensagem do SDK é frágil e vaza texto cru para a lógica. Agora a
 * decisão é por **código estável** (QLT-P12-07).
 */
const mereceCooldown = (erro) =>
  hasApiErrorCode(erro, API_ERROR_CODES.PROVIDER_UNAVAILABLE) ||
  (isApiError(erro) && erro.retryable === true);

/**
 * Atualiza uma entrada do cache respeitando política.
 *
 * @param {string} cacheKey
 * @param {string|null} empresaId
 * @param {{force?: boolean}} [options]
 * @returns {Promise<Array<object>>}
 */
export const refreshMapaCacheEntry = async (cacheKey, empresaId, options = {}) => {
  if (!temCapacidade(cacheKey)) return [];

  const empresaNormalizada = normalizarEmpresa(empresaId);
  const requestKey = `${cacheKey}:${empresaNormalizada}`;
  const storageKey = chaveDeArmazenamento(cacheKey);
  const agora = Date.now();
  const force = options.force === true;

  // Deduplicação: quem chega no meio de um refresh espera o mesmo resultado.
  if (refreshPromises.has(requestKey)) return refreshPromises.get(requestKey);

  const emCooldown = agora < (rateLimitedUntil.get(requestKey) || 0);
  const recente = agora - (lastRefreshAt.get(requestKey) || 0) < MIN_REFRESH_INTERVAL_MS;
  if (!force && (emCooldown || recente)) {
    return (await getEntityCacheItems(storageKey, empresaNormalizada)) || [];
  }

  const promise = (async () => {
    try {
      const items = await CAPACIDADES[cacheKey](empresaId);
      await setEntityCacheItems(storageKey, empresaNormalizada, items);
      lastRefreshAt.set(requestKey, Date.now());
      rateLimitedUntil.delete(requestKey);
      return items;
    } catch (erro) {
      if (mereceCooldown(erro)) {
        rateLimitedUntil.set(requestKey, Date.now() + RATE_LIMIT_COOLDOWN_MS);
      }
      // Só código, operação e chave. Nunca token, URL, payload ou texto do SDK.
      console.warn('[mapa-cache] usando cache offline', {
        code: isApiError(erro) ? erro.code : API_ERROR_CODES.OPERATION_FAILED,
        cacheKey,
        empresa: empresaNormalizada,
      });
      return (await getEntityCacheItems(storageKey, empresaNormalizada)) || [];
    }
  })();

  refreshPromises.set(requestKey, promise);
  try {
    return await promise;
  } finally {
    refreshPromises.delete(requestKey);
  }
};

/** Reescreve uma entrada do cache. Aceita valor ou função de atualização. */
export const updateMapaCachedData = async (cacheKey, empresaId, updater) => {
  const empresaNormalizada = normalizarEmpresa(empresaId);
  const storageKey = chaveDeArmazenamento(cacheKey);
  const atuais = (await getEntityCacheItems(storageKey, empresaNormalizada)) || [];
  const proximos = typeof updater === 'function' ? updater(atuais) : updater;
  await setEntityCacheItems(storageKey, empresaNormalizada, proximos || []);
  return proximos || [];
};

/** Aquece todas as capacidades. Uma falha isolada não derruba as demais. */
export const warmMapaCache = async (empresaId) => {
  await Promise.all(
    CACHE_KEYS.map(async (cacheKey) => {
      try {
        await refreshMapaCacheEntry(cacheKey, isChaveGlobal(cacheKey) ? GLOBAL_EMPRESA_KEY : empresaId);
      } catch {
        // `refreshMapaCacheEntry` já trata e cai no cache; aqui é só contenção.
      }
    })
  );
};

/** Reinicia a política. Existe para teste — não é usado pela aplicação. */
export const __resetMapaCachePolicy = () => {
  refreshPromises.clear();
  lastRefreshAt.clear();
  rateLimitedUntil.clear();
};
