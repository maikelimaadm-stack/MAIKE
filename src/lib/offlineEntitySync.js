import {
  getItem,
  putItem,
  getAllItems,
  addItem,
  deleteItem,
  STORES_NAMES,
} from "@/components/offline/IndexedDBManager";

const OFFLINE_ENABLED_ENTITIES = [
  "LancamentoTarefa",
  "HistoricoLancamentoTarefa",
  "AreaPastagem",
  "PontoReferencia",
  "PontoSuplementacao",
  "LinhaGeografica",
  "Lote",
  "ConfiguracaoIcone",
  "SuplementacaoEvento",
  "SuplementacaoLote",
  "EstoqueLoteNota",
  "MovimentacaoMapa",
  "TipoTarefa",
  "Fornecedor",
  "Produto",
  "Permissao",
  "Setor",
];

const GLOBAL_EMPRESA_KEY = "__GLOBAL__";
const OFFLINE_SYNC_EVENT = "offline-entity-queue-updated";

const getEmpresaId = () => localStorage.getItem("empresa_selecionada_id") || GLOBAL_EMPRESA_KEY;
const getCacheKey = (entityName, empresaId = getEmpresaId()) => `${entityName}::${empresaId || GLOBAL_EMPRESA_KEY}`;
const isOfflineEnabled = (entityName) => OFFLINE_ENABLED_ENTITIES.includes(entityName);
const isOfflineId = (value) => String(value || "").startsWith("offline_");

const emitQueueChange = () => {
  window.dispatchEvent(new CustomEvent(OFFLINE_SYNC_EVENT));
};

export const getOfflineSyncEventName = () => OFFLINE_SYNC_EVENT;

export const getEntityCache = async (entityName, empresaId = getEmpresaId()) => {
  const cached = await getItem(STORES_NAMES.ENTITY_CACHE, getCacheKey(entityName, empresaId));
  return cached?.items || [];
};

export const setEntityCache = async (entityName, items, empresaId = getEmpresaId()) => {
  await putItem(STORES_NAMES.ENTITY_CACHE, {
    cache_key: getCacheKey(entityName, empresaId),
    entity_name: entityName,
    empresa_id: empresaId,
    items,
    updated_at: new Date().toISOString(),
  });
};

export const getQueuedEntityOperations = async () => {
  return await getAllItems(STORES_NAMES.ENTITY_QUEUE);
};

export const getPendingOfflineEntityCount = async (empresaId = getEmpresaId()) => {
  const queue = await getQueuedEntityOperations();
  return queue.filter((item) => (item.empresa_id || GLOBAL_EMPRESA_KEY) === (empresaId || GLOBAL_EMPRESA_KEY)).length;
};

const sortItems = (items, order) => {
  if (!order || typeof order !== "string") return items;
  const desc = order.startsWith("-");
  const field = desc ? order.slice(1) : order;
  return [...items].sort((a, b) => {
    const aValue = a?.[field];
    const bValue = b?.[field];
    if (aValue === bValue) return 0;
    if (aValue === undefined || aValue === null) return desc ? 1 : -1;
    if (bValue === undefined || bValue === null) return desc ? -1 : 1;
    return aValue > bValue ? (desc ? -1 : 1) : (desc ? 1 : -1);
  });
};

const applyPendingOperations = (items, operations) => {
  const next = [...items];

  operations.forEach((operation) => {
    if (operation.operation === "create") {
      next.unshift(operation.data);
      return;
    }

    if (operation.operation === "update") {
      const index = next.findIndex((item) => item.id === operation.record_id);
      if (index >= 0) {
        next[index] = { ...next[index], ...operation.data };
      }
      return;
    }

    if (operation.operation === "delete") {
      const index = next.findIndex((item) => item.id === operation.record_id);
      if (index >= 0) {
        next.splice(index, 1);
      }
    }
  });

  return next;
};

export const getOfflineEntityList = async (entityName, { order, limit, filters = {}, empresaId = getEmpresaId() } = {}) => {
  const [cachedItems, queue] = await Promise.all([
    getEntityCache(entityName, empresaId),
    getQueuedEntityOperations(),
  ]);

  const entityOperations = queue.filter(
    (item) => item.entity_name === entityName && (item.empresa_id || GLOBAL_EMPRESA_KEY) === (empresaId || GLOBAL_EMPRESA_KEY)
  );

  let items = applyPendingOperations(cachedItems, entityOperations);

  if (Object.keys(filters).length > 0) {
    items = items.filter((item) =>
      Object.entries(filters).every(([key, value]) => item?.[key] === value)
    );
  }

  const sorted = sortItems(items, order);
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
};

const queueEntityOperation = async (payload) => {
  const id = await addItem(STORES_NAMES.ENTITY_QUEUE, {
    ...payload,
    created_at: new Date().toISOString(),
  });
  emitQueueChange();
  return id;
};

const updateQueuedEntityOperation = async (id, payload) => {
  const existing = await getItem(STORES_NAMES.ENTITY_QUEUE, id);
  if (!existing) return;
  await putItem(STORES_NAMES.ENTITY_QUEUE, { ...existing, ...payload, id });
  emitQueueChange();
};

const deleteQueuedEntityOperation = async (id) => {
  await deleteItem(STORES_NAMES.ENTITY_QUEUE, id);
  emitQueueChange();
};

const updateCachedEntityRecord = async (entityName, updater, empresaId = getEmpresaId()) => {
  const cachedItems = await getEntityCache(entityName, empresaId);
  const nextItems = updater([...cachedItems]);
  await setEntityCache(entityName, nextItems, empresaId);
  return nextItems;
};

const removeQueuedCreateForRecord = async (entityName, recordId, empresaId = getEmpresaId()) => {
  const queue = await getQueuedEntityOperations();
  const item = queue.find(
    (entry) => entry.entity_name === entityName && entry.operation === "create" && entry.data?.id === recordId && (entry.empresa_id || GLOBAL_EMPRESA_KEY) === (empresaId || GLOBAL_EMPRESA_KEY)
  );
  if (item) {
    await deleteQueuedEntityOperation(item.id);
    return item;
  }
  return null;
};

const patchEntityMethods = (base44Client, entityName) => {
  const entityApi = base44Client.entities?.[entityName];
  if (!entityApi || entityApi.__offlinePatched || !isOfflineEnabled(entityName)) return;

  const originals = {
    list: entityApi.list?.bind(entityApi),
    filter: entityApi.filter?.bind(entityApi),
    create: entityApi.create?.bind(entityApi),
    update: entityApi.update?.bind(entityApi),
    delete: entityApi.delete?.bind(entityApi),
  };

  if (!base44Client.__offlineOriginals) base44Client.__offlineOriginals = {};
  base44Client.__offlineOriginals[entityName] = originals;

  entityApi.list = async (order, limit) => {
    const empresaId = getEmpresaId();

    if (!navigator.onLine) {
      return await getOfflineEntityList(entityName, { order, limit, empresaId });
    }

    const result = originals.list ? await originals.list(order, limit) : [];
    await setEntityCache(entityName, Array.isArray(result) ? result : [], empresaId);
    return await getOfflineEntityList(entityName, { order, limit, empresaId });
  };

  entityApi.filter = async (filters = {}, order, limit) => {
    const empresaId = getEmpresaId();

    if (navigator.onLine) {
      const result = originals.list ? await originals.list(order) : [];
      await setEntityCache(entityName, Array.isArray(result) ? result : [], empresaId);
    }

    return await getOfflineEntityList(entityName, { filters, order, limit, empresaId });
  };

  entityApi.create = async (data) => {
    const empresaId = data?.empresa_id || getEmpresaId();

    if (navigator.onLine) {
      const created = await originals.create(data);
      await updateCachedEntityRecord(entityName, (items) => [created, ...items.filter((item) => item.id !== created.id)], empresaId);
      return created;
    }

    const offlineRecord = {
      ...data,
      id: `offline_${entityName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      empresa_id: empresaId,
      created_date: new Date().toISOString(),
      updated_date: new Date().toISOString(),
      _isOffline: true,
    };

    await updateCachedEntityRecord(entityName, (items) => [offlineRecord, ...items.filter((item) => item.id !== offlineRecord.id)], empresaId);
    await queueEntityOperation({
      entity_name: entityName,
      empresa_id: empresaId,
      operation: "create",
      record_id: offlineRecord.id,
      data: offlineRecord,
    });
    return offlineRecord;
  };

  entityApi.update = async (recordId, data) => {
    const empresaId = data?.empresa_id || getEmpresaId();

    if (navigator.onLine) {
      const updated = await originals.update(recordId, data);
      await updateCachedEntityRecord(entityName, (items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item), empresaId);
      return updated;
    }

    const nextItems = await updateCachedEntityRecord(entityName, (items) => {
      const existing = items.find((item) => item.id === recordId) || { id: recordId, empresa_id: empresaId };
      const updated = { ...existing, ...data, id: recordId, updated_date: new Date().toISOString(), _isOffline: true };
      const withoutCurrent = items.filter((item) => item.id !== recordId);
      return [updated, ...withoutCurrent];
    }, empresaId);

    const updatedRecord = nextItems.find((item) => item.id === recordId);

    if (isOfflineId(recordId)) {
      const queue = await getQueuedEntityOperations();
      const pendingCreate = queue.find(
        (item) => item.entity_name === entityName && item.operation === "create" && item.data?.id === recordId && (item.empresa_id || GLOBAL_EMPRESA_KEY) === (empresaId || GLOBAL_EMPRESA_KEY)
      );
      if (pendingCreate) {
        await updateQueuedEntityOperation(pendingCreate.id, { data: updatedRecord });
        return updatedRecord;
      }
    }

    const queue = await getQueuedEntityOperations();
    const pendingUpdate = queue.find(
      (item) => item.entity_name === entityName && item.operation === "update" && item.record_id === recordId && (item.empresa_id || GLOBAL_EMPRESA_KEY) === (empresaId || GLOBAL_EMPRESA_KEY)
    );

    if (pendingUpdate) {
      await updateQueuedEntityOperation(pendingUpdate.id, { data: { ...pendingUpdate.data, ...data } });
    } else {
      await queueEntityOperation({
        entity_name: entityName,
        empresa_id: empresaId,
        operation: "update",
        record_id: recordId,
        data,
      });
    }

    return updatedRecord;
  };

  entityApi.delete = async (recordId) => {
    const empresaId = getEmpresaId();

    if (navigator.onLine) {
      await originals.delete(recordId);
      await updateCachedEntityRecord(entityName, (items) => items.filter((item) => item.id !== recordId), empresaId);
      return;
    }

    await updateCachedEntityRecord(entityName, (items) => items.filter((item) => item.id !== recordId), empresaId);

    const removedCreate = await removeQueuedCreateForRecord(entityName, recordId, empresaId);
    if (!removedCreate) {
      await queueEntityOperation({
        entity_name: entityName,
        empresa_id: empresaId,
        operation: "delete",
        record_id: recordId,
        data: { id: recordId },
      });
    }
  };

  entityApi.__offlinePatched = true;
};

export const syncOfflineEntityQueue = async (base44Client, onProgress) => {
  if (!navigator.onLine) {
    return { success: false, message: "Sem conexão" };
  }

  const queue = await getQueuedEntityOperations();
  const orderedQueue = [...queue].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const idMap = {};

  for (let index = 0; index < orderedQueue.length; index += 1) {
    const item = orderedQueue[index];
    const originals = base44Client.__offlineOriginals?.[item.entity_name];
    if (!originals) continue;

    onProgress?.({ current: index + 1, total: orderedQueue.length, item });

    try {
      if (item.operation === "create") {
        const { id, _isOffline, ...payload } = item.data || {};
        const created = await originals.create(payload);
        idMap[item.record_id] = created.id;
        await updateCachedEntityRecord(item.entity_name, (items) => items.map((entry) => entry.id === item.record_id ? created : entry), item.empresa_id);
      }

      if (item.operation === "update") {
        const targetId = idMap[item.record_id] || item.record_id;
        if (!isOfflineId(targetId)) {
          const updated = await originals.update(targetId, item.data || {});
          await updateCachedEntityRecord(item.entity_name, (items) => items.map((entry) => entry.id === targetId ? { ...entry, ...updated } : entry), item.empresa_id);
        }
      }

      if (item.operation === "delete") {
        const targetId = idMap[item.record_id] || item.record_id;
        if (!isOfflineId(targetId)) {
          await originals.delete(targetId);
        }
        await updateCachedEntityRecord(item.entity_name, (items) => items.filter((entry) => entry.id !== item.record_id && entry.id !== targetId), item.empresa_id);
      }

      await deleteQueuedEntityOperation(item.id);
    } catch (error) {
      return { success: false, error };
    }
  }

  return { success: true };
};

export const installOfflineEntitySync = (base44Client) => {
  if (base44Client.__offlineEntitySyncInstalled) return;

  OFFLINE_ENABLED_ENTITIES.forEach((entityName) => patchEntityMethods(base44Client, entityName));

  window.addEventListener("online", () => {
    const empresaId = getEmpresaId();
    if (!empresaId) return;
    window.setTimeout(() => {
      syncOfflineEntityQueue(base44Client);
    }, 1000);
  });

  base44Client.__offlineEntitySyncInstalled = true;
};