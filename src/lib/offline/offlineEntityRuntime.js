/**
 * Runtime offline de entidade — provider-agnostic (P1.4).
 *
 * O antecessor, `src/lib/offlineEntitySync.js`, recebia o cliente inteiro,
 * indexava `base44Client.entities[entityName]` com nome vindo de uma lista e
 * substituía `list`/`filter`/`create`/`update`/`delete` in place. Duas coisas
 * eram falsas nesse desenho: o runtime **não precisa** conhecer provider nenhum,
 * e o acesso por nome era exatamente a porta dinâmica que `gate:api-boundary`
 * existe para fechar.
 *
 * Aqui o runtime recebe **operações já resolvidas** e devolve operações novas.
 * Conhece IndexedDB, fila, cache, ids offline, replay, mapeamento de ids,
 * eventos e `navigator.onLine`. Não conhece Base44, `client`, `client.entities`,
 * `endpointOf` nem o provider público.
 *
 * O catálogo de entidades offline é montado pelo provider, literalmente, uma
 * chamada por entidade. Uma entrada de fila cujo nome não esteja no catálogo
 * **falha explicitamente** com `OFFLINE_ENTITY_UNSUPPORTED` e permanece na fila:
 * o antecessor fazia `continue` e o item ficava preso para sempre, invisível.
 */

import {
  getItem,
  putItem,
  getAllItems,
  addItem,
  deleteItem,
  STORES_NAMES,
} from "@/components/offline/IndexedDBManager";
import { ApiError, API_ERROR_CODES } from "@/apis/_core/ApiError";

const GLOBAL_EMPRESA_KEY = "__GLOBAL__";
const OFFLINE_SYNC_EVENT = "offline-entity-queue-updated";

export const getOfflineSyncEventName = () => OFFLINE_SYNC_EVENT;

const getEmpresaId = () => {
  try {
    return localStorage.getItem("empresa_selecionada_id") || GLOBAL_EMPRESA_KEY;
  } catch {
    return GLOBAL_EMPRESA_KEY;
  }
};

const chaveEmpresa = (empresaId) => empresaId || GLOBAL_EMPRESA_KEY;
const getCacheKey = (entityName, empresaId) => `${entityName}::${chaveEmpresa(empresaId)}`;
const isOfflineId = (value) => String(value || "").startsWith("offline_");
const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/**
 * Porta de armazenamento. O runtime só fala com esta interface, então o teste
 * injeta uma implementação em memória e exercita replay, fila e cache sem
 * IndexedDB.
 *
 * @typedef {{
 *   lerCache: (chave: string) => Promise<Array<object>>,
 *   gravarCache: (chave: string, registro: object) => Promise<void>,
 *   listarFila: () => Promise<Array<object>>,
 *   adicionarNaFila: (item: object) => Promise<number|string>,
 *   atualizarNaFila: (id: number|string, campos: object) => Promise<void>,
 *   removerDaFila: (id: number|string) => Promise<void>,
 * }} OfflineEntityStorage
 */

/** @returns {OfflineEntityStorage} */
export const criarArmazenamentoIndexedDB = () => ({
  lerCache: async (chave) => {
    const registro = await getItem(STORES_NAMES.ENTITY_CACHE, chave);
    return registro?.items || [];
  },
  gravarCache: async (chave, registro) => {
    await putItem(STORES_NAMES.ENTITY_CACHE, { cache_key: chave, ...registro });
  },
  listarFila: () => getAllItems(STORES_NAMES.ENTITY_QUEUE),
  adicionarNaFila: (item) => addItem(STORES_NAMES.ENTITY_QUEUE, item),
  atualizarNaFila: async (id, campos) => {
    const atual = await getItem(STORES_NAMES.ENTITY_QUEUE, id);
    if (!atual) return;
    await putItem(STORES_NAMES.ENTITY_QUEUE, { ...atual, ...campos, id });
  },
  removerDaFila: (id) => deleteItem(STORES_NAMES.ENTITY_QUEUE, id),
});

/**
 * O ambiente tem armazenamento offline?
 *
 * Sem IndexedDB — jsdom, SSR, navegador em modo restrito — o runtime não pode
 * cumprir a promessa de fila durável. Nesse caso o adapter devolve as operações
 * originais **intactas**, em vez de fingir persistência que não existe.
 */
export const offlineStorageDisponivel = () =>
  typeof indexedDB !== "undefined" && indexedDB !== null;

/** Catálogo literal montado pelo provider: nome → operações online. */
const CATALOGO = new Map();

/** Só para teste: devolve o runtime ao estado inicial. */
export const resetOfflineEntityRuntime = () => {
  CATALOGO.clear();
  listenerInstalado = false;
};

/** Nomes registrados no catálogo offline. */
export const getOfflineEntityNames = () => [...CATALOGO.keys()];

const emitirMudancaDeFila = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OFFLINE_SYNC_EVENT));
};

const ordenar = (items, order) => {
  if (!order || typeof order !== "string") return items;
  const desc = order.startsWith("-");
  const campo = desc ? order.slice(1) : order;
  return [...items].sort((a, b) => {
    const va = a?.[campo];
    const vb = b?.[campo];
    if (va === vb) return 0;
    if (va === undefined || va === null) return desc ? 1 : -1;
    if (vb === undefined || vb === null) return desc ? -1 : 1;
    return va > vb ? (desc ? -1 : 1) : (desc ? 1 : -1);
  });
};

const aplicarPendentes = (items, operacoes) => {
  const proximo = [...items];

  operacoes.forEach((operacao) => {
    if (operacao.operation === "create") {
      proximo.unshift(operacao.data);
      return;
    }
    if (operacao.operation === "update") {
      const i = proximo.findIndex((item) => item.id === operacao.record_id);
      if (i >= 0) proximo[i] = { ...proximo[i], ...operacao.data };
      return;
    }
    if (operacao.operation === "delete") {
      const i = proximo.findIndex((item) => item.id === operacao.record_id);
      if (i >= 0) proximo.splice(i, 1);
    }
  });

  return proximo;
};

const substituirIdsMapeados = (valor, mapaDeIds) => {
  if (Array.isArray(valor)) return valor.map((item) => substituirIdsMapeados(item, mapaDeIds));

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, entrada]) => {
        if (typeof entrada === "string" && mapaDeIds[entrada]) return [chave, mapaDeIds[entrada]];
        return [chave, substituirIdsMapeados(entrada, mapaDeIds)];
      })
    );
  }

  return valor;
};

const armazenamentoDe = (entityName) => {
  const entrada = CATALOGO.get(entityName);
  if (!entrada) {
    throw new ApiError(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED, {
      operation: "syncOfflineEntityQueue",
      resource: "OfflineEntityQueue",
      details: { entidade: entityName },
    });
  }
  return entrada;
};

const lerCacheDe = (storage, entityName, empresaId) =>
  storage.lerCache(getCacheKey(entityName, empresaId));

const gravarCacheDe = (storage, entityName, empresaId, items) =>
  storage.gravarCache(getCacheKey(entityName, empresaId), {
    entity_name: entityName,
    empresa_id: chaveEmpresa(empresaId),
    items,
    updated_at: new Date().toISOString(),
  });

const atualizarCache = async (storage, entityName, empresaId, transformar) => {
  const atuais = await lerCacheDe(storage, entityName, empresaId);
  const proximos = transformar([...atuais]);
  await gravarCacheDe(storage, entityName, empresaId, proximos);
  return proximos;
};

/**
 * @param {object} storage
 * @param {string} entityName
 * @param {{order?: string, limit?: number, filters?: Record<string, any>, empresaId?: string}} [opcoes]
 */
const listarLocal = async (storage, entityName, { order, limit, filters = {}, empresaId } = {}) => {
  const [emCache, fila] = await Promise.all([
    lerCacheDe(storage, entityName, empresaId),
    storage.listarFila(),
  ]);

  const daEntidade = fila.filter(
    (item) => item.entity_name === entityName && chaveEmpresa(item.empresa_id) === chaveEmpresa(empresaId)
  );

  let items = aplicarPendentes(emCache, daEntidade);

  if (Object.keys(filters).length > 0) {
    items = items.filter((item) => Object.entries(filters).every(([k, v]) => item?.[k] === v));
  }

  const ordenados = ordenar(items, order);
  return typeof limit === "number" ? ordenados.slice(0, limit) : ordenados;
};

const enfileirar = async (storage, payload) => {
  const id = await storage.adicionarNaFila({ ...payload, created_at: new Date().toISOString() });
  emitirMudancaDeFila();
  return id;
};

/**
 * Cria as operações offline de **uma** entidade.
 *
 * @param {object} p
 * @param {string} p.entityName nome literal, só como rótulo — nada é resolvido por ele
 * @param {{list?: Function, filter?: Function, create?: Function, update?: Function, delete?: Function}} p.operations
 *        operações online já resolvidas pelo chamador
 * @param {boolean} [p.enabled] quando falso, devolve `operations` sem alteração
 * @param {OfflineEntityStorage} [p.storage]
 * @returns {object} objeto com as mesmas chaves de `operations`
 */
export const createOfflineEntityAdapter = ({ entityName, operations, enabled = true, storage }) => {
  if (typeof entityName !== "string" || !entityName) {
    throw new Error("offline: entityName precisa ser uma string literal não vazia");
  }
  if (!operations || typeof operations !== "object") {
    throw new Error(`offline: operações inválidas para "${entityName}"`);
  }
  if (!enabled) return operations;

  const porta = storage || criarArmazenamentoIndexedDB();
  CATALOGO.set(entityName, { operations, storage: porta });

  const adapter = { ...operations };

  if (typeof operations.list === "function") {
    adapter.list = async (order, limit) => {
      const empresaId = getEmpresaId();
      if (!estaOnline()) return listarLocal(porta, entityName, { order, limit, empresaId });

      const resultado = await operations.list(order, limit);
      await gravarCacheDe(porta, entityName, empresaId, Array.isArray(resultado) ? resultado : []);
      return listarLocal(porta, entityName, { order, limit, empresaId });
    };
  }

  if (typeof operations.filter === "function") {
    adapter.filter = async (filters = {}, order, limit) => {
      const empresaId = getEmpresaId();
      if (estaOnline() && typeof operations.list === "function") {
        const resultado = await operations.list(order);
        await gravarCacheDe(porta, entityName, empresaId, Array.isArray(resultado) ? resultado : []);
      }
      return listarLocal(porta, entityName, { filters, order, limit, empresaId });
    };
  }

  if (typeof operations.create === "function") {
    adapter.create = async (dados) => {
      const empresaId = dados?.empresa_id || getEmpresaId();

      if (estaOnline()) {
        const criado = await operations.create(dados);
        await atualizarCache(porta, entityName, empresaId, (items) => [
          criado,
          ...items.filter((item) => item.id !== criado.id),
        ]);
        return criado;
      }

      const registro = {
        ...dados,
        id: `offline_${entityName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        empresa_id: empresaId,
        created_date: new Date().toISOString(),
        updated_date: new Date().toISOString(),
        _isOffline: true,
      };

      await atualizarCache(porta, entityName, empresaId, (items) => [
        registro,
        ...items.filter((item) => item.id !== registro.id),
      ]);
      await enfileirar(porta, {
        entity_name: entityName,
        empresa_id: empresaId,
        operation: "create",
        record_id: registro.id,
        data: registro,
      });
      return registro;
    };
  }

  if (typeof operations.update === "function") {
    adapter.update = async (recordId, dados) => {
      const empresaId = dados?.empresa_id || getEmpresaId();

      if (estaOnline()) {
        const atualizado = await operations.update(recordId, dados);
        await atualizarCache(porta, entityName, empresaId, (items) =>
          items.map((item) => (item.id === atualizado.id ? { ...item, ...atualizado } : item))
        );
        return atualizado;
      }

      const proximos = await atualizarCache(porta, entityName, empresaId, (items) => {
        const existente = items.find((item) => item.id === recordId) || { id: recordId, empresa_id: empresaId };
        const atualizado = {
          ...existente,
          ...dados,
          id: recordId,
          updated_date: new Date().toISOString(),
          _isOffline: true,
        };
        return [atualizado, ...items.filter((item) => item.id !== recordId)];
      });

      const registro = proximos.find((item) => item.id === recordId);
      const fila = await porta.listarFila();
      const mesmaEmpresa = (item) => chaveEmpresa(item.empresa_id) === chaveEmpresa(empresaId);

      if (isOfflineId(recordId)) {
        const criacaoPendente = fila.find(
          (item) =>
            item.entity_name === entityName &&
            item.operation === "create" &&
            item.data?.id === recordId &&
            mesmaEmpresa(item)
        );
        if (criacaoPendente) {
          await porta.atualizarNaFila(criacaoPendente.id, { data: registro });
          emitirMudancaDeFila();
          return registro;
        }
      }

      const atualizacaoPendente = fila.find(
        (item) =>
          item.entity_name === entityName &&
          item.operation === "update" &&
          item.record_id === recordId &&
          mesmaEmpresa(item)
      );

      if (atualizacaoPendente) {
        await porta.atualizarNaFila(atualizacaoPendente.id, {
          data: { ...atualizacaoPendente.data, ...dados },
        });
        emitirMudancaDeFila();
      } else {
        await enfileirar(porta, {
          entity_name: entityName,
          empresa_id: empresaId,
          operation: "update",
          record_id: recordId,
          data: dados,
        });
      }

      return registro;
    };
  }

  if (typeof operations.delete === "function") {
    adapter.delete = async (recordId) => {
      const empresaId = getEmpresaId();

      if (estaOnline()) {
        await operations.delete(recordId);
        await atualizarCache(porta, entityName, empresaId, (items) =>
          items.filter((item) => item.id !== recordId)
        );
        return;
      }

      await atualizarCache(porta, entityName, empresaId, (items) =>
        items.filter((item) => item.id !== recordId)
      );

      const fila = await porta.listarFila();
      const criacaoPendente = fila.find(
        (item) =>
          item.entity_name === entityName &&
          item.operation === "create" &&
          item.data?.id === recordId &&
          chaveEmpresa(item.empresa_id) === chaveEmpresa(empresaId)
      );

      if (criacaoPendente) {
        // Criação que nunca chegou ao servidor: some da fila em vez de virar
        // um delete de id que o servidor não conhece.
        await porta.removerDaFila(criacaoPendente.id);
        emitirMudancaDeFila();
        return;
      }

      await enfileirar(porta, {
        entity_name: entityName,
        empresa_id: empresaId,
        operation: "delete",
        record_id: recordId,
        data: { id: recordId },
      });
    };
  }

  return adapter;
};

/**
 * Replay da fila, em ordem de chegada.
 *
 * Falha **preserva a fila**: o item que falhou continua lá, e o replay para no
 * primeiro erro para não aplicar operações fora de ordem.
 *
 * @param {(p: {current: number, total: number, item: object}) => void} [onProgress]
 * @returns {Promise<{success: boolean, code?: string, error?: unknown, pendentes?: number}>}
 */
export const syncOfflineEntityQueue = async (onProgress) => {
  if (!estaOnline()) return { success: false, code: "OFFLINE" };
  if (CATALOGO.size === 0) return { success: true, pendentes: 0 };

  const qualquerPorta = [...CATALOGO.values()][0].storage;
  const fila = await qualquerPorta.listarFila();
  const emOrdem = [...fila].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const mapaDeIds = {};

  for (let i = 0; i < emOrdem.length; i += 1) {
    const item = emOrdem[i];
    onProgress?.({ current: i + 1, total: emOrdem.length, item });

    let entrada;
    try {
      entrada = armazenamentoDe(item.entity_name);
    } catch (erro) {
      // Entidade fora do catálogo: erro explícito, item intacto na fila.
      return {
        success: false,
        code: API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED,
        error: erro,
        pendentes: emOrdem.length - i,
      };
    }

    const { operations, storage } = entrada;

    try {
      if (item.operation === "create") {
        const { id: _idOffline, _isOffline, ...bruto } = item.data || {};
        const criado = await operations.create(substituirIdsMapeados(bruto, mapaDeIds));
        mapaDeIds[item.record_id] = criado.id;
        await atualizarCache(storage, item.entity_name, item.empresa_id, (items) =>
          items.map((entry) => (entry.id === item.record_id ? criado : entry))
        );
      }

      if (item.operation === "update") {
        const alvo = mapaDeIds[item.record_id] || item.record_id;
        if (!isOfflineId(alvo)) {
          const atualizado = await operations.update(alvo, substituirIdsMapeados(item.data || {}, mapaDeIds));
          await atualizarCache(storage, item.entity_name, item.empresa_id, (items) =>
            items.map((entry) => (entry.id === alvo ? { ...entry, ...atualizado } : entry))
          );
        }
      }

      if (item.operation === "delete") {
        const alvo = mapaDeIds[item.record_id] || item.record_id;
        if (!isOfflineId(alvo)) await operations.delete(alvo);
        await atualizarCache(storage, item.entity_name, item.empresa_id, (items) =>
          items.filter((entry) => entry.id !== item.record_id && entry.id !== alvo)
        );
      }

      await storage.removerDaFila(item.id);
      emitirMudancaDeFila();
    } catch (error) {
      return { success: false, error, pendentes: emOrdem.length - i };
    }
  }

  return { success: true, pendentes: 0 };
};

let listenerInstalado = false;

/**
 * Instala o disparo de replay ao voltar online. **Um** listener por sessão: a
 * versão anterior guardava o flag no objeto do cliente, então um cliente novo
 * instalava outro listener.
 */
export const instalarSincronizacaoAoVoltarOnline = () => {
  if (listenerInstalado || typeof window === "undefined") return;
  listenerInstalado = true;
  window.addEventListener("online", () => {
    window.setTimeout(() => {
      syncOfflineEntityQueue();
    }, 1000);
  });
};
