/**
 * Runtime offline de entidade — provider-agnostic (P1.4).
 *
 * O antecessor, `src/lib/offlineEntitySync.js`, recebia o cliente inteiro,
 * indexava `client.entities[entityName]` do SDK legado com nome vindo de uma lista e
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
import { getOfflineTenant } from "@/lib/offline/offlineTenant";

const GLOBAL_EMPRESA_KEY = "__GLOBAL__";
/** Sessão nativa ausente. Valor legítimo: entidade da Base44 não tem tenant do MAIKE. */
const SEM_TENANT_KEY = "__SEM_TENANT__";
/** Marca a parte da chave que é tenant, para não confundir com nome de entidade. */
const TENANT_PREFIXO = "cli:";
const OFFLINE_SYNC_EVENT = "offline-entity-queue-updated";
/** Operações que a fila grava (as únicas que o replay sabe aplicar). */
const OPERACOES_DA_FILA = Object.freeze(["create", "update", "delete"]);

export const getOfflineSyncEventName = () => OFFLINE_SYNC_EVENT;

const getEmpresaId = () => {
  try {
    return localStorage.getItem("empresa_selecionada_id") || GLOBAL_EMPRESA_KEY;
  } catch {
    return GLOBAL_EMPRESA_KEY;
  }
};

/**
 * Catálogo do tenant (Empresa, Categoria de produto, etc.) não depende da
 * empresa selecionada no menu — usar sempre a chave global evita listas
 * divergentes ao trocar de fazenda.
 */
const empresaIdParaEntidade = (tenantCatalog, dados) => {
  if (tenantCatalog) return GLOBAL_EMPRESA_KEY;
  return dados?.empresa_id || getEmpresaId();
};

const chaveEmpresa = (empresaId) => empresaId || GLOBAL_EMPRESA_KEY;

/**
 * Chave do cache (P4.1-R1).
 *
 * Entidade tenant-scoped leva o `cliente_id` na chave; entidade que ainda vive
 * na Base44 continua com a chave de antes, byte a byte — o cache dela segue
 * válido depois do deploy, e mudar a chave só a faria recarregar sem motivo.
 *
 * O tenant vem primeiro por legibilidade ao inspecionar o IndexedDB, e porque
 * `entityName` e `empresa_id` já ocupavam as pontas.
 */
const getCacheKey = (entityName, empresaId, tenantId) =>
  tenantId === undefined
    ? `${entityName}::${chaveEmpresa(empresaId)}`
    : `${entityName}::${TENANT_PREFIXO}${tenantId || SEM_TENANT_KEY}::${chaveEmpresa(empresaId)}`;
const isOfflineId = (value) => String(value || "").startsWith("offline_");

/**
 * Ids offline (`offline_…`) citados num corpo, em qualquer profundidade.
 * @param {unknown} valor
 * @param {Set<string>} [acc]
 * @returns {Set<string>}
 */
const idsOfflineNoCorpo = (valor, acc = new Set()) => {
  if (typeof valor === "string") {
    if (isOfflineId(valor)) acc.add(valor);
  } else if (Array.isArray(valor)) {
    for (const v of valor) idsOfflineNoCorpo(v, acc);
  } else if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) idsOfflineNoCorpo(v, acc);
  }
  return acc;
};
const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/**
 * Porta de armazenamento. O runtime só fala com esta interface, então o teste
 * injeta uma implementação em memória e exercita replay, fila e cache sem
 * IndexedDB.
 *
 * @typedef {{
 *   lerCache: (chave: string) => Promise<Array<object>>,
 *   gravarCache: (chave: string, registro: object) => Promise<void>,
 *   removerCache: (chave: string) => Promise<void>,
 *   listarCaches?: () => Promise<Array<{cache_key: string, entity_name?: string, cliente_id?: string|null, items?: Array<object>}>>,
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
  removerCache: (chave) => deleteItem(STORES_NAMES.ENTITY_CACHE, chave),
  listarCaches: () => getAllItems(STORES_NAMES.ENTITY_CACHE),
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
  legadoDescartado.clear();
  listenerInstalado = false;
};

/** Nomes registrados no catálogo offline. */
export const getOfflineEntityNames = () => [...CATALOGO.keys()];

/**
 * D-PROD-290 — "Baixar dados para usar sem internet": lê do servidor TODAS as
 * entidades registradas que sabem listar, pelo próprio adaptador (que guarda o
 * resultado no cache do aparelho, por empresa/tenant, como qualquer leitura).
 * Uma falha isolada não para as demais. Sem internet não faz nada.
 *
 * @param {(p: {feitas: number, total: number, entidade: string}) => void} [aoAvancar]
 * @returns {Promise<{total: number, ok: number, falhas: string[]}>}
 */
export const baixarEntidadesParaOffline = async (aoAvancar) => {
  const alvos = [...CATALOGO.entries()].filter(([, e]) => typeof e.adapter?.list === "function");
  const falhas = [];
  if (!estaOnline()) return { total: alvos.length, ok: 0, falhas: alvos.map(([nome]) => nome) };
  let feitas = 0;
  const fila = [...alvos];
  // 6 por vez: baixar uma entidade de cada vez deixava o preparo lento.
  const trabalhar = async () => {
    while (fila.length) {
      const [nome, entrada] = /** @type {[string, any]} */ (fila.shift());
      try {
        await entrada.adapter.list();
      } catch {
        falhas.push(nome);
      }
      feitas += 1;
      aoAvancar?.({ feitas, total: alvos.length, entidade: nome });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, alvos.length) }, trabalhar));
  return { total: alvos.length, ok: alvos.length - falhas.length, falhas };
};

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

/**
 * Troca, em qualquer profundidade, cada id offline mapeado pelo id do servidor.
 *
 * D-PROD-204: só id offline (`offline_…`) é trocado, e só por chave própria do
 * mapa — antes, um texto como "constructor" casava com o protótipo do objeto e
 * o campo virava função. Id offline dentro de lista (ex.: `["offline_…"]`)
 * também é trocado; antes ficava com o id offline.
 */
const substituirIdsMapeados = (valor, mapaDeIds) => {
  if (typeof valor === "string") {
    return isOfflineId(valor) && Object.prototype.hasOwnProperty.call(mapaDeIds, valor) ? mapaDeIds[valor] : valor;
  }
  if (Array.isArray(valor)) return valor.map((item) => substituirIdsMapeados(item, mapaDeIds));

  if (valor && typeof valor === "object") {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, entrada]) => [chave, substituirIdsMapeados(entrada, mapaDeIds)])
    );
  }

  return valor;
};

/**
 * D-PROD-204 — grava na FILA o id que o servidor deu a uma criação offline.
 *
 * O mapa `offline_… → id do servidor` do replay vive só durante uma passada.
 * Se a passada criava A (o item saía da fila) e parava antes de enviar B, que
 * cita A (falha transitória em B ou em qualquer item entre os dois), a passada
 * seguinte começava com o mapa vazio e B ia ao servidor com o id offline de A:
 * com FK a fila travava; sem FK a referência ficava solta.
 *
 * Agora, logo depois do `create` confirmado e ANTES de tirá-lo da fila, todo
 * outro item da fila que cita o id offline é reescrito: `record_id` (edição ou
 * exclusão do próprio registro) e qualquer valor em `data`. A fila é relida do
 * armazenamento (pega também o que entrou durante a passada e os itens retidos
 * ou de outro dono, que esta passada não envia). Uma falha aqui propaga: o
 * `create` fica na fila, como em qualquer erro do replay — nunca sai da fila
 * deixando dependente com id offline sem mapeamento.
 *
 * @param {OfflineEntityStorage} storage
 * @param {object} itemCriado entrada `create` que acabou de ser confirmada
 * @param {string} idServidor
 */
const gravarIdDoServidorNaFila = async (storage, itemCriado, idServidor) => {
  const idOffline = itemCriado.record_id;
  if (!isOfflineId(idOffline) || !idServidor || idServidor === idOffline) return;
  const mapa = { [idOffline]: idServidor };
  const fila = await storage.listarFila();
  let mudou = false;
  for (const outro of fila) {
    if (outro.id === itemCriado.id) continue;
    const campos = {};
    if (outro.record_id === idOffline) campos.record_id = idServidor;
    if (outro.data !== undefined && idsOfflineNoCorpo(outro.data).has(idOffline)) {
      campos.data = substituirIdsMapeados(outro.data, mapa);
    }
    if (Object.keys(campos).length === 0) continue;
    await storage.atualizarNaFila(outro.id, campos);
    mudou = true;
  }
  if (mudou) emitirMudancaDeFila();
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

/**
 * Tenant de uma entidade, ou `undefined` quando ela não é tenant-scoped.
 *
 * `undefined` e `null` significam coisas diferentes aqui, e a distinção é o que
 * mantém a Base44 intacta: `undefined` é "esta entidade não tem tenant" e leva à
 * chave antiga; `null` é "tem tenant, mas não há sessão" e leva à chave com o
 * sentinela `__SEM_TENANT__`.
 */
const tenantDe = (tenantScoped) => (tenantScoped ? getOfflineTenant() : undefined);

/**
 * Carimbo de dono numa entrada de fila.
 *
 * Entidade não tenant-scoped **não** ganha o campo — a ausência é o que
 * distingue "não tem dono por desenho" de "tem dono e ele é nulo", e é essa
 * distinção que o replay usa para não recusar as entidades da Base44.
 */
const carimboDeTenant = (tenantScoped, tenantId) =>
  tenantScoped ? { cliente_id: tenantId ?? null } : {};

/**
 * Chaves de cache no formato **anterior** ao tenant já descartadas nesta sessão.
 *
 * Uma entidade que virou tenant-scoped deixa para trás a linha
 * `Entidade::empresa`, que nenhuma chave nova alcança. Ela é inalcançável, não
 * perigosa — mas guarda dado da era Base44 em repouso, e o corte não estaria
 * completo com ele lá. O descarte acontece na primeira gravação de cada
 * entidade+empresa; o `Set` evita repetir a remoção a cada listagem.
 */
const legadoDescartado = new Set();

const descartarCacheLegado = async (storage, entityName, empresaId) => {
  const chave = getCacheKey(entityName, empresaId);
  if (legadoDescartado.has(chave)) return;
  legadoDescartado.add(chave);
  try {
    await storage.removerCache?.(chave);
  } catch {
    // Cache é conveniência: falhar em limpar o legado não pode derrubar uma
    // listagem que já deu certo.
  }
};

const lerCacheDe = (storage, entityName, empresaId, tenantId) =>
  storage.lerCache(getCacheKey(entityName, empresaId, tenantId));

const gravarCacheDe = async (storage, entityName, empresaId, items, tenantId) => {
  if (tenantId !== undefined) await descartarCacheLegado(storage, entityName, empresaId);
  return storage.gravarCache(getCacheKey(entityName, empresaId, tenantId), {
    entity_name: entityName,
    empresa_id: chaveEmpresa(empresaId),
    ...(tenantId === undefined ? {} : { cliente_id: tenantId }),
    items,
    updated_at: new Date().toISOString(),
  });
};

const atualizarCache = async (storage, entityName, empresaId, transformar, tenantId) => {
  const atuais = await lerCacheDe(storage, entityName, empresaId, tenantId);
  const proximos = transformar([...atuais]);
  await gravarCacheDe(storage, entityName, empresaId, proximos, tenantId);
  return proximos;
};

/**
 * @param {object} storage
 * @param {string} entityName
 * @param {{order?: string, limit?: number, filters?: Record<string, any>, empresaId?: string,
 *          tenantId?: string|null}} [opcoes]
 */
const listarLocal = async (storage, entityName, { order, limit, filters = {}, empresaId, tenantId } = {}) => {
  const [emCache, fila] = await Promise.all([
    lerCacheDe(storage, entityName, empresaId, tenantId),
    storage.listarFila(),
  ]);

  // A fila é global, e desde a P4.1-R1 uma entrada tenant-scoped só conta para o
  // dono dela: sem isso, a tela do cliente B mostraria a criação pendente do
  // cliente A como se fosse dele.
  // Entidade com exclusão só online: um `delete` na fila (legado) está RETIDO
  // e não esconde o registro — ele não foi excluído no servidor.
  const exclusaoRetida = CATALOGO.get(entityName)?.exclusaoSomenteOnline === true;
  // D-PROD-195 R2: entidade com criação só online — um `create` na fila (legado)
  // nunca chega ao servidor: nem ele nem a cópia `offline_…` que a versão antiga
  // gravou no cache aparecem como registro real (senão seriam escolhidos em
  // outro cadastro, editados ou excluídos com id offline). Decide pela POLÍTICA,
  // não pela marca do replay, como a exclusão retida.
  const criacaoRetida = CATALOGO.get(entityName)?.criacaoSomenteOnline === true;
  const daEntidade = fila.filter(
    (item) =>
      item.entity_name === entityName &&
      chaveEmpresa(item.empresa_id) === chaveEmpresa(empresaId) &&
      (tenantId === undefined || (item.cliente_id ?? null) === tenantId) &&
      !(exclusaoRetida && item.operation === "delete") &&
      !(criacaoRetida && item.operation === "create")
  );
  const base = criacaoRetida ? emCache.filter((registro) => !isOfflineId(registro?.id)) : emCache;

  let items = aplicarPendentes(base, daEntidade);

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
 * Retira um registro de TODOS os caches da entidade que pertencem ao tenant da
 * sessão (MAIKE-LOTES-PR167-R1). Uso: depois de uma exclusão CONFIRMADA pelo
 * servidor (resposta definitiva), feita fora da fila — o cache não pode
 * devolver o registro quando o aparelho ficar offline.
 *
 * Uma entidade como Lote é guardada uma vez por fazenda selecionada (a chave
 * leva a empresa), e cada cópia pode conter o registro: todas são varridas.
 * Cache de outro tenant nunca é tocado. Nada vai para a fila.
 *
 * @param {string} entityName
 * @param {string} recordId
 * @returns {Promise<number>} quantas entradas de cache mudaram
 */
export const removerRegistroDosCachesOffline = async (entityName, recordId) => {
  const entrada = CATALOGO.get(entityName);
  if (!entrada || !recordId) return 0;
  const { storage, tenantScoped, tenantCatalog } = entrada;
  const tenantId = tenantDe(tenantScoped);
  const tira = (items) => (Array.isArray(items) ? items : []).filter((item) => item?.id !== recordId);

  if (typeof storage.listarCaches !== "function") {
    // Porta sem varredura: ao menos a chave da fazenda atual.
    const empresaId = empresaIdParaEntidade(tenantCatalog);
    const atuais = await lerCacheDe(storage, entityName, empresaId, tenantId);
    if (!atuais.some((item) => item?.id === recordId)) return 0;
    await gravarCacheDe(storage, entityName, empresaId, tira(atuais), tenantId);
    return 1;
  }

  let alterados = 0;
  for (const registro of await storage.listarCaches()) {
    if (registro?.entity_name !== entityName) continue;
    if (tenantScoped && (registro.cliente_id ?? null) !== (tenantId ?? null)) continue;
    const items = Array.isArray(registro.items) ? registro.items : [];
    if (!items.some((item) => item?.id === recordId)) continue;
    const { cache_key: chave, ...resto } = registro;
    await storage.gravarCache(chave, { ...resto, items: tira(items), updated_at: new Date().toISOString() });
    alterados += 1;
  }
  return alterados;
};

/**
 * Há operação na fila offline (do tenant da sessão) para este registro?
 * Exclusão definitiva não pode passar por cima dela em silêncio.
 * @param {string} entityName
 * @param {string} recordId
 */
export const temPendenciaOfflineDoRegistro = async (entityName, recordId) =>
  (await pendenciasOfflineDoRegistro(entityName, recordId)).length > 0;

/**
 * Operações na fila (do tenant da sessão) para este registro, ex. ['update'].
 * @param {string} entityName
 * @param {string} recordId
 * @returns {Promise<string[]>}
 */
export const pendenciasOfflineDoRegistro = async (entityName, recordId) => {
  const entrada = CATALOGO.get(entityName);
  if (!entrada || !recordId) return [];
  const tenantId = tenantDe(entrada.tenantScoped);
  const fila = await entrada.storage.listarFila();
  return fila
    .filter(
      (item) =>
        item.entity_name === entityName &&
        (item.record_id === recordId || item.data?.id === recordId) &&
        (!entrada.tenantScoped || (item.cliente_id ?? null) === (tenantId ?? null))
    )
    .map((item) => item.operation);
};

/**
 * Liberação MANUAL de um `delete` retido (PR167-R2): tira da fila SÓ esse item,
 * se ele for exclusão de entidade "somente_online" do tenant da sessão. Não
 * chama o servidor nem mexe em cache: o registro continua existindo; para
 * excluí-lo de fato, use a exclusão online (elegibilidade + confirmação).
 * @param {number|string} filaId
 * @returns {Promise<boolean>} true se removeu
 */
export const liberarExclusaoOfflineRetida = async (filaId) => {
  if (CATALOGO.size === 0) return false;
  const porta = [...CATALOGO.values()][0].storage;
  const item = (await porta.listarFila()).find((f) => f.id === filaId);
  const entrada = item ? CATALOGO.get(item.entity_name) : null;
  if (!item || !entrada?.exclusaoSomenteOnline || item.operation !== "delete") return false;
  if (entrada.tenantScoped && (item.cliente_id ?? null) !== (tenantDe(true) ?? null)) return false;
  await entrada.storage.removerDaFila(item.id);
  emitirMudancaDeFila();
  return true;
};

/**
 * Cria as operações offline de **uma** entidade.
 *
 * @param {object} p
 * @param {string} p.entityName nome literal, só como rótulo — nada é resolvido por ele
 * @param {{list?: Function, filter?: Function, create?: Function, update?: Function, delete?: Function}} p.operations
 *        operações online já resolvidas pelo chamador
 * @param {boolean} [p.enabled] quando falso, devolve `operations` sem alteração
 * @param {boolean} [p.tenantScoped] a entidade é do backend nativo, e cache, fila
 *        e replay pertencem ao `cliente_id` da sessão (P4.1-R1). Entidade que
 *        ainda vive na Base44 deixa isto falso: lá o replay usa a credencial da
 *        Base44, que não é tenant do MAIKE, e carimbar um tenant que não governa
 *        nada só inventaria dono.
 * @param {boolean} [p.tenantCatalog] catálogo global do tenant (não filtrado pela
 *        empresa selecionada): cache e fila usam `__GLOBAL__` em vez do id da
 *        fazenda ativa.
 * @param {"fila"|"somente_online"} [p.exclusao] política de exclusão (PR167-R2). "fila"
 *        (padrão, comportamento de sempre): offline tira do cache e enfileira.
 *        "somente_online": a exclusão NUNCA passa pela fila nem é otimista — vai
 *        direto a `operations.delete` (que recusa sem conexão) e só depois de
 *        sucesso tira o registro dos caches do tenant; delete legado na fila
 *        fica retido (quarentena) no replay em vez de ser enviado.
 * @param {"fila"|"somente_online"} [p.criacao] política de criação (D-PROD-195 R2).
 *        "fila" (padrão): offline cria com id `offline_` e enfileira.
 *        "somente_online": a criação NUNCA passa pela fila — vai direto a
 *        `operations.create` (que falha sem conexão) e, com sucesso, entra no
 *        cache; `create` legado na fila fica RETIDO no replay e some das listas;
 *        um `create` que o cite fica retido junto (em qualquer ordem), e a
 *        edição de um registro real que o cite vai sem esses campos.
 * @param {OfflineEntityStorage} [p.storage]
 * @returns {object} objeto com as mesmas chaves de `operations`
 */
export const createOfflineEntityAdapter = ({
  entityName,
  operations,
  enabled = true,
  tenantScoped = false,
  tenantCatalog = false,
  exclusao = "fila",
  criacao = "fila",
  storage,
}) => {
  if (typeof entityName !== "string" || !entityName) {
    throw new Error("offline: entityName precisa ser uma string literal não vazia");
  }
  if (!operations || typeof operations !== "object") {
    throw new Error(`offline: operações inválidas para "${entityName}"`);
  }
  if (!enabled) return operations;

  const porta = storage || criarArmazenamentoIndexedDB();
  const catalogoTenant = Boolean(tenantCatalog);
  const exclusaoSomenteOnline = exclusao === "somente_online";
  const criacaoSomenteOnline = criacao === "somente_online";
  CATALOGO.set(entityName, {
    operations,
    storage: porta,
    tenantScoped: Boolean(tenantScoped),
    tenantCatalog: catalogoTenant,
    exclusaoSomenteOnline,
    criacaoSomenteOnline,
  });

  const adapter = { ...operations };

  if (typeof operations.list === "function") {
    adapter.list = async (order, limit) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant);
      const tenantId = tenantDe(tenantScoped);
      if (!estaOnline()) return listarLocal(porta, entityName, { order, limit, empresaId, tenantId });

      const resultado = await operations.list(order, limit);
      await gravarCacheDe(porta, entityName, empresaId, Array.isArray(resultado) ? resultado : [], tenantId);
      return listarLocal(porta, entityName, { order, limit, empresaId, tenantId });
    };
  }

  if (typeof operations.filter === "function") {
    adapter.filter = async (filters = {}, order, limit) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant);
      const tenantId = tenantDe(tenantScoped);
      if (estaOnline() && typeof operations.list === "function") {
        const resultado = await operations.list(order);
        await gravarCacheDe(porta, entityName, empresaId, Array.isArray(resultado) ? resultado : [], tenantId);
      }
      return listarLocal(porta, entityName, { filters, order, limit, empresaId, tenantId });
    };
  }

  if (typeof operations.create === "function" && criacaoSomenteOnline) {
    // Sem fila e sem id offline: falha (offline, timeout, 4xx, 5xx) propaga;
    // só o registro confirmado pelo servidor entra no cache.
    adapter.create = async (dados) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant, dados);
      const tenantId = tenantDe(tenantScoped);
      const criado = await operations.create(dados);
      try {
        await atualizarCache(
          porta,
          entityName,
          empresaId,
          (items) => [criado, ...items.filter((item) => item.id !== criado.id)],
          tenantId
        );
      } catch {
        // Cache é conveniência: a criação já foi confirmada pelo servidor.
      }
      return criado;
    };
  } else if (typeof operations.create === "function") {
    adapter.create = async (dados) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant, dados);
      const tenantId = tenantDe(tenantScoped);

      if (estaOnline()) {
        const criado = await operations.create(dados);
        await atualizarCache(
          porta,
          entityName,
          empresaId,
          (items) => [criado, ...items.filter((item) => item.id !== criado.id)],
          tenantId
        );
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

      await atualizarCache(
        porta,
        entityName,
        empresaId,
        (items) => [registro, ...items.filter((item) => item.id !== registro.id)],
        tenantId
      );
      await enfileirar(porta, {
        entity_name: entityName,
        empresa_id: empresaId,
        ...carimboDeTenant(tenantScoped, tenantId),
        operation: "create",
        record_id: registro.id,
        data: registro,
      });
      return registro;
    };
  }

  if (typeof operations.update === "function") {
    adapter.update = async (recordId, dados) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant, dados);
      const tenantId = tenantDe(tenantScoped);

      if (estaOnline()) {
        const atualizado = await operations.update(recordId, dados);
        await atualizarCache(
          porta,
          entityName,
          empresaId,
          (items) => items.map((item) => (item.id === atualizado.id ? { ...item, ...atualizado } : item)),
          tenantId
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
      }, tenantId);

      const registro = proximos.find((item) => item.id === recordId);
      const fila = await porta.listarFila();
      // Coalescer só pode acontecer dentro do mesmo dono: juntar a edição do
      // cliente B numa criação pendente do cliente A misturaria os dois.
      const mesmaEmpresa = (item) =>
        chaveEmpresa(item.empresa_id) === chaveEmpresa(empresaId) &&
        (tenantId === undefined || (item.cliente_id ?? null) === tenantId);

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
          ...carimboDeTenant(tenantScoped, tenantId),
          operation: "update",
          record_id: recordId,
          data: dados,
        });
      }

      return registro;
    };
  }

  if (typeof operations.delete === "function" && exclusaoSomenteOnline) {
    // Sem fila e sem remoção otimista: falha (offline, timeout, 4xx, 5xx)
    // propaga com cache e fila intactos; só o sucesso definitivo limpa o cache.
    adapter.delete = async (recordId) => {
      await operations.delete(recordId);
      try {
        await removerRegistroDosCachesOffline(entityName, recordId);
      } catch {
        // Cache é conveniência: a exclusão já foi confirmada pelo servidor.
      }
    };
  } else if (typeof operations.delete === "function") {
    adapter.delete = async (recordId) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant);
      const tenantId = tenantDe(tenantScoped);

      if (estaOnline()) {
        await operations.delete(recordId);
        await atualizarCache(
          porta,
          entityName,
          empresaId,
          (items) => items.filter((item) => item.id !== recordId),
          tenantId
        );
        return;
      }

      await atualizarCache(
        porta,
        entityName,
        empresaId,
        (items) => items.filter((item) => item.id !== recordId),
        tenantId
      );

      const fila = await porta.listarFila();
      const criacaoPendente = fila.find(
        (item) =>
          item.entity_name === entityName &&
          item.operation === "create" &&
          item.data?.id === recordId &&
          chaveEmpresa(item.empresa_id) === chaveEmpresa(empresaId) &&
          (tenantId === undefined || (item.cliente_id ?? null) === tenantId)
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
        ...carimboDeTenant(tenantScoped, tenantId),
        operation: "delete",
        record_id: recordId,
        data: { id: recordId },
      });
    };
  }

  const entrada = CATALOGO.get(entityName);
  if (entrada) entrada.adapter = adapter;
  return adapter;
};

/**
 * Uma entrada de fila pode ser aplicada agora? (P4.1-R1)
 *
 * Três respostas, e as três importam:
 *
 *  - `"aplicar"`  — é desta sessão, segue o fluxo normal;
 *  - `"pular"`    — é de **outro** tenant. Fica na fila, intocada, e volta a ser
 *                   elegível quando aquele dono entrar. Nunca é despachada:
 *                   despachar mandaria a escrita de um cliente com o `Bearer` de
 *                   outro, e o backend grava pelo tenant do token (R11);
 *  - `"descartar"` — é **anterior ao corte** para persistência nativa. Não tem
 *                   dono e aponta para id da Base44; nenhum tenant pode
 *                   reivindicá-la sem inventar procedência.
 *
 * O descarte é a única perda de dado deste desenho, e é deliberado. A
 * alternativa que parece mais gentil — tentar aplicar — é o defeito que a
 * P4.1-R1 corrige: `operations.delete` não existe mais em `Setor`, então a
 * entrada legada estourava `TypeError`, o replay retornava no primeiro erro e a
 * fila **inteira**, de todas as entidades, travava para sempre. Atribuir a
 * entrada ao tenant logado seria pior ainda: gravaria dado de origem
 * desconhecida dentro de um cliente real.
 *
 * @param {{tenantScoped: boolean}} entrada
 * @param {{cliente_id?: string|null}} item
 * @param {string|null} tenantAtual
 * @returns {"aplicar"|"pular"|"descartar"}
 */
const destinoDaEntrada = (entrada, item, tenantAtual) => {
  if (!entrada.tenantScoped) return "aplicar";
  if (!("cliente_id" in item)) return "descartar";
  if ((item.cliente_id ?? null) !== tenantAtual) return "pular";
  return "aplicar";
};

/**
 * Replay da fila, em ordem de chegada.
 *
 * Falha **preserva a fila**: o item que falhou continua lá, e o replay para no
 * primeiro erro para não aplicar operações fora de ordem. Entrada de outro dono
 * não é falha — é pulada, e o replay segue.
 *
 * `pendentes` no sucesso conta o que ficou para outro dono — a fila não está
 * vazia, mas nada dela é desta sessão.
 *
 * @param {(p: {current: number, total: number, item: object}) => void} [onProgress]
 * Entidade com exclusão só online: `delete` na fila não é enviado; fica retido
 * (quarentena) e o replay SEGUE com o resto da fila; o retorno avisa com
 * `OFFLINE_DELETE_QUARANTINED` e `quarentenados`.
 *
 * D-PROD-161 (R2, achado LC-3): item cuja operação (`create`/`update`/`delete`)
 * a porta da entidade NÃO tem mais — o `create`/`delete` de MovimentacaoEstoque
 * e de EstoqueLoteNota gravados por uma versão anterior (desde a P0 o saldo só
 * muda pelos comandos do motor) — não é enviado nem apagado por heurística:
 * fica RETIDO na fila (`quarentena.codigo = OFFLINE_ENTITY_UNSUPPORTED`, com a
 * operação) e o replay SEGUE com o resto; o retorno avisa com
 * `OFFLINE_ENTITY_UNSUPPORTED` e `retidos`. Antes, `operations.create`
 * inexistente estourava TypeError e travava a fila inteira, de todas as
 * entidades (o defeito que a P4.1-R1 documentou para o Setor).
 *
 * @returns {Promise<{success: boolean, code?: string, error?: unknown, pendentes?: number,
 *                    pulados?: number, descartados?: number, quarentenados?: number, retidos?: number}>}
 */
export const syncOfflineEntityQueue = async (onProgress) => {
  if (!estaOnline()) return { success: false, code: "OFFLINE" };
  if (CATALOGO.size === 0) return { success: true, pendentes: 0 };

  const qualquerPorta = [...CATALOGO.values()][0].storage;
  const fila = await qualquerPorta.listarFila();
  const emOrdem = [...fila].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  /** Ids desta passada; o que sobrevive entre passadas vai para a fila (D-PROD-204). */
  const mapaDeIds = Object.create(null);
  const tenantAtual = getOfflineTenant();
  let pulados = 0;
  let descartados = 0;
  let quarentenados = 0;
  let retidos = 0;
  /**
   * D-PROD-195 R2: record_id dos `create` que a POLÍTICA retém (entidade com
   * criação só online ou porta sem `create`), conhecidos antes do laço — assim
   * um item que cita um deles é retido mesmo que venha antes na fila. Só esses
   * ids seguram outro item; qualquer outro id offline segue o caminho de sempre.
   */
  const criacoesRetidas = new Set(
    emOrdem
      .filter((item) => {
        if (item.operation !== "create") return false;
        const entrada = CATALOGO.get(item.entity_name);
        return Boolean(entrada) && (entrada.criacaoSomenteOnline || typeof entrada.operations.create !== "function");
      })
      .map((item) => item.record_id)
  );

  /** Marca o item como retido (uma vez) e conta. */
  const reter = async (storage, item, extra = {}) => {
    if (!item.quarentena) {
      await storage.atualizarNaFila(item.id, {
        quarentena: { codigo: API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED, operacao: item.operation, ...extra, em: new Date().toISOString() },
      });
      emitirMudancaDeFila();
    }
    retidos += 1;
  };

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

    const destino = destinoDaEntrada(entrada, item, tenantAtual);

    if (destino === "pular") {
      pulados += 1;
      continue;
    }

    if (destino === "descartar") {
      await storage.removerDaFila(item.id);
      descartados += 1;
      emitirMudancaDeFila();
      continue;
    }

    if (item.operation === "delete" && entrada.exclusaoSomenteOnline) {
      // Delete gravado por versão anterior: NÃO é enviado (a exclusão dessa
      // entidade exige elegibilidade e confirmação online). Fica na fila,
      // marcado, até liberação manual explícita — nada é apagado por heurística.
      if (!item.quarentena) {
        await storage.atualizarNaFila(item.id, {
          quarentena: { codigo: API_ERROR_CODES.OFFLINE_DELETE_QUARANTINED, em: new Date().toISOString() },
        });
        emitirMudancaDeFila();
      }
      quarentenados += 1;
      continue;
    }

    if (OPERACOES_DA_FILA.includes(item.operation) && typeof operations[item.operation] !== "function") {
      // Operação que a porta não tem mais (LC-3): retida, nunca enviada nem apagada; o replay segue.
      await reter(storage, item);
      continue;
    }

    if (item.operation === "create" && entrada.criacaoSomenteOnline) {
      // D-PROD-195 R2: criação gravada offline por versão anterior de uma
      // entidade que agora só cria online (ex.: categoria sem a curva
      // obrigatória). Retida, nunca enviada nem apagada; o replay segue.
      await reter(storage, item);
      continue;
    }

    if ((item.operation === "update" || item.operation === "delete") && criacoesRetidas.has(item.record_id)) {
      // Edição/exclusão de um registro cuja criação ficou retida: fica junto
      // dela (não é descartada nem enviada com id offline).
      await reter(storage, item, { depende_de: item.record_id });
      continue;
    }

    // D-PROD-195 R2: nenhum item vai ao servidor citando um registro cuja
    // criação ficou RETIDA (o servidor gravaria a referência solta).
    //  - create que cita: fica retido junto (é um registro que ainda não
    //    existe no servidor) e passa a segurar quem o citar;
    //  - update de registro REAL que cita: segue SEM os campos que citam o id
    //    retido (o resto da edição é aplicado; sem resto, sai da fila). Reter a
    //    edição de um registro real a deixaria por cima do servidor nas listas
    //    e travaria a exclusão por pendência offline.
    let dadosDoUpdate = item.data || {};
    if (item.operation === "create" || item.operation === "update") {
      const citado = [...idsOfflineNoCorpo(item.data || {})].find((id) => criacoesRetidas.has(id));
      if (citado && item.operation === "create") {
        await reter(storage, item, { depende_de: citado });
        criacoesRetidas.add(item.record_id);
        continue;
      }
      if (citado) {
        dadosDoUpdate = Object.fromEntries(
          Object.entries(item.data || {}).filter(
            ([, valor]) => ![...idsOfflineNoCorpo(valor)].some((id) => criacoesRetidas.has(id))
          )
        );
        if (Object.keys(dadosDoUpdate).length === 0) {
          await storage.removerDaFila(item.id);
          descartados += 1;
          emitirMudancaDeFila();
          continue;
        }
      }
    }

    try {
      const tenantDoItem = entrada.tenantScoped ? (item.cliente_id ?? null) : undefined;

      if (item.operation === "create") {
        const { id: _idOffline, _isOffline, ...bruto } = item.data || {};
        const criado = await operations.create(substituirIdsMapeados(bruto, mapaDeIds));
        mapaDeIds[item.record_id] = criado.id;
        // D-PROD-204: antes de sair da fila, quem cita o id offline passa a citar o do servidor.
        await gravarIdDoServidorNaFila(storage, item, criado.id);
        await atualizarCache(
          storage,
          item.entity_name,
          item.empresa_id,
          (items) => items.map((entry) => (entry.id === item.record_id ? criado : entry)),
          tenantDoItem
        );
      }

      if (item.operation === "update") {
        const alvo = mapaDeIds[item.record_id] || item.record_id;
        if (!isOfflineId(alvo)) {
          const atualizado = await operations.update(alvo, substituirIdsMapeados(dadosDoUpdate, mapaDeIds));
          await atualizarCache(
            storage,
            item.entity_name,
            item.empresa_id,
            (items) => items.map((entry) => (entry.id === alvo ? { ...entry, ...atualizado } : entry)),
            tenantDoItem
          );
        }
      }

      if (item.operation === "delete") {
        const alvo = mapaDeIds[item.record_id] || item.record_id;
        if (!isOfflineId(alvo)) await operations.delete(alvo);
        await atualizarCache(
          storage,
          item.entity_name,
          item.empresa_id,
          (items) => items.filter((entry) => entry.id !== item.record_id && entry.id !== alvo),
          tenantDoItem
        );
      }

      await storage.removerDaFila(item.id);
      emitirMudancaDeFila();
    } catch (error) {
      return { success: false, error, pendentes: emOrdem.length - i };
    }
  }

  if (retidos) {
    return {
      success: false,
      code: API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED,
      pendentes: pulados + quarentenados + retidos,
      pulados,
      descartados,
      quarentenados,
      retidos,
    };
  }
  if (quarentenados) {
    return {
      success: false,
      code: API_ERROR_CODES.OFFLINE_DELETE_QUARANTINED,
      pendentes: pulados + quarentenados,
      pulados,
      descartados,
      quarentenados,
      retidos,
    };
  }
  return { success: true, pendentes: pulados, pulados, descartados, quarentenados, retidos };
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

/** Reexport para fechamento de grafo (`gate:source-closure`) e composição explícita offline. */
export { createNormalizedEntityAdapter } from '../textNormalization.js';
