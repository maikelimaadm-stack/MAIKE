// IndexedDB Manager para persistência offline
const DB_NAME = 'pesagens_offline_db';
const DB_VERSION = 3;

const STORES = {
  PESAGENS: 'pesagens_individuais',
  APARTACOES: 'apartacoes',
  LOTES: 'lotes_apartacao',
  EMBARQUES: 'embarques',
  DOCUMENTOS_EMBARQUE: 'documentos_embarque',
  PENDING_PESAGENS: 'pending_pesagens',
  PENDING_APARTACOES: 'pending_apartacoes',
  PENDING_LOTES: 'pending_lotes',
  PENDING_SANIDADE: 'pending_sanidade',
  PENDING_UPDATES: 'pending_updates',
  SYNC_QUEUE: 'sync_queue',
};

let db = null;

export const initDB = () => {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Erro ao abrir IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('IndexedDB inicializado com sucesso');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Store para pesagens sincronizadas
      if (!database.objectStoreNames.contains(STORES.PESAGENS)) {
        const pesagensStore = database.createObjectStore(STORES.PESAGENS, { keyPath: 'id' });
        pesagensStore.createIndex('empresa_id', 'empresa_id', { unique: false });
        pesagensStore.createIndex('data_pesagem', 'data_pesagem', { unique: false });
      }

      // Store para apartações sincronizadas
      if (!database.objectStoreNames.contains(STORES.APARTACOES)) {
        const apartacoesStore = database.createObjectStore(STORES.APARTACOES, { keyPath: 'id' });
        apartacoesStore.createIndex('empresa_id', 'empresa_id', { unique: false });
      }

      // Store para lotes sincronizados
      if (!database.objectStoreNames.contains(STORES.LOTES)) {
        const lotesStore = database.createObjectStore(STORES.LOTES, { keyPath: 'id' });
        lotesStore.createIndex('empresa_id', 'empresa_id', { unique: false });
        lotesStore.createIndex('apartacao_id', 'apartacao_id', { unique: false });
      }

      // Store para embarques sincronizados
      if (!database.objectStoreNames.contains(STORES.EMBARQUES)) {
        const embStore = database.createObjectStore(STORES.EMBARQUES, { keyPath: 'id' });
        embStore.createIndex('empresa_id', 'empresa_id', { unique: false });
      }

      // Store para documentos de embarque sincronizados
      if (!database.objectStoreNames.contains(STORES.DOCUMENTOS_EMBARQUE)) {
        const docStore = database.createObjectStore(STORES.DOCUMENTOS_EMBARQUE, { keyPath: 'id' });
        docStore.createIndex('empresa_id', 'empresa_id', { unique: false });
        docStore.createIndex('embarque_id', 'embarque_id', { unique: false });
      }

      // Store para pesagens pendentes (offline)
      if (!database.objectStoreNames.contains(STORES.PENDING_PESAGENS)) {
        const pendingPesagensStore = database.createObjectStore(STORES.PENDING_PESAGENS, { keyPath: '_offlineId', autoIncrement: true });
        pendingPesagensStore.createIndex('empresa_id', 'empresa_id', { unique: false });
        pendingPesagensStore.createIndex('data_pesagem', 'data_pesagem', { unique: false });
      }

      // Store para apartações pendentes (offline)
      if (!database.objectStoreNames.contains(STORES.PENDING_APARTACOES)) {
        const pendingApartacoesStore = database.createObjectStore(STORES.PENDING_APARTACOES, { keyPath: '_offlineId', autoIncrement: true });
        pendingApartacoesStore.createIndex('empresa_id', 'empresa_id', { unique: false });
        pendingApartacoesStore.createIndex('action', 'action', { unique: false });
      }

      // Store para lotes pendentes (offline)
      if (!database.objectStoreNames.contains(STORES.PENDING_LOTES)) {
        const pendingLotesStore = database.createObjectStore(STORES.PENDING_LOTES, { keyPath: '_offlineId', autoIncrement: true });
        pendingLotesStore.createIndex('empresa_id', 'empresa_id', { unique: false });
        pendingLotesStore.createIndex('action', 'action', { unique: false });
      }

      // Store para sanidade pendente (offline)
      if (!database.objectStoreNames.contains(STORES.PENDING_SANIDADE)) {
        const pendingSanidadeStore = database.createObjectStore(STORES.PENDING_SANIDADE, { keyPath: '_offlineId', autoIncrement: true });
        pendingSanidadeStore.createIndex('empresa_id', 'empresa_id', { unique: false });
        pendingSanidadeStore.createIndex('data_aplicacao', 'data_aplicacao', { unique: false });
      }

      // Store para atualizações pendentes (edição de registros)
      if (!database.objectStoreNames.contains(STORES.PENDING_UPDATES)) {
        const pendingUpdatesStore = database.createObjectStore(STORES.PENDING_UPDATES, { keyPath: '_offlineId', autoIncrement: true });
        pendingUpdatesStore.createIndex('entity', 'entity', { unique: false });
        pendingUpdatesStore.createIndex('entity_id', 'entity_id', { unique: false });
      }

      // Store para fila de sincronização geral
      if (!database.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        const syncStore = database.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
        syncStore.createIndex('type', 'type', { unique: false });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
};

// Funções genéricas CRUD
export const addItem = async (storeName, item) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(item);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const putItem = async (storeName, item) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getItem = async (storeName, key) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const getAllItems = async (storeName) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const getItemsByIndex = async (storeName, indexName, value) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const deleteItem = async (storeName, key) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearStore = async (storeName) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const bulkPut = async (storeName, items) => {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);

    let completed = 0;
    let errors = [];

    items.forEach(item => {
      const request = store.put(item);
      request.onsuccess = () => {
        completed++;
        if (completed === items.length) {
          resolve({ success: true, errors });
        }
      };
      request.onerror = () => {
        errors.push(request.error);
        completed++;
        if (completed === items.length) {
          resolve({ success: errors.length === 0, errors });
        }
      };
    });

    if (items.length === 0) resolve({ success: true, errors: [] });
  });
};

// Funções específicas para Pesagens
export const savePesagemOffline = async (pesagem) => {
  const item = {
    ...pesagem,
    _offlineTimestamp: new Date().toISOString(),
    _synced: false,
  };
  return addItem(STORES.PENDING_PESAGENS, item);
};

export const getPendingPesagens = async (empresaId) => {
  const all = await getAllItems(STORES.PENDING_PESAGENS);
  return all.filter(p => p.empresa_id === empresaId);
};

export const deletePendingPesagem = async (offlineId) => {
  return deleteItem(STORES.PENDING_PESAGENS, offlineId);
};

export const cachePesagens = async (pesagens) => {
  return bulkPut(STORES.PESAGENS, pesagens);
};

export const getCachedPesagens = async (empresaId) => {
  return getItemsByIndex(STORES.PESAGENS, 'empresa_id', empresaId);
};

// Funções específicas para Apartações
export const saveApartacaoOffline = async (action, data) => {
  const item = {
    action,
    data,
    _offlineTimestamp: new Date().toISOString(),
  };
  return addItem(STORES.PENDING_APARTACOES, item);
};

export const getPendingApartacoes = async () => {
  return getAllItems(STORES.PENDING_APARTACOES);
};

export const deletePendingApartacao = async (offlineId) => {
  return deleteItem(STORES.PENDING_APARTACOES, offlineId);
};

export const cacheApartacoes = async (apartacoes) => {
  return bulkPut(STORES.APARTACOES, apartacoes);
};

export const getCachedApartacoes = async (empresaId) => {
  return getItemsByIndex(STORES.APARTACOES, 'empresa_id', empresaId);
};

// Funções específicas para Lotes
export const saveLoteOffline = async (action, data) => {
  const item = {
    action,
    data,
    _offlineTimestamp: new Date().toISOString(),
  };
  return addItem(STORES.PENDING_LOTES, item);
};

export const getPendingLotes = async () => {
  return getAllItems(STORES.PENDING_LOTES);
};

export const deletePendingLote = async (offlineId) => {
  return deleteItem(STORES.PENDING_LOTES, offlineId);
};

export const cacheLotes = async (lotes) => {
  return bulkPut(STORES.LOTES, lotes);
};

export const getCachedLotes = async (empresaId) => {
  return getItemsByIndex(STORES.LOTES, 'empresa_id', empresaId);
};

// Funções para Sanidade offline
export const saveSanidadeOffline = async (sanidade) => {
  const item = {
    ...sanidade,
    _offlineTimestamp: new Date().toISOString(),
    _synced: false,
  };
  return addItem(STORES.PENDING_SANIDADE, item);
};

export const getPendingSanidade = async (empresaId) => {
  const all = await getAllItems(STORES.PENDING_SANIDADE);
  return all.filter(s => s.empresa_id === empresaId);
};

export const deletePendingSanidade = async (offlineId) => {
  return deleteItem(STORES.PENDING_SANIDADE, offlineId);
};

// Funções para Updates offline (edição de apartações/lotes)
export const saveUpdateOffline = async (entity, entityId, data) => {
  const item = {
    entity,
    entity_id: entityId,
    data,
    _offlineTimestamp: new Date().toISOString(),
  };
  return addItem(STORES.PENDING_UPDATES, item);
};

export const getPendingUpdates = async () => {
  return getAllItems(STORES.PENDING_UPDATES);
};

export const deletePendingUpdate = async (offlineId) => {
  return deleteItem(STORES.PENDING_UPDATES, offlineId);
};

// Função para obter contagem de pendentes
export const getPendingCounts = async () => {
  const [pesagens, apartacoes, lotes, sanidade, updates, cachedApt, cachedLotes] = await Promise.all([
    getAllItems(STORES.PENDING_PESAGENS),
    getAllItems(STORES.PENDING_APARTACOES),
    getAllItems(STORES.PENDING_LOTES),
    getAllItems(STORES.PENDING_SANIDADE),
    getAllItems(STORES.PENDING_UPDATES),
    getAllItems(STORES.APARTACOES),
    getAllItems(STORES.LOTES),
  ]);

  // Contar também apartações e lotes offline no cache
  const offlineApartacoes = cachedApt.filter(a => a._isOffline);
  const offlineLotes = cachedLotes.filter(l => l._isOffline);

  return {
    pesagens: pesagens.length,
    apartacoes: apartacoes.length + offlineApartacoes.length,
    lotes: lotes.length + offlineLotes.length,
    sanidade: sanidade.length,
    updates: updates.length,
    total: pesagens.length + apartacoes.length + lotes.length + sanidade.length + updates.length + offlineApartacoes.length + offlineLotes.length,
  };
};

// Limpar todas as filas pendentes
export const clearAllPending = async () => {
  await Promise.all([
    clearStore(STORES.PENDING_PESAGENS),
    clearStore(STORES.PENDING_APARTACOES),
    clearStore(STORES.PENDING_LOTES),
    clearStore(STORES.PENDING_SANIDADE),
    clearStore(STORES.PENDING_UPDATES),
  ]);
};

export const STORES_NAMES = STORES;

export default {
  initDB,
  addItem,
  putItem,
  getItem,
  getAllItems,
  getItemsByIndex,
  deleteItem,
  clearStore,
  bulkPut,
  savePesagemOffline,
  getPendingPesagens,
  deletePendingPesagem,
  cachePesagens,
  getCachedPesagens,
  saveApartacaoOffline,
  getPendingApartacoes,
  deletePendingApartacao,
  cacheApartacoes,
  getCachedApartacoes,
  saveLoteOffline,
  getPendingLotes,
  deletePendingLote,
  cacheLotes,
  getCachedLotes,
  saveSanidadeOffline,
  getPendingSanidade,
  deletePendingSanidade,
  saveUpdateOffline,
  getPendingUpdates,
  deletePendingUpdate,
  getPendingCounts,
  clearAllPending,
  STORES_NAMES,
};