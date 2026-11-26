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
import { ApiError, API_ERROR_CODES, getApiErrorMessage } from "@/apis/_core/ApiError";
import { classificarFalhaDeEnvio } from "@/lib/offline/sincronizacao/motorDeSincronizacao";
import { eIdDoAparelho, novoIdDoAparelho } from "@/lib/offline/idDoAparelho";
import { getOfflineTenant } from "@/lib/offline/offlineTenant";
import { contadorDeCopiasDoAparelho } from "@/lib/offline/copiasDoAparelho";

const GLOBAL_EMPRESA_KEY = "__GLOBAL__";
/** Sessão nativa ausente. Valor legítimo: entidade da Base44 não tem tenant do MAIKE. */
const SEM_TENANT_KEY = "__SEM_TENANT__";
/** Marca a parte da chave que é tenant, para não confundir com nome de entidade. */
const TENANT_PREFIXO = "cli:";
const OFFLINE_SYNC_EVENT = "offline-entity-queue-updated";
/** Operações que a fila grava (as únicas que o replay sabe aplicar). */
const OPERACOES_DA_FILA = Object.freeze(["create", "update", "delete"]);

/** D-PROD-316: o campo da versão vista do registro na edição (vai só no PATCH; ver `versaoDoRegistro.js` no servidor). */
export const CAMPO_VERSAO_ESPERADA = "versao_esperada";

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
/** D-PROD-308: erro do servidor repetido no mesmo item — na 5ª vez, retido com o motivo. */
const TENTATIVAS_COM_ERRO_DO_SERVIDOR = 5;

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
 * D-PROD-294 — "Baixar dados para usar sem internet": lê do servidor TODAS as
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
        const copiasAntes = contadorDeCopiasDoAparelho();
        await entrada.adapter.list();
        // D-PROD-307: veio a cópia do aparelho (a rede não respondeu): não baixou de verdade.
        if (contadorDeCopiasDoAparelho() !== copiasAntes) falhas.push(nome);
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
      // D-PROD-307: o registro criado offline também fica no cache: sem isto aparecia duas vezes.
      const i = proximo.findIndex((item) => item?.id === operacao.data?.id);
      if (i >= 0) proximo[i] = { ...proximo[i], ...operacao.data };
      else proximo.unshift(operacao.data);
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
 * @param {boolean} [p.adotarFilaSemDono] D-PROD-307: entidade que passou a ser
 *        tenant-scoped agora — o que a versão anterior deixou na fila SEM dono é
 *        adotado pela sessão atual no replay (em vez de descartado).
 * @param {boolean} [p.idDoAparelho] D-PROD-308: o registro novo nasce com o id definitivo
 *        gerado no aparelho (UUID), com ou sem internet; o servidor grava com ele e
 *        repetir a criação devolve o mesmo registro. Com internet, se a criação não
 *        chega a uma resposta (rede caiu, servidor fora), ela vai para a fila com o
 *        MESMO id (sem duplicar) em vez de voltar erro para a tela.
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
  adotarFilaSemDono = false,
  idDoAparelho = false,
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
    adotarFilaSemDono: Boolean(tenantScoped && adotarFilaSemDono),
    idDoAparelho: Boolean(idDoAparelho),
    tenantCatalog: catalogoTenant,
    exclusaoSomenteOnline,
    criacaoSomenteOnline,
  });

  const adapter = { ...operations };

  /**
   * D-PROD-308: criação deste registro ainda na fila (offline_ ou id do aparelho).
   * @param {string} recordId @param {string|null|undefined} tenantId
   */
  const criacaoPendenteDe = async (recordId, tenantId) =>
    (await porta.listarFila()).find(
      (item) =>
        item.entity_name === entityName &&
        item.operation === "create" &&
        item.data?.id === recordId &&
        !item.quarentena &&
        (tenantId === undefined || (item.cliente_id ?? null) === tenantId)
    ) ?? null;

  /**
   * D-PROD-316: edição deste registro ainda na fila (não retida). Com ela, a próxima edição entra
   * nela em vez de ir direto ao servidor (ordem e versão preservadas).
   * @param {string} nome @param {string} recordId @param {string|null|undefined} tenantId
   */
  const edicaoPendenteDe = async (nome, recordId, tenantId) =>
    (await porta.listarFila()).find(
      (item) =>
        item.entity_name === nome &&
        item.operation === "update" &&
        item.record_id === recordId &&
        !item.quarentena &&
        (tenantId === undefined || (item.cliente_id ?? null) === tenantId)
    ) ?? null;

  if (typeof operations.list === "function") {
    adapter.list = async (order, limit) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant);
      const tenantId = tenantDe(tenantScoped);
      if (!estaOnline()) return listarLocal(porta, entityName, { order, limit, empresaId, tenantId });

      const copiasAntes = contadorDeCopiasDoAparelho();
      const resultado = await operations.list(order, limit);
      // D-PROD-307: a rede não respondeu a tempo e veio a cópia do aparelho (pode ser de antes
      // do que acabou de ser gravado): não grava por cima do cache; mostra o que o aparelho tem.
      if (contadorDeCopiasDoAparelho() === copiasAntes) {
        await gravarCacheDe(porta, entityName, empresaId, Array.isArray(resultado) ? resultado : [], tenantId);
      }
      return listarLocal(porta, entityName, { order, limit, empresaId, tenantId });
    };
  }

  if (typeof operations.filter === "function") {
    adapter.filter = async (filters = {}, order, limit) => {
      const empresaId = empresaIdParaEntidade(catalogoTenant);
      const tenantId = tenantDe(tenantScoped);
      if (estaOnline() && typeof operations.list === "function") {
        const copiasAntes = contadorDeCopiasDoAparelho();
        const resultado = await operations.list(order);
        if (contadorDeCopiasDoAparelho() === copiasAntes) {
          await gravarCacheDe(porta, entityName, empresaId, Array.isArray(resultado) ? resultado : [], tenantId);
        }
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
      // D-PROD-308: id definitivo do aparelho (a tela pode trazer o seu, para repetir sem duplicar).
      const idNovo = idDoAparelho ? (eIdDoAparelho(dados?.id) ? dados.id : novoIdDoAparelho()) : null;
      /** A criação já foi ao servidor sem resposta (o servidor pode ter gravado). */
      let jaTentado = false;

      if (estaOnline()) {
        let criado;
        try {
          criado = await operations.create(idNovo ? { ...dados, id: idNovo } : dados);
        } catch (erro) {
          // Sem resposta (rede caiu, sessão vencida): com o id do aparelho, repetir depois não
          // duplica — vai para a fila. Recusa ou erro do servidor volta para a tela (que pode
          // desfazer o que fez antes). Sem conta definida, também volta (a fila não teria dono).
          const falha = classificarFalhaDeEnvio(erro);
          const semResposta = falha === "rede" || falha === "sessao";
          if (!idNovo || !semResposta || (tenantScoped && !tenantId)) throw erro;
          criado = null;
          jaTentado = true;
        }
        if (criado) {
          await atualizarCache(
            porta,
            entityName,
            empresaId,
            (items) => [criado, ...items.filter((item) => item.id !== criado.id)],
            tenantId
          );
          return criado;
        }
      }

      const registro = {
        ...dados,
        id: idNovo ?? `offline_${entityName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
        ...(jaTentado ? { ja_tentado: true } : {}),
      });
      return registro;
    };
  }

  if (typeof operations.update === "function") {
    adapter.update = async (recordId, dadosRecebidos) => {
      // D-PROD-316: a versão que a pessoa viu (`versao_esperada`) vai só no PATCH; nunca entra no
      // registro guardado nem numa criação que ainda está na fila.
      const { [CAMPO_VERSAO_ESPERADA]: versaoEsperada, ...dados } = dadosRecebidos ?? {};
      const empresaId = empresaIdParaEntidade(catalogoTenant, dados);
      const tenantId = tenantDe(tenantScoped);

      // D-PROD-308: com internet, mas a criação deste registro ainda está na fila (a rede caiu
      // ao criar): a edição entra na criação, em vez de ir a um servidor que pode não tê-lo.
      // D-PROD-316: o mesmo com uma EDIÇÃO dele ainda na fila: a nova vai para a fila DEPOIS dela
      // (a cópia do aparelho tem uma versão local, e a ordem das duas edições se mantém), e a fila é
      // enviada em seguida.
      const edicaoNaFila = estaOnline() ? await edicaoPendenteDe(entityName, recordId, tenantId) : null;
      if (estaOnline() && !edicaoNaFila && !(await criacaoPendenteDe(recordId, tenantId))) {
        const atualizado = await operations.update(recordId, versaoEsperada ? { ...dados, [CAMPO_VERSAO_ESPERADA]: versaoEsperada } : dados);
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

      // Criação ainda na fila (id `offline_` ou, desde a D-PROD-308, id do aparelho): a edição
      // entra nela, em vez de virar um update de um registro que o servidor não conhece.
      {
        const criacaoPendente = fila.find(
          (item) =>
            item.entity_name === entityName &&
            item.operation === "create" &&
            item.data?.id === recordId &&
            (tenantId === undefined || (item.cliente_id ?? null) === tenantId)
        );
        if (criacaoPendente && !estaSendoEnviado(criacaoPendente)) {
          await porta.atualizarNaFila(criacaoPendente.id, { data: registro });
          emitirMudancaDeFila();
          return registro;
        }
        if (criacaoPendente) {
          // D-PROD-335: a criação está indo ao servidor agora: a edição vai como item próprio, logo depois
          // (a passada seguinte a envia; a criação, ao terminar, passa o id do servidor para ela).
          await enfileirar(porta, {
            entity_name: entityName,
            empresa_id: empresaId,
            ...carimboDeTenant(tenantScoped, tenantId),
            operation: "update",
            record_id: recordId,
            data: dados,
          });
          emitirMudancaDeFila();
          syncOfflineEntityQueue().catch(() => undefined);
          return registro;
        }
      }

      // D-PROD-335: nunca dentro de uma edição RECUSADA (ela espera a pessoa decidir, e a nova sumiria junto, sem
      // contar como "aguardando") nem de uma que está indo ao servidor agora (a nova se perderia).
      const atualizacaoPendente = fila.find(
        (item) =>
          item.entity_name === entityName &&
          item.operation === "update" &&
          item.record_id === recordId &&
          !item.quarentena &&
          !estaSendoEnviado(item) &&
          mesmaEmpresa(item)
      );

      if (edicaoNaFila) {
        // D-PROD-316: com internet, a fila pode estar enviando a edição anterior agora: juntar nela
        // poderia perder esta (o envio a tira da fila ao terminar). Vai como um item próprio, logo
        // depois, sem versão: é a continuação da edição anterior, que já confere a versão.
        await enfileirar(porta, {
          entity_name: entityName,
          empresa_id: empresaId,
          ...carimboDeTenant(tenantScoped, tenantId),
          operation: "update",
          record_id: recordId,
          data: dados,
        });
        emitirMudancaDeFila();
        syncOfflineEntityQueue().catch(() => undefined);
      } else if (atualizacaoPendente) {
        // D-PROD-316: a versão que vale é a da PRIMEIRA edição na fila (a que a pessoa viu do
        // servidor); a desta foi lida da cópia do aparelho, já com a edição anterior aplicada.
        const versaoDaFila = atualizacaoPendente.data?.[CAMPO_VERSAO_ESPERADA];
        await porta.atualizarNaFila(atualizacaoPendente.id, {
          data: { ...atualizacaoPendente.data, ...dados, ...(versaoDaFila ? { [CAMPO_VERSAO_ESPERADA]: versaoDaFila } : {}) },
        });
        emitirMudancaDeFila();
      } else {
        await enfileirar(porta, {
          entity_name: entityName,
          empresa_id: empresaId,
          ...carimboDeTenant(tenantScoped, tenantId),
          operation: "update",
          record_id: recordId,
          data: versaoEsperada ? { ...dados, [CAMPO_VERSAO_ESPERADA]: versaoEsperada } : dados,
        });
      }

      return registro;
    };
  }

  if (typeof operations.delete === "function" && exclusaoSomenteOnline) {
    // Sem fila e sem remoção otimista: falha (offline, timeout, 4xx, 5xx)
    // propaga com cache e fila intactos; só o sucesso definitivo limpa o cache.
    adapter.delete = async (recordId) => {
      // D-PROD-308: a criação ainda na fila vai primeiro; se não subir, não exclui (o servidor
      // ainda não tem o registro, e a criação o recriaria depois).
      if (await criacaoPendenteDe(recordId, tenantDe(tenantScoped))) {
        await syncOfflineEntityQueue().catch(() => undefined);
        if (await criacaoPendenteDe(recordId, tenantDe(tenantScoped))) {
          throw new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {
            operation: "delete",
            resource: entityName,
            details: { id: recordId, aguardando_envio: true },
          });
        }
      }
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

      // D-PROD-308: criação ainda na fila → caminho da fila (abaixo), mesmo com internet.
      if (estaOnline() && !(await criacaoPendenteDe(recordId, tenantId))) {
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
      // O id (offline_ ou do aparelho) é único: a criação pendente é achada por ele, mesmo que
      // a fazenda selecionada agora seja outra.
      const criacaoPendente = fila.find(
        (item) =>
          item.entity_name === entityName &&
          item.operation === "create" &&
          item.data?.id === recordId &&
          (tenantId === undefined || (item.cliente_id ?? null) === tenantId)
      );

      // D-PROD-335: criação indo ao servidor AGORA: não some da fila (o servidor a gravaria e o registro
      // voltaria); a exclusão entra depois dela, como na criação já tentada.
      if (criacaoPendente && !criacaoPendente.ja_tentado && !estaSendoEnviado(criacaoPendente)) {
        // Criação que nunca chegou ao servidor: some da fila em vez de virar
        // um delete de id que o servidor não conhece.
        await porta.removerDaFila(criacaoPendente.id);
        emitirMudancaDeFila();
        return;
      }
      // D-PROD-308: a criação já foi ao servidor sem resposta (pode estar lá): a exclusão entra
      // na fila DEPOIS dela — sobe a criação (ou o servidor devolve a já feita) e então exclui.

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
 * @param {{tenantScoped: boolean, adotarFilaSemDono?: boolean}} entrada
 * @param {{cliente_id?: string|null}} item
 * @param {string|null} tenantAtual
 * @returns {"aplicar"|"pular"|"descartar"|"adotar"}
 */
const destinoDaEntrada = (entrada, item, tenantAtual) => {
  if (!entrada.tenantScoped) return "aplicar";
  // D-PROD-307: entidade que só passou a ter dono agora — o que a versão anterior deixou na
  // fila sem dono é desta sessão (o celular é de quem está entrando), não é descartado.
  if (!("cliente_id" in item) && entrada.adotarFilaSemDono) return tenantAtual ? "adotar" : "pular";
  if (!("cliente_id" in item)) return "descartar";
  if ((item.cliente_id ?? null) !== tenantAtual) return "pular";
  return "aplicar";
};

/**
 * D-PROD-335 — itens da fila que a passada está enviando AGORA (entre o pedido ao servidor e a saída da fila).
 * Uma edição ou exclusão feita nesse meio tempo não pode entrar nem apagar o item: ele já foi ao servidor, e
 * ela se perderia (o envio o tira da fila ao terminar). Vai como um item próprio, depois dele.
 * @type {Set<string|number>}
 */
const EM_ENVIO = new Set();
/** @param {{id: string|number}|null|undefined} item */
const estaSendoEnviado = (item) => Boolean(item) && EM_ENVIO.has(/** @type {any} */ (item).id);

/** @type {Promise<any>|null} */
let passadaDaFila = null;
let pedidaDuranteAPassada = false;

/**
 * D-PROD-335 — uma passada pela fila por vez. Antes, a edição de um registro com outra edição na fila (e a
 * exclusão só online) chamava a fila direto, fora da vez da sincronização: duas passadas liam a mesma fila e
 * mandavam os mesmos itens, e o cadastro criado sem internet era criado DUAS vezes no servidor. Quem pede
 * durante uma passada recebe ela, e mais uma volta logo em seguida (para o que entrou na fila no meio).
 *
 * @param {(p: {current: number, total: number, item: object}) => void} [onProgress]
 */
export const syncOfflineEntityQueue = (onProgress) => {
  if (passadaDaFila) {
    pedidaDuranteAPassada = true;
    return passadaDaFila;
  }
  passadaDaFila = (async () => {
    let resultado;
    do {
      pedidaDuranteAPassada = false;
      resultado = await passarPelaFilaDeEntidades(onProgress);
    } while (pedidaDuranteAPassada && estaOnline());
    return resultado;
  })().finally(() => {
    passadaDaFila = null;
  });
  return passadaDaFila;
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
 *                    pulados?: number, descartados?: number, quarentenados?: number, retidos?: number, recusados?: number}>}
 */
const passarPelaFilaDeEntidades = async (onProgress) => {
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
  let recusados = 0;
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

  // D-PROD-316: registro com uma edição RECUSADA na fila (ex.: conflito de versão): as edições
  // seguintes dele esperam (a seguinte não leva versão; ir sozinha gravaria por cima de quem mudou).
  /** @type {Set<string>} */
  const edicoesRecusadas = new Set();
  const chaveDaEdicao = (item) => `${item.entity_name}\u0000${item.record_id}`;

  for (let i = 0; i < emOrdem.length; i += 1) {
    const item = emOrdem[i];
    // D-PROD-307: a conta mudou no meio da passada (saiu e outra entrou): para. O token de
    // cada pedido é lido na hora; seguir mandaria o registro de uma conta com o login da outra.
    if (getOfflineTenant() !== tenantAtual) {
      return { success: false, code: "SESSAO_TROCOU", pendentes: emOrdem.length - i };
    }
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

    if (destino === "adotar") {
      await storage.atualizarNaFila(item.id, { cliente_id: tenantAtual });
      item.cliente_id = tenantAtual;
    }

    if (item.quarentena?.codigo === CODIGO_RECUSADO_PELO_SERVIDOR) {
      // Já recusado: espera a pessoa (tentar de novo ou descartar); não volta a cada passada.
      if (item.operation === "update") edicoesRecusadas.add(chaveDaEdicao(item));
      recusados += 1;
      continue;
    }

    if (item.operation === "update" && edicoesRecusadas.has(chaveDaEdicao(item))) {
      // D-PROD-316: espera a edição anterior deste registro, recusada (fica na fila, intacta).
      pulados += 1;
      continue;
    }

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

    EM_ENVIO.add(item.id);
    try {
      const tenantDoItem = entrada.tenantScoped ? (item.cliente_id ?? null) : undefined;

      if (item.operation === "create") {
        const { id: _idOffline, _isOffline, ...bruto } = item.data || {};
        const corpo = substituirIdsMapeados(bruto, mapaDeIds);
        // D-PROD-308: id do aparelho vai junto — o servidor grava com ele; repetir não duplica.
        if (entrada.idDoAparelho && eIdDoAparelho(item.record_id)) corpo.id = item.record_id;
        const criado = await operations.create(corpo);
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
      EM_ENVIO.delete(item.id);
      emitirMudancaDeFila();
    } catch (error) {
      EM_ENVIO.delete(item.id);
      // D-PROD-307: recusa DEFINITIVA do servidor (registro que já não existe, dado inválido):
      // o item fica RETIDO com o motivo (a pessoa decide na janela "Sincronização") e a fila
      // SEGUE. Antes ele voltava a cada minuto e travava a fila inteira, de todas as entidades.
      // Sem rede, conta trocada ou erro passageiro do servidor: para, como antes.
      const codigoDoServidor = /** @type {any} */ (error)?.cause?.code;
      // D-PROD-308: a criação com o id do aparelho foi feita e depois excluída no servidor (por
      // outra pessoa, ou por esta, com a resposta da criação perdida): nada a fazer — a criação e
      // o que vinha atrás dela para o mesmo registro saem da fila e do aparelho.
      if (item.operation === "create" && codigoDoServidor === "ID_DO_APARELHO_EXCLUIDO") {
        for (const outro of await storage.listarFila()) {
          if (outro.entity_name === item.entity_name && (outro.id === item.id || outro.record_id === item.record_id)) {
            await storage.removerDaFila(outro.id);
          }
        }
        await atualizarCache(
          storage,
          item.entity_name,
          item.empresa_id,
          (items) => items.filter((entry) => entry.id !== item.record_id),
          entrada.tenantScoped ? (item.cliente_id ?? null) : undefined
        ).catch(() => undefined);
        emitirMudancaDeFila();
        descartados += 1;
        continue;
      }
      const falha = classificarFalhaDeEnvio(error);
      // D-PROD-308: erro do servidor que se repete (sempre o mesmo registro) não trava a fila
      // para sempre: na 5ª vez fica retido com o motivo, como a recusa.
      const tentativasComErro = falha === "servidor" ? Number(item.tentativas_com_erro ?? 0) + 1 : 0;
      // D-PROD-328: o último erro fica no item, para a fila da janela "Sincronização" mostrar o que aconteceu.
      const ultimoErro = { mensagem: getApiErrorMessage(error, "Não foi possível enviar."), falha, em: new Date().toISOString() };
      if (falha === "servidor" && tentativasComErro < TENTATIVAS_COM_ERRO_DO_SERVIDOR) {
        await storage.atualizarNaFila(item.id, { tentativas_com_erro: tentativasComErro, ultimo_erro: ultimoErro }).catch(() => undefined);
      } else if (falha !== "recusado") {
        await storage.atualizarNaFila(item.id, { ultimo_erro: ultimoErro }).catch(() => undefined);
      }
      if (falha === "recusado" || tentativasComErro >= TENTATIVAS_COM_ERRO_DO_SERVIDOR) {
        if (item.operation === "update") edicoesRecusadas.add(chaveDaEdicao(item));
        await storage.atualizarNaFila(item.id, {
          quarentena: {
            codigo: CODIGO_RECUSADO_PELO_SERVIDOR,
            motivo: getApiErrorMessage(error, "O servidor não aceitou este registro."),
            operacao: item.operation,
            em: new Date().toISOString(),
          },
        });
        emitirMudancaDeFila();
        recusados += 1;
        continue;
      }
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
  return { success: true, pendentes: pulados, pulados, descartados, quarentenados, retidos, recusados };
};

/**
 * D-PROD-295 — quantas operações da fila de entidades (a fila antiga, por
 * entidade) desta sessão ainda não chegaram ao servidor. Entram no contador
 * "aguardando envio" junto com a fila de envio do motor.
 * @returns {Promise<number>}
 */
/** Itens da fila antiga desta sessão (com os sem dono das entidades que os adotam). */
const filaDaSessao = async () => {
  if (CATALOGO.size === 0) return [];
  const porta = [...CATALOGO.values()][0].storage;
  const tenantAtual = getOfflineTenant();
  let fila = [];
  try {
    fila = await porta.listarFila();
  } catch {
    return [];
  }
  return fila.filter((item) => {
    const entrada = CATALOGO.get(item.entity_name);
    if (!entrada?.tenantScoped) return true;
    if (!("cliente_id" in item)) return Boolean(entrada.adotarFilaSemDono && tenantAtual);
    return (item.cliente_id ?? null) === tenantAtual;
  });
};

export const contarPendenciasDaFilaDeEntidades = async () =>
  (await filaDaSessao()).filter((item) => item.quarentena?.codigo !== CODIGO_RECUSADO_PELO_SERVIDOR).length;

/**
 * D-PROD-335 — a fila tem algum cadastro cuja porta ainda não carregou (as portas de Marca, Unidade, Categoria e
 * Tipo de atividade carregam com a tela)? Sem ela, a passada parava no item e segurava o resto da fila.
 */
export const temEntidadeSemPortaNaFila = async () => {
  if (CATALOGO.size === 0) return false;
  const fila = await [...CATALOGO.values()][0].storage.listarFila();
  return fila.some((item) => !CATALOGO.has(item.entity_name));
};

/** Código da quarentena do item que o servidor recusou de vez (D-PROD-307). */
export const CODIGO_RECUSADO_PELO_SERVIDOR = "RECUSADO_PELO_SERVIDOR";

/**
 * D-PROD-308 — ids de registros criados no aparelho que ainda esperam envio nesta fila
 * (não recusados). O motor segura o que cita um deles (ex.: a leitura de um cocho criado
 * sem internet) até a criação chegar ao servidor.
 * @returns {Promise<Set<string>>}
 */
export const idsComCriacaoPendenteNaFilaDeEntidades = async () =>
  new Set(
    (await filaDaSessao())
      .filter((item) => item.operation === "create" && !item.quarentena)
      .map((item) => String(item.record_id))
  );

/**
 * D-PROD-335 — ids dos registros desta entidade com QUALQUER criação ou edição na fila (inclusive recusada). Quem grava
 * por fora da fila (ex.: as fotos de tarefa que sobem depois) espera esses saírem: mandar antes passaria à frente da
 * edição guardada, ou iria a um registro que o servidor ainda não tem (ou recusou).
 * @param {string} entityName
 * @returns {Promise<Set<string>>}
 */
export const idsComPendenciaNaFilaDeEntidades = async (entityName) =>
  new Set(
    (await filaDaSessao())
      .filter((item) => item.entity_name === entityName && (item.operation === "create" || item.operation === "update"))
      .map((item) => String(item.record_id))
  );

/**
 * D-PROD-307 — itens da fila antiga que o servidor recusou de vez, para a janela
 * "Sincronização" mostrar o motivo e a pessoa decidir.
 * @returns {Promise<Array<{ id: number|string, entidade: string, operacao: string, motivo: string, em: string|null }>>}
 */
export const listarRecusadosDaFilaDeEntidades = async () =>
  (await filaDaSessao())
    .filter((item) => item.quarentena?.codigo === CODIGO_RECUSADO_PELO_SERVIDOR)
    .map((item) => ({
      id: item.id,
      entidade: item.entity_name,
      operacao: item.operation,
      motivo: item.quarentena?.motivo || "O servidor não aceitou este registro.",
      em: item.quarentena?.em ?? null,
    }));

/** Tira da fila antiga um item recusado (a pessoa decidiu descartar). @param {number|string} id */
export const descartarRecusadoDaFilaDeEntidades = async (id) => {
  const item = (await filaDaSessao()).find((i) => i.id === id && i.quarentena?.codigo === CODIGO_RECUSADO_PELO_SERVIDOR);
  if (!item) return false;
  await armazenamentoDe(item.entity_name).storage.removerDaFila(item.id);
  emitirMudancaDeFila();
  return true;
};

/** A porta da fila do item; entidade que saiu do catálogo usa a porta comum (a fila é uma só). @param {string} nome */
const portaDaFilaDe = (nome) => CATALOGO.get(nome) ?? { storage: [...CATALOGO.values()][0].storage, tenantScoped: false };

/**
 * D-PROD-328 — TODOS os itens da fila antiga desta sessão, para a fila única da janela "Sincronização" (antes só os
 * recusados apareciam; o resto era só um número). `situacao`:
 *  - "aguardando": vai na próxima passada;
 *  - "recusado": o servidor recusou de vez (ou errou 5 vezes): a pessoa tenta de novo ou exclui;
 *  - "retido": a regra da entidade não deixa subir pela fila (exclusão só com internet, entidade fora da lista):
 *    só excluir.
 * @returns {Promise<Array<{ id: number|string, entidade: string, operacao: string, registroId: string|null,
 *   situacao: 'aguardando'|'recusado'|'retido', motivo: string|null, criado_em: string|null, tentativas: number,
 *   ultimaTentativaEm: string|null, dados: Record<string, unknown>|null }>>}
 */
export const listarItensDaFilaDeEntidades = async () =>
  (await filaDaSessao())
    .slice()
    .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
    .map((item) => {
      const codigo = item.quarentena?.codigo ?? null;
      const situacao = codigo === CODIGO_RECUSADO_PELO_SERVIDOR ? "recusado" : codigo ? "retido" : "aguardando";
      const motivo =
        situacao === "recusado"
          ? item.quarentena?.motivo || "O servidor não aceitou este registro."
          : codigo === API_ERROR_CODES.OFFLINE_DELETE_QUARANTINED
            ? "Esta exclusão só pode ser feita com internet, na própria tela."
            : situacao === "retido"
              ? "Este tipo de registro não sobe pela fila do aparelho."
              : item.ultimo_erro?.mensagem ?? null;
      return {
        id: item.id,
        entidade: item.entity_name,
        operacao: item.operation,
        registroId: item.record_id != null ? String(item.record_id) : null,
        situacao,
        motivo,
        criado_em: item.created_at ?? null,
        tentativas: Number(item.tentativas_com_erro ?? 0) + (situacao === "recusado" ? 1 : 0),
        ultimaTentativaEm: item.quarentena?.em ?? item.ultimo_erro?.em ?? null,
        dados: item.data && typeof item.data === "object" ? item.data : null,
      };
    });

/**
 * D-PROD-328 — "Tentar de novo" em qualquer item da fila antiga desta sessão: tira a recusa e o contador de erros;
 * o retido (regra da entidade) não volta (só excluir). @param {number|string} id
 */
export const tentarDeNovoNaFilaDeEntidades = async (id) => {
  const item = (await filaDaSessao()).find((i) => i.id === id);
  if (!item) return false;
  if (item.quarentena && item.quarentena.codigo !== CODIGO_RECUSADO_PELO_SERVIDOR) return false;
  await portaDaFilaDe(item.entity_name).storage.atualizarNaFila(item.id, { quarentena: null, tentativas_com_erro: 0 });
  emitirMudancaDeFila();
  return true;
};

/**
 * D-PROD-328 — "Excluir" qualquer item da fila antiga desta sessão (a pessoa decidiu que ele não vai ao sistema).
 * Excluir uma CRIAÇÃO leva junto o que vinha atrás dela para o mesmo registro (sem ela, não teriam o que alterar)
 * e tira o registro do aparelho. Devolve quantos itens saíram. @param {number|string} id
 */
export const excluirDaFilaDeEntidades = async (id) => {
  const fila = await filaDaSessao();
  const item = fila.find((i) => i.id === id);
  if (!item) return 0;
  const { storage, tenantScoped } = portaDaFilaDe(item.entity_name);
  const juntos =
    item.operation === "create" && item.record_id != null
      ? fila.filter((o) => o.entity_name === item.entity_name && (o.id === item.id || o.record_id === item.record_id))
      : [item];
  for (const o of juntos) await storage.removerDaFila(o.id);
  if (item.operation === "create" && item.record_id != null) {
    await atualizarCache(
      storage,
      item.entity_name,
      item.empresa_id,
      (items) => items.filter((entry) => entry.id !== item.record_id),
      tenantScoped ? (item.cliente_id ?? null) : undefined
    ).catch(() => undefined);
  }
  emitirMudancaDeFila();
  return juntos.length;
};

/** Volta o item recusado para a fila (a pessoa corrigiu o que faltava). @param {number|string} id */
export const tentarDeNovoRecusadoDaFilaDeEntidades = async (id) => {
  const item = (await filaDaSessao()).find((i) => i.id === id && i.quarentena?.codigo === CODIGO_RECUSADO_PELO_SERVIDOR);
  if (!item) return false;
  await armazenamentoDe(item.entity_name).storage.atualizarNaFila(item.id, { quarentena: null });
  emitirMudancaDeFila();
  return true;
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
