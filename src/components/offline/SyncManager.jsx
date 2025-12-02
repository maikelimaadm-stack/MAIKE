// Sync Manager - Gerencia sincronização de dados offline
import { base44 } from '@/api/base44Client';
import {
  getPendingPesagens,
  deletePendingPesagem,
  getPendingApartacoes,
  deletePendingApartacao,
  getPendingLotes,
  deletePendingLote,
  cachePesagens,
  cacheApartacoes,
  cacheLotes,
  getPendingCounts,
} from './IndexedDBManager';

let syncInProgress = false;
let syncListeners = [];

export const addSyncListener = (listener) => {
  syncListeners.push(listener);
  return () => {
    syncListeners = syncListeners.filter(l => l !== listener);
  };
};

const notifyListeners = (event) => {
  syncListeners.forEach(listener => {
    try {
      listener(event);
    } catch (e) {
      console.error('Erro no listener de sincronização:', e);
    }
  });
};

export const syncPesagens = async (empresaId) => {
  const pending = await getPendingPesagens(empresaId);
  let successCount = 0;
  const errors = [];
  const processedKeys = new Set(); // Evitar duplicação por numero_animal+data

  for (const pesagem of pending) {
    try {
      const { _offlineId, _offlineTimestamp, _synced, _editId, _action, _isOffline, ...data } = pesagem;
      
      // Criar chave única para evitar duplicação
      const uniqueKey = `${data.numero_animal}_${data.data_pesagem}`;
      
      // Verificar se é uma edição ou criação
      if (_action === 'update' && _editId) {
        await base44.entities.PesagemIndividual.update(_editId, data);
        await deletePendingPesagem(_offlineId);
        successCount++;
      } else {
        // Evitar criar duplicado
        if (processedKeys.has(uniqueKey)) {
          await deletePendingPesagem(_offlineId);
          continue;
        }
        processedKeys.add(uniqueKey);
        
        await base44.entities.PesagemIndividual.create(data);
        await deletePendingPesagem(_offlineId);
        successCount++;
      }
    } catch (error) {
      console.error('Erro ao sincronizar pesagem:', error);
      errors.push({ pesagem, error: error.message });
      // Remover da fila mesmo com erro para evitar loop infinito
      await deletePendingPesagem(pesagem._offlineId);
    }
  }

  return { successCount, errors, total: pending.length };
};

export const syncApartacoes = async () => {
  const pending = await getPendingApartacoes();
  let successCount = 0;
  const errors = [];
  const idMap = {}; // Mapeia IDs offline para IDs reais
  const processedOfflineIds = new Set(); // Evitar duplicação

  // Ordenar: creates primeiro, updates depois, deletes por último
  const sorted = [...pending].sort((a, b) => {
    const order = { create: 0, update: 1, delete: 2 };
    return (order[a.action] || 0) - (order[b.action] || 0);
  });

  for (const item of sorted) {
    try {
      if (item.action === 'create') {
        const offlineId = item.data?.id;
        
        // Evitar processar o mesmo item offline duas vezes
        if (offlineId && processedOfflineIds.has(offlineId)) {
          await deletePendingApartacao(item._offlineId);
          continue;
        }
        if (offlineId) processedOfflineIds.add(offlineId);
        
        const { _offlineId, id, created_date, _isOffline, ...data } = item.data;
        const created = await base44.entities.Apartacao.create(data);
        if (offlineId) idMap[offlineId] = created.id;
        await deletePendingApartacao(item._offlineId);
        successCount++;
      } else if (item.action === 'update') {
        const realId = idMap[item.id] || item.id;
        await base44.entities.Apartacao.update(realId, item.data);
        await deletePendingApartacao(item._offlineId);
        successCount++;
      } else if (item.action === 'delete') {
        const realId = idMap[item.id] || item.id;
        if (!realId.startsWith('offline_')) {
          await base44.entities.Apartacao.delete(realId);
        }
        await deletePendingApartacao(item._offlineId);
        successCount++;
      }
    } catch (error) {
      console.error('Erro ao sincronizar apartação:', error);
      errors.push({ item, error: error.message });
      // Remover da fila mesmo com erro para evitar loop infinito
      await deletePendingApartacao(item._offlineId);
    }
  }

  return { successCount, errors, total: pending.length, idMap };
};

export const syncLotes = async (apartacaoIdMap = {}) => {
  const pending = await getPendingLotes();
  let successCount = 0;
  const errors = [];
  const processedOfflineIds = new Set(); // Evitar duplicação

  const sorted = [...pending].sort((a, b) => {
    const order = { create: 0, update: 1, delete: 2 };
    return (order[a.action] || 0) - (order[b.action] || 0);
  });

  for (const item of sorted) {
    try {
      if (item.action === 'create') {
        const offlineId = item.data?.id;
        
        // Evitar processar o mesmo item offline duas vezes
        if (offlineId && processedOfflineIds.has(offlineId)) {
          await deletePendingLote(item._offlineId);
          continue;
        }
        if (offlineId) processedOfflineIds.add(offlineId);
        
        const { _offlineId, id, created_date, _isOffline, ...data } = item.data;
        
        // Se apartacao_id era offline, usar o ID real
        if (data.apartacao_id?.startsWith('offline_') && apartacaoIdMap[data.apartacao_id]) {
          data.apartacao_id = apartacaoIdMap[data.apartacao_id];
        }
        
        await base44.entities.LoteApartacao.create(data);
        await deletePendingLote(item._offlineId);
        successCount++;
      } else if (item.action === 'update') {
        await base44.entities.LoteApartacao.update(item.id, item.data);
        await deletePendingLote(item._offlineId);
        successCount++;
      } else if (item.action === 'delete') {
        if (!item.id.startsWith('offline_')) {
          await base44.entities.LoteApartacao.delete(item.id);
        }
        await deletePendingLote(item._offlineId);
        successCount++;
      }
    } catch (error) {
      console.error('Erro ao sincronizar lote:', error);
      errors.push({ item, error: error.message });
      // Remover da fila mesmo com erro para evitar loop infinito
      await deletePendingLote(item._offlineId);
    }
  }

  return { successCount, errors, total: pending.length };
};

export const syncAll = async (empresaId) => {
  if (syncInProgress) {
    console.log('Sincronização já em andamento');
    return { success: false, message: 'Sincronização já em andamento' };
  }

  if (!navigator.onLine) {
    return { success: false, message: 'Sem conexão com a internet' };
  }

  syncInProgress = true;
  notifyListeners({ type: 'start' });

  const results = {
    pesagens: { successCount: 0, errors: [], total: 0 },
    apartacoes: { successCount: 0, errors: [], total: 0 },
    lotes: { successCount: 0, errors: [], total: 0 },
  };

  try {
    // Sincronizar apartações primeiro (para obter mapeamento de IDs)
    notifyListeners({ type: 'progress', entity: 'apartacoes' });
    results.apartacoes = await syncApartacoes();

    // Sincronizar lotes usando o mapeamento de IDs das apartações
    notifyListeners({ type: 'progress', entity: 'lotes' });
    results.lotes = await syncLotes(results.apartacoes.idMap || {});

    // Sincronizar pesagens
    notifyListeners({ type: 'progress', entity: 'pesagens' });
    results.pesagens = await syncPesagens(empresaId);

    // Atualizar cache com dados do servidor
    notifyListeners({ type: 'progress', entity: 'cache' });
    await refreshCache(empresaId);

    const totalSuccess = results.pesagens.successCount + results.apartacoes.successCount + results.lotes.successCount;
    const totalErrors = results.pesagens.errors.length + results.apartacoes.errors.length + results.lotes.errors.length;

    notifyListeners({ 
      type: 'complete', 
      success: totalErrors === 0,
      results,
      message: totalSuccess > 0 
        ? `${totalSuccess} registro(s) sincronizado(s)` 
        : 'Nenhum registro pendente'
    });

    return { 
      success: true, 
      results,
      totalSuccess,
      totalErrors 
    };
  } catch (error) {
    console.error('Erro na sincronização:', error);
    notifyListeners({ type: 'error', error: error.message });
    return { success: false, error: error.message };
  } finally {
    syncInProgress = false;
  }
};

export const refreshCache = async (empresaId) => {
  if (!navigator.onLine) return;

  try {
    const [pesagens, apartacoes, lotes] = await Promise.all([
      base44.entities.PesagemIndividual.list('-data_pesagem'),
      base44.entities.Apartacao.list(),
      base44.entities.LoteApartacao.list(),
    ]);

    const pesagensEmpresa = pesagens.filter(p => p.empresa_id === empresaId);
    const apartacoesEmpresa = apartacoes.filter(a => a.empresa_id === empresaId);
    const lotesEmpresa = lotes.filter(l => l.empresa_id === empresaId);

    await Promise.all([
      cachePesagens(pesagensEmpresa),
      cacheApartacoes(apartacoesEmpresa),
      cacheLotes(lotesEmpresa),
    ]);

    return { pesagens: pesagensEmpresa, apartacoes: apartacoesEmpresa, lotes: lotesEmpresa };
  } catch (error) {
    console.error('Erro ao atualizar cache:', error);
    throw error;
  }
};

export const isSyncing = () => syncInProgress;

export const getStatus = async () => {
  const counts = await getPendingCounts();
  return {
    isOnline: navigator.onLine,
    isSyncing: syncInProgress,
    pending: counts,
  };
};

// Registrar para sincronização automática quando a conexão voltar
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    console.log('Conexão restaurada - iniciando sincronização automática');
    const empresaId = localStorage.getItem('empresa_selecionada_id');
    if (empresaId) {
      const counts = await getPendingCounts();
      if (counts.total > 0) {
        await syncAll(empresaId);
      }
    }
  });
}

export default {
  syncPesagens,
  syncApartacoes,
  syncLotes,
  syncAll,
  refreshCache,
  isSyncing,
  getStatus,
  addSyncListener,
};