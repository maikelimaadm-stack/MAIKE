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
  listCategoriasManejo,
} from '@/apis/lotes';
import { listLotesNota, listMovimentacoes as listMovimentacoesEstoque, listProdutos } from '@/apis/estoque';
import { listLancamentos, listHistorico } from '@/apis/tarefas';
import { listPermissoes } from '@/apis/session';
import { listLeiturasCocho } from '@/apis/leituras-cocho';
import { leiturasAguardandoEnvio } from '@/services/leituraCochoService';
import { comEstoqueAguardandoEnvio } from '@/services/estoqueAguardandoEnvioService';
import { comLancamentosAguardandoEnvio } from '@/services/lancamentoCochoAguardandoService';
import { comTransferenciasCanceladasAguardando } from '@/services/cancelamentosAguardandoService';
import { movimentacoesAguardandoEnvio } from '@/services/historicoAguardandoEnvioService';
import { listMedicoesForragem, listDescansoPastos } from '@/apis/medicoes-forragem';
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
/**
 * Leitura FORÇADA em andamento, por dono. Separada da comum: a forçada vem
 * depois de uma gravação (manejo, cadastro) e não pode reaproveitar uma leitura
 * comum que saiu ANTES da gravação, senão devolve o dado velho e ainda marca
 * `lastRefreshAt`, travando a cópia velha por 60 s.
 */
const refreshForcados = new Map();
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
  // D-PROD-191: o ícone do lote vem do código pela faixa de idade da Categoria de
  // Manejo; ela fica no cache para o ícone sair certo também sem rede. Inclui as
  // inativas: uma posição antiga pode apontar para uma delas.
  categoriasManejo: async (empresaId) => daEmpresa(await listCategoriasManejo(), empresaId),
  eventosSuplementacao: async (empresaId) => daEmpresa(await listSuplementacaoEventos(), empresaId),
  // D-PROD-205: leituras de cocho (escore, acesso, estrutura) — o farol do cocho no mapa, também sem rede.
  leiturasCocho: async (empresaId) => daEmpresa(await listLeiturasCocho(), empresaId),
  // D-PROD-219: medições de forragem dos pastos (régua, no olho, amostra de MS), também sem rede.
  medicoesForragem: async (empresaId) => daEmpresa(await listMedicoesForragem(), empresaId),
  // D-PROD-223: por pasto, lote dentro agora e o dia da última saída (ledger), para o farol estimado.
  // Sem fazenda não há o que pedir: lista vazia.
  descansoPastos: async (empresaId) => (empresaId ? listDescansoPastos(empresaId) : []),
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
   *
   * Inclui os INATIVOS (D-PROD-178): o mapa usa o cadastro para saber a
   * unidade dos lotes de estoque do depósito, e um lote em litros continua em
   * litros quando o produto é desativado (P-11). Só com os ativos, o marcador
   * somava esse litro no kg enquanto o detalhe do depósito (cadastro inteiro)
   * não somava. Quem precisa só dos ativos filtra na hora de usar.
   */
  produtos: async (empresaId) => daEmpresa(await listProdutos(), empresaId),
};

export const CACHE_KEYS = Object.keys(CAPACIDADES);

/**
 * Chaves cujo dado é do TENANT, não de uma empresa (D-PROD-137, GET-06).
 *
 * Antes eram "globais": `mapa_icones::__GLOBAL__`, sem dono, e o logout não as
 * apagava. Mas `ConfiguracaoIcone` e `Permissao` têm `cliente_id` no servidor:
 * no mesmo aparelho, a fazenda B abria o mapa com os ícones da fazenda A. O
 * catálogo global PUBLICADO (`@/apis/catalogoGlobal`) não passa por aqui.
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

/**
 * D-PROD-296/298 — o que foi feito sem internet e espera envio, aplicado NA
 * LEITURA (nunca gravado no cache). O cache guarda só o que o servidor
 * respondeu; assim, excluir da fila um registro (ou um cancelamento) que ainda
 * não subiu desfaz o efeito na tela, sem sobrar nada gravado. Marcas
 * `aguardando:…` antigas que uma tela tenha gravado são trocadas pelas da fila.
 */
const SEM_MARCAS = (/** @type {any[]} */ itens) =>
  (Array.isArray(itens) ? itens : []).filter((i) => !String(i?.id ?? '').startsWith('aguardando:'));
/** @type {Record<string, (itens: any[], empresaId: string|null) => Promise<any[]>>} */
const VISAO_DO_QUE_ESPERA_ENVIO = {
  leiturasCocho: async (itens, empresaId) => [...(await leiturasAguardandoEnvio(empresaId)), ...SEM_MARCAS(itens)],
  eventosSuplementacao: (itens, empresaId) => comLancamentosAguardandoEnvio(SEM_MARCAS(itens), empresaId),
  estoqueLotes: async (itens, empresaId) =>
    (await comEstoqueAguardandoEnvio(SEM_MARCAS(itens))).filter((l) => !empresaId || l.empresa_id === empresaId),
  // D-PROD-300: o que espera envio também aparece no histórico do depósito.
  movimentacaoEstoque: async (itens, empresaId) =>
    comTransferenciasCanceladasAguardando([...(await movimentacoesAguardandoEnvio(empresaId)), ...SEM_MARCAS(itens)]),
};

/**
 * @param {string} cacheKey
 * @param {any[]} itens
 * @param {string|null|undefined} empresaId
 */
const comOQueEsperaEnvio = async (cacheKey, itens, empresaId) => {
  const visao = VISAO_DO_QUE_ESPERA_ENVIO[cacheKey];
  if (!visao) return itens;
  try {
    return await visao(Array.isArray(itens) ? itens : [], empresaId ?? null);
  } catch {
    return itens;
  }
};

/** Leitura pura do cache, sem rede (com a visão do que espera envio). */
export const getMapaCachedData = async (cacheKey, empresaId) => {
  const dono = donoDoCache(cacheKey, empresaId);
  if (!dono) return [];
  return comOQueEsperaEnvio(cacheKey, await getEntityCacheItems(chaveDeArmazenamento(cacheKey), dono), empresaId);
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
    items: await comOQueEsperaEnvio(cacheKey, Array.isArray(registro?.items) ? registro.items : [], empresaId),
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
export const refreshMapaCacheEntry = async (cacheKey, empresaId, options = {}) =>
  (await refreshMapaCacheEntryDetalhado(cacheKey, empresaId, options)).dados;

/**
 * Igual a `refreshMapaCacheEntryDetalhado`, com a visão do que espera envio
 * nos dados devolvidos (o cache continua só com o que o servidor respondeu).
 * @param {string} cacheKey
 * @param {string|null} empresaId
 * @param {{force?: boolean}} [options]
 */
const refreshComVisao = async (cacheKey, empresaId, options) => {
  const r = await refreshMapaCacheEntryCru(cacheKey, empresaId, options);
  return { ...r, dados: await comOQueEsperaEnvio(cacheKey, r.dados, empresaId) };
};

/** @typedef {{ dados: Array<object>, origem: 'rede'|'cache', erro: string|null }} ResultadoLeituraMapa */

/**
 * Igual a `refreshMapaCacheEntry`, mas diz DE ONDE veio o dado (D-PROD-250):
 * `origem: 'rede'` só quando o servidor respondeu e a resposta foi gravada;
 * `'cache'` quando voltou a cópia do aparelho (intervalo de 60 s, cooldown,
 * falha de rede ou troca de sessão no meio da leitura), com `erro` (código
 * estável) quando houve falha. Quem precisa SABER se releu do servidor (depois
 * de um manejo) usa esta.
 *
 * @param {string} cacheKey
 * @param {string|null} empresaId
 * @param {{force?: boolean}} [options]
 * @returns {Promise<ResultadoLeituraMapa>}
 */
export const refreshMapaCacheEntryDetalhado = (cacheKey, empresaId, options = {}) => refreshComVisao(cacheKey, empresaId, options);

/**
 * @param {string} cacheKey
 * @param {string|null} empresaId
 * @param {{force?: boolean}} [options]
 * @returns {Promise<ResultadoLeituraMapa>}
 */
const refreshMapaCacheEntryCru = async (cacheKey, empresaId, options = {}) => {
  if (!temCapacidade(cacheKey)) return { dados: [], origem: 'cache', erro: 'SEM_CAPACIDADE' };

  const dono = donoDoCache(cacheKey, empresaId);
  // Dado do tenant sem tenant conhecido: só rede, sem cache e sem política em
  // memória — as duas são por dono, e aqui não há dono.
  if (!dono) {
    try {
      return { dados: await CAPACIDADES[cacheKey](empresaId), origem: 'rede', erro: null };
    } catch (erro) {
      return { dados: [], origem: 'cache', erro: isApiError(erro) ? erro.code : API_ERROR_CODES.OPERATION_FAILED };
    }
  }
  // Política (dedupe, intervalo, cooldown) também por dono: `icones:__GLOBAL__`
  // fazia o refresh da fazenda B, em menos de 60 s, devolver o cache da A.
  const requestKey = `${cacheKey}:${dono}`;
  const storageKey = chaveDeArmazenamento(cacheKey);
  const agora = Date.now();
  const force = options.force === true;

  // Deduplicação: leitura comum espera a que estiver em andamento (comum ou
  // forçada). A forçada só se junta a outra forçada; se houver uma comum no
  // meio, espera ela terminar e busca de novo (a comum pode ter saído antes da
  // gravação que motivou a forçada).
  if (force && refreshForcados.has(requestKey)) return refreshForcados.get(requestKey);
  if (!force && refreshPromises.has(requestKey)) return refreshPromises.get(requestKey);

  const emCooldown = agora < (rateLimitedUntil.get(requestKey) || 0);
  const recente = agora - (lastRefreshAt.get(requestKey) || 0) < MIN_REFRESH_INTERVAL_MS;
  if (!force && (emCooldown || recente)) {
    return { dados: (await getEntityCacheItems(storageKey, dono)) || [], origem: 'cache', erro: null };
  }

  const anterior = force ? refreshPromises.get(requestKey) : null;
  /** @type {Promise<ResultadoLeituraMapa>} */
  const promise = (async () => {
    if (anterior) await anterior.catch(() => {});
    // A sessão (tenant) de quando a leitura saiu: se mudou até a resposta
    // chegar, a resposta é de OUTRA sessão e não vai para o cache (D-PROD-250).
    const tenantNaSaida = getOfflineTenant();
    try {
      const items = await CAPACIDADES[cacheKey](empresaId);
      if (getOfflineTenant() !== tenantNaSaida) {
        return { dados: (await getEntityCacheItems(storageKey, dono)) || [], origem: 'cache', erro: 'TENANT_TROCOU' };
      }
      await setEntityCacheItems(storageKey, dono, items);
      lastRefreshAt.set(requestKey, Date.now());
      rateLimitedUntil.delete(requestKey);
      return { dados: items, origem: 'rede', erro: null };
    } catch (erro) {
      if (mereceCooldown(erro)) {
        rateLimitedUntil.set(requestKey, Date.now() + RATE_LIMIT_COOLDOWN_MS);
      }
      const code = isApiError(erro) ? erro.code : API_ERROR_CODES.OPERATION_FAILED;
      // Só código, operação e chave. Nunca token, URL, payload ou texto do SDK.
      console.warn('[mapa-cache] usando cache offline', {
        code,
        cacheKey,
        empresa: isChaveDoTenant(cacheKey) ? 'tenant' : dono,
      });
      return { dados: (await getEntityCacheItems(storageKey, dono)) || [], origem: 'cache', erro: code };
    }
  })();

  refreshPromises.set(requestKey, promise);
  if (force) refreshForcados.set(requestKey, promise);
  try {
    return await promise;
  } finally {
    if (refreshPromises.get(requestKey) === promise) refreshPromises.delete(requestKey);
    if (refreshForcados.get(requestKey) === promise) refreshForcados.delete(requestKey);
  }
};

/** Reescreve uma entrada do cache. Aceita valor ou função de atualização. */
export const updateMapaCachedData = async (cacheKey, empresaId, updater) => {
  const dono = donoDoCache(cacheKey, empresaId);
  const storageKey = chaveDeArmazenamento(cacheKey);
  const atuais = dono ? (await getEntityCacheItems(storageKey, dono)) || [] : [];
  const proximos = typeof updater === 'function' ? updater(atuais) : updater;
  if (dono) await setEntityCacheItems(storageKey, dono, proximos || []);
  return comOQueEsperaEnvio(cacheKey, proximos || [], empresaId);
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
  refreshForcados.clear();
  lastRefreshAt.clear();
  rateLimitedUntil.clear();
};

/**
 * Logout (D-PROD-137, GET-06): apaga do aparelho o cache do tenant que sai e o
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
