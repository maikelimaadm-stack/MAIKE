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
 * chave por empresa (`__GLOBAL__` sem empresa), stale-while-revalidate, leitura offline,
 * deduplicação de request em andamento, `MIN_REFRESH_INTERVAL_MS`, cooldown,
 * `force: true`, limpeza do mapa de promises em `finally`.
 */

import { ehMovimentoAtivo } from '@/domain/lotes/situacaoMovimento';
import {
  getEntityCacheItems,
  getEntityCacheRecord,
  setEntityCacheItems,
  deleteEntityCacheRecord,
} from '@/components/offline/IndexedDBManager';
import { getOfflineTenant } from '@/lib/offline/offlineTenant';
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
  listarPosicoesRebanhoServidor,
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
/** Marca o dono "tenant" na chave — o mesmo prefixo do runtime offline (P4.1-R1). */
const TENANT_PREFIXO = 'cli:';

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
  // R2E-P1 (D-PROD-107): empresa no ledger → o mapa mostra POSIÇÕES (saldo por área); o Lote é só o cadastro.
  // Erro na consulta propaga (sem cair para Lote como saldo).
  lotes: async (empresaId) => {
    const ledger = /** @type {{ativo?: boolean, itens?: any[]}} */ (await listarPosicoesRebanhoServidor(empresaId));
    if (ledger?.ativo) return ledger.itens;
    return daEmpresa(await listLotes(), empresaId).filter((l) => l.status === 'Ativo');
  },
  icones: async () => (await listIcones()).filter((i) => i.ativo !== false),
  eventosSuplementacao: async (empresaId) => daEmpresa(await listSuplementacaoEventos(), empresaId),
  estoqueLotes: async (empresaId) =>
    daEmpresa(await listLotesNota(), empresaId).filter((item) => item.status === 'Disponivel'),
  tarefas: async (empresaId) =>
    daEmpresa(await listLancamentos(), empresaId).filter(
      (t) => t.coordenadas && (t.status === 'Pendente' || t.status === 'Em Andamento')
    ),
  // Cancelado (R2A) não tem efeito atual: fora do cache que alimenta mapa e lotes.
  movimentacoes: async (empresaId) => daEmpresa(await listMovimentacoes(), empresaId).filter(ehMovimentoAtivo),
  // Histórico (R2A-R1, P1-B): ativos E cancelados, com situação, motivo e autor.
  // É cópia parcial do que o servidor tinha no último refresh — não é histórico completo.
  movimentacoesHistorico: async (empresaId) => daEmpresa(await listMovimentacoes(), empresaId),
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

/**
 * Chaves cujo dado é do TENANT, não de uma empresa (D-PROD-136, GET-06).
 *
 * Antes eram "globais": `mapa_icones::__GLOBAL__`, sem dono, e o logout não as
 * apagava. Mas `ConfiguracaoIcone` e `Permissao` têm `cliente_id` no servidor:
 * no mesmo aparelho, a fazenda B abria o mapa com os ícones da fazenda A. O
 * catálogo global PUBLICADO (`catalogoGlobalService`) não passa por aqui.
 */
const CHAVES_DO_TENANT = new Set(['icones', 'permissoes']);

export const isChaveDoTenant = (cacheKey) => CHAVES_DO_TENANT.has(cacheKey);
export const temCapacidade = (cacheKey) => Object.prototype.hasOwnProperty.call(CAPACIDADES, cacheKey);

const chaveDeArmazenamento = (cacheKey) => `mapa_${cacheKey}`;

/**
 * Dono do registro no cache: a empresa (`__GLOBAL__` sem empresa) ou, para dado
 * do tenant, o tenant da sessão nativa — a empresa recebida é ignorada, quem
 * decide é a política, não a tela. `null` = dado do tenant sem tenant conhecido:
 * nada é lido nem gravado (falha fechada; a rede tira o tenant do token).
 *
 * @param {string} cacheKey
 * @param {string|null|undefined} empresaId
 * @returns {string|null}
 */
const donoDoCache = (cacheKey, empresaId) => {
  if (!isChaveDoTenant(cacheKey)) return empresaId || GLOBAL_EMPRESA_KEY;
  const tenant = getOfflineTenant();
  return tenant ? `${TENANT_PREFIXO}${tenant}` : null;
};

/** Leitura pura do cache, sem rede. */
export const getMapaCachedData = async (cacheKey, empresaId) => {
  const dono = donoDoCache(cacheKey, empresaId);
  if (!dono) return [];
  return getEntityCacheItems(chaveDeArmazenamento(cacheKey), dono);
};

/**
 * Cache + quando foi gravado. Para a tela dizer "dados salvos em …" em vez de
 * apresentar cache como se fosse a resposta do servidor (D-PROD-94).
 *
 * @returns {Promise<{ items: any[], atualizadoEm: string|null }>}
 */
export const getMapaCacheSnapshot = async (cacheKey, empresaId) => {
  const dono = donoDoCache(cacheKey, empresaId);
  const registro = dono ? await getEntityCacheRecord(chaveDeArmazenamento(cacheKey), dono) : null;
  return {
    items: Array.isArray(registro?.items) ? registro.items : [],
    atualizadoEm: typeof registro?.updated_at === 'string' ? registro.updated_at : null,
  };
};

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

  const dono = donoDoCache(cacheKey, empresaId);
  // Dado do tenant sem tenant conhecido: só rede, sem cache e sem política em
  // memória — as duas são por dono, e aqui não há dono.
  if (!dono) {
    try {
      return await CAPACIDADES[cacheKey](empresaId);
    } catch {
      return [];
    }
  }
  // Política (dedupe, intervalo, cooldown) também por dono: `icones:__GLOBAL__`
  // fazia o refresh da fazenda B, em menos de 60 s, devolver o cache da A.
  const requestKey = `${cacheKey}:${dono}`;
  const storageKey = chaveDeArmazenamento(cacheKey);
  const agora = Date.now();
  const force = options.force === true;

  // Deduplicação: quem chega no meio de um refresh espera o mesmo resultado.
  if (refreshPromises.has(requestKey)) return refreshPromises.get(requestKey);

  const emCooldown = agora < (rateLimitedUntil.get(requestKey) || 0);
  const recente = agora - (lastRefreshAt.get(requestKey) || 0) < MIN_REFRESH_INTERVAL_MS;
  if (!force && (emCooldown || recente)) {
    return (await getEntityCacheItems(storageKey, dono)) || [];
  }

  const promise = (async () => {
    try {
      const items = await CAPACIDADES[cacheKey](empresaId);
      await setEntityCacheItems(storageKey, dono, items);
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
        empresa: isChaveDoTenant(cacheKey) ? 'tenant' : dono,
      });
      return (await getEntityCacheItems(storageKey, dono)) || [];
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
  const dono = donoDoCache(cacheKey, empresaId);
  const storageKey = chaveDeArmazenamento(cacheKey);
  const atuais = dono ? (await getEntityCacheItems(storageKey, dono)) || [] : [];
  const proximos = typeof updater === 'function' ? updater(atuais) : updater;
  if (dono) await setEntityCacheItems(storageKey, dono, proximos || []);
  return proximos || [];
};

/** Aquece todas as capacidades. Uma falha isolada não derruba as demais. */
export const warmMapaCache = async (empresaId) => {
  await Promise.all(
    CACHE_KEYS.map(async (cacheKey) => {
      try {
        // O dono (empresa ou tenant) é resolvido pela política, por chave.
        await refreshMapaCacheEntry(cacheKey, empresaId);
      } catch {
        // `refreshMapaCacheEntry` já trata e cai no cache; aqui é só contenção.
      }
    })
  );
};

const zerarPolitica = () => {
  refreshPromises.clear();
  lastRefreshAt.clear();
  rateLimitedUntil.clear();
};

/**
 * Logout (D-PROD-136, GET-06): apaga do aparelho o cache do tenant que sai e o
 * legado `__GLOBAL__` (gravado antes desta correção, sem dono), e zera a
 * política em memória — sem isso, o mesmo tenant que voltasse em menos de 60 s
 * leria como "recente" o cache recém-apagado e ficaria sem ícones.
 *
 * Cache por empresa fica: id de empresa é único entre tenants e nenhuma outra
 * fazenda o lê. Fila e pendências NÃO são tocadas: são dado de campo ainda não
 * sincronizado. Falha de IndexedDB não propaga: o logout não espera por isto.
 *
 * @param {string|null|undefined} tenantId tenant lido ANTES do descarte da sessão
 */
export const esquecerCacheDoTenant = async (tenantId) => {
  zerarPolitica();
  const donos = [GLOBAL_EMPRESA_KEY, ...(tenantId ? [`${TENANT_PREFIXO}${tenantId}`] : [])];
  await Promise.all(
    [...CHAVES_DO_TENANT].flatMap((cacheKey) =>
      donos.map((dono) => deleteEntityCacheRecord(chaveDeArmazenamento(cacheKey), dono).catch(() => {}))
    )
  );
};

/** Reinicia a política. Existe para teste (a aplicação zera só no logout). */
export const __resetMapaCachePolicy = zerarPolitica;
