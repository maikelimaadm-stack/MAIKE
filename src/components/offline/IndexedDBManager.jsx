// IndexedDB Manager - VERSÃO SIMPLIFICADA
const DB_NAME = 'pesagens_offline_v2';
const DB_VERSION = 1;

const STORES = {
  PESAGENS_CACHE: 'pesagens_cache',
  APARTACOES_CACHE: 'apartacoes_cache',
  LOTES_CACHE: 'lotes_cache',
  PENDING_SYNC: 'pending_sync', // Fila única de sincronização
};

let db = null;

export const initDB = () => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onsuccess = () => {
      db = request.result;
      console.log('IndexedDB OK');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Cache de pesagens (dados do servidor)
      if (!database.objectStoreNames.contains(STORES.PESAGENS_CACHE)) {
        database.createObjectStore(STORES.PESAGENS_CACHE, { keyPath: 'id' });
      }

      // Cache de apartações
      if (!database.objectStoreNames.contains(STORES.APARTACOES_CACHE)) {
        database.createObjectStore(STORES.APARTACOES_CACHE, { keyPath: 'id' });
      }

      // Cache de lotes
      if (!database.objectStoreNames.contains(STORES.LOTES_CACHE)) {
        database.createObjectStore(STORES.LOTES_CACHE, { keyPath: 'id' });
      }

      // Fila de sincronização única
      if (!database.objectStoreNames.contains(STORES.PENDING_SYNC)) {
        const syncStore = database.createObjectStore(STORES.PENDING_SYNC, { keyPath: 'syncId' });
        syncStore.createIndex('type', 'type', { unique: false });
        syncStore.createIndex('synced', 'synced', { unique: false });
      }
    };
  });
};

// ========== FUNÇÕES GENÉRICAS ==========
const getStore = async (storeName, mode = 'readonly') => {
  const database = await initDB();
  const transaction = database.transaction(storeName, mode);
  return transaction.objectStore(storeName);
};

export const putItem = async (storeName, item) => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getItem = async (storeName, key) => {
  const store = await getStore(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getAllItems = async (storeName) => {
  const store = await getStore(storeName, 'readonly');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const deleteItem = async (storeName, key) => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearStore = async (storeName) => {
  const store = await getStore(storeName, 'readwrite');
  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

// ========== GERAR ID ÚNICO ==========
const generateUniqueId = (prefix) => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${random}`;
};

// ========== PESAGENS ==========
export const savePesagemOffline = async (pesagem) => {
  const syncId = generateUniqueId('pesagem');
  const item = {
    syncId,
    type: 'pesagem',
    action: pesagem._action || 'create',
    editId: pesagem._editId || null,
    data: pesagem,
    synced: false,
    createdAt: new Date().toISOString(),
  };
  await putItem(STORES.PENDING_SYNC, item);
  return syncId;
};

export const getPendingPesagens = async (empresaId) => {
  const all = await getAllItems(STORES.PENDING_SYNC);
  return all
    .filter(item => item.type === 'pesagem' && !item.synced && item.data.empresa_id === empresaId)
    .map(item => ({ ...item.data, _syncId: item.syncId, _action: item.action, _editId: item.editId }));
};

export const deletePendingPesagem = async (syncId) => {
  await deleteItem(STORES.PENDING_SYNC, syncId);
};

export const markPesagemSynced = async (syncId) => {
  const item = await getItem(STORES.PENDING_SYNC, syncId);
  if (item) {
    item.synced = true;
    await putItem(STORES.PENDING_SYNC, item);
  }
};

// ========== CACHE DE PESAGENS ==========
export const cachePesagens = async (pesagens) => {
  await clearStore(STORES.PESAGENS_CACHE);
  for (const p of pesagens) {
    await putItem(STORES.PESAGENS_CACHE, p);
  }
};

export const getCachedPesagens = async (empresaId) => {
  const all = await getAllItems(STORES.PESAGENS_CACHE);
  return all.filter(p => p.empresa_id === empresaId);
};

// ========== APARTAÇÕES ==========
export const saveApartacaoOffline = async (apartacao) => {
  const offlineId = generateUniqueId('apt');
  const item = {
    ...apartacao,
    id: offlineId,
    _isOffline: true,
  };
  await putItem(STORES.APARTACOES_CACHE, item);
  
  // Também salvar na fila de sync
  const syncItem = {
    syncId: offlineId,
    type: 'apartacao',
    action: 'create',
    data: apartacao,
    synced: false,
    createdAt: new Date().toISOString(),
  };
  await putItem(STORES.PENDING_SYNC, syncItem);
  
  return offlineId;
};

export const cacheApartacoes = async (apartacoes) => {
  // Manter apartações offline, substituir as do servidor
  const current = await getAllItems(STORES.APARTACOES_CACHE);
  const offlineOnes = current.filter(a => a._isOffline);
  
  await clearStore(STORES.APARTACOES_CACHE);
  
  for (const a of apartacoes) {
    await putItem(STORES.APARTACOES_CACHE, a);
  }
  
  // Re-adicionar offline que ainda não foram sincronizadas
  for (const a of offlineOnes) {
    const stillPending = await getItem(STORES.PENDING_SYNC, a.id);
    if (stillPending && !stillPending.synced) {
      await putItem(STORES.APARTACOES_CACHE, a);
    }
  }
};

export const getCachedApartacoes = async (empresaId) => {
  const all = await getAllItems(STORES.APARTACOES_CACHE);
  return all.filter(a => a.empresa_id === empresaId);
};

// ========== LOTES ==========
export const saveLoteOffline = async (lote) => {
  const offlineId = generateUniqueId('lote');
  const item = {
    ...lote,
    id: offlineId,
    _isOffline: true,
  };
  await putItem(STORES.LOTES_CACHE, item);
  
  // Também salvar na fila de sync
  const syncItem = {
    syncId: offlineId,
    type: 'lote',
    action: 'create',
    data: lote,
    synced: false,
    createdAt: new Date().toISOString(),
  };
  await putItem(STORES.PENDING_SYNC, syncItem);
  
  return offlineId;
};

export const cacheLotes = async (lotes) => {
  // Manter lotes offline, substituir os do servidor
  const current = await getAllItems(STORES.LOTES_CACHE);
  const offlineOnes = current.filter(l => l._isOffline);
  
  await clearStore(STORES.LOTES_CACHE);
  
  for (const l of lotes) {
    await putItem(STORES.LOTES_CACHE, l);
  }
  
  // Re-adicionar offline que ainda não foram sincronizadas
  for (const l of offlineOnes) {
    const stillPending = await getItem(STORES.PENDING_SYNC, l.id);
    if (stillPending && !stillPending.synced) {
      await putItem(STORES.LOTES_CACHE, l);
    }
  }
};

export const getCachedLotes = async (empresaId) => {
  const all = await getAllItems(STORES.LOTES_CACHE);
  return all.filter(l => l.empresa_id === empresaId);
};

// ========== CONTAGEM DE PENDENTES ==========
export const getPendingCounts = async () => {
  const all = await getAllItems(STORES.PENDING_SYNC);
  const pending = all.filter(item => !item.synced);
  
  const pesagens = pending.filter(p => p.type === 'pesagem').length;
  const apartacoes = pending.filter(p => p.type === 'apartacao').length;
  const lotes = pending.filter(p => p.type === 'lote').length;
  
  return {
    pesagens,
    apartacoes,
    lotes,
    total: pesagens + apartacoes + lotes,
  };
};

// ========== LIMPAR TUDO ==========
export const clearAllPending = async () => {
  await clearStore(STORES.PENDING_SYNC);
};

export const clearAllCache = async () => {
  await Promise.all([
    clearStore(STORES.PESAGENS_CACHE),
    clearStore(STORES.APARTACOES_CACHE),
    clearStore(STORES.LOTES_CACHE),
    clearStore(STORES.PENDING_SYNC),
  ]);
};

// ========== OBTER TODOS PENDENTES ==========
export const getAllPending = async () => {
  const all = await getAllItems(STORES.PENDING_SYNC);
  return all.filter(item => !item.synced);
};

export const STORES_NAMES = STORES;

export default {
  initDB,
  putItem,
  getItem,
  getAllItems,
  deleteItem,
  clearStore,
  savePesagemOffline,
  getPendingPesagens,
  deletePendingPesagem,
  markPesagemSynced,
  cachePesagens,
  getCachedPesagens,
  saveApartacaoOffline,
  cacheApartacoes,
  getCachedApartacoes,
  saveLoteOffline,
  cacheLotes,
  getCachedLotes,
  getPendingCounts,
  clearAllPending,
  clearAllCache,
  getAllPending,
  STORES_NAMES,
};