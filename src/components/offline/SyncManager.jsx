// Sync Manager - Gerencia sincronização de dados offline
// VERSÃO COM VERIFICAÇÃO DE DUPLICADOS
import { base44 } from '@/api/base44Client';
import {
  getPendingPesagens,
  deletePendingPesagem,
  cachePesagens,
  cacheApartacoes,
  cacheLotes,
  getPendingCounts,
  getAllItems,
  deleteItem,
  clearStore,
  STORES_NAMES,
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
      console.error('Erro no listener:', e);
    }
  });
};

export const syncPesagens = async (empresaId, onProgress) => {
  const allPending = await getAllItems(STORES_NAMES.PENDING_PESAGENS);
  const pending = allPending.filter(p => p.empresa_id === empresaId);
  
  if (pending.length === 0) {
    return { successCount: 0, errors: [], total: 0, items: [] };
  }

  // Buscar pesagens existentes no servidor para verificar duplicados
  let existingPesagens = [];
  try {
    existingPesagens = await base44.entities.PesagemIndividual.filter({ empresa_id: empresaId });
  } catch (e) {
    console.error('Erro ao buscar pesagens existentes:', e);
  }
  
  let successCount = 0;
  const errors = [];
  const items = [];

  for (let i = 0; i < pending.length; i++) {
    const pesagem = pending[i];
    const offlineId = pesagem._offlineId;
    const itemName = `Animal: ${pesagem.numero_animal} - ${pesagem.peso}kg`;
    
    // Notificar progresso
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: pending.length,
        currentItem: itemName
      });
    }
    
    try {
      const { _offlineId, _offlineTimestamp, _synced, _editId, _action, _isOffline, ...data } = pesagem;
      
      // Verificar se já existe no servidor (mesmo animal, mesma data, mesmo peso)
      const duplicado = existingPesagens.find(e => 
        e.numero_animal === data.numero_animal && 
        e.data_pesagem === data.data_pesagem &&
        e.peso === data.peso
      );
      
      if (duplicado) {
        items.push({ name: itemName, status: 'skip', message: 'Já existe' });
        await deletePendingPesagem(offlineId);
        continue;
      }
      
      if (_action === 'update' && _editId) {
        await base44.entities.PesagemIndividual.update(_editId, data);
        items.push({ name: itemName, status: 'success', message: 'Atualizado' });
      } else {
        await base44.entities.PesagemIndividual.create(data);
        items.push({ name: itemName, status: 'success', message: 'Criado' });
      }
      
      successCount++;
    } catch (error) {
      console.error('Erro sync pesagem:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: error.message?.substring(0, 30) });
    }
    
    // SEMPRE remover após processar
    await deletePendingPesagem(offlineId);
  }

  return { successCount, errors, total: pending.length, items };
};

// Sincronizar apartações e lotes offline para o servidor
export const syncOfflineEntities = async (empresaId, onProgress) => {
  let successCount = 0;
  const idMap = {};
  const items = [];

  // Buscar apartações existentes no servidor
  let existingApartacoes = [];
  let existingLotes = [];
  try {
    existingApartacoes = await base44.entities.Apartacao.filter({ empresa_id: empresaId });
    existingLotes = await base44.entities.LoteApartacao.filter({ empresa_id: empresaId });
  } catch (e) {
    console.error('Erro ao buscar entidades existentes:', e);
  }

  // Buscar apartações offline do cache
  const cachedApartacoes = await getAllItems(STORES_NAMES.APARTACOES);
  const offlineApartacoes = cachedApartacoes.filter(a => 
    a.empresa_id === empresaId && a._isOffline && a.id?.startsWith('offline_')
  );

  // Buscar lotes offline do cache
  const cachedLotes = await getAllItems(STORES_NAMES.LOTES);
  const offlineLotes = cachedLotes.filter(l => 
    l.empresa_id === empresaId && l._isOffline && l.id?.startsWith('offline_')
  );

  const totalEntities = offlineApartacoes.length + offlineLotes.length;
  let current = 0;

  // Criar apartações no servidor (verificando duplicados)
  for (const apt of offlineApartacoes) {
    current++;
    const itemName = `Apartação: ${apt.nome_apartacao}`;
    
    if (onProgress) {
      onProgress({ current, total: totalEntities, currentItem: itemName });
    }
    
    try {
      const { id, _isOffline, _offlineTimestamp, ...data } = apt;
      
      // Verificar duplicado por nome
      const duplicado = existingApartacoes.find(e => 
        e.nome_apartacao?.toLowerCase() === data.nome_apartacao?.toLowerCase()
      );
      
      if (duplicado) {
        idMap[id] = duplicado.id;
        items.push({ name: itemName, status: 'skip', message: 'Já existe' });
        await deleteItem(STORES_NAMES.APARTACOES, id);
        continue;
      }
      
      const created = await base44.entities.Apartacao.create(data);
      idMap[id] = created.id;
      successCount++;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      
      await deleteItem(STORES_NAMES.APARTACOES, id);
    } catch (e) {
      console.error('Erro ao sincronizar apartação:', e);
      items.push({ name: itemName, status: 'error', message: e.message?.substring(0, 30) });
      await deleteItem(STORES_NAMES.APARTACOES, apt.id);
    }
  }

  // Criar lotes no servidor (verificando duplicados)
  for (const lote of offlineLotes) {
    current++;
    const itemName = `Lote: ${lote.nome_lote}`;
    
    if (onProgress) {
      onProgress({ current, total: totalEntities, currentItem: itemName });
    }
    
    try {
      const { id, _isOffline, _offlineTimestamp, ...data } = lote;
      
      // Atualizar apartacao_id se era offline
      if (data.apartacao_id && idMap[data.apartacao_id]) {
        data.apartacao_id = idMap[data.apartacao_id];
      }
      
      // Verificar duplicado por nome na mesma apartação
      const duplicado = existingLotes.find(e => 
        e.apartacao_id === data.apartacao_id &&
        e.nome_lote?.toLowerCase() === data.nome_lote?.toLowerCase()
      );
      
      if (duplicado) {
        items.push({ name: itemName, status: 'skip', message: 'Já existe' });
        await deleteItem(STORES_NAMES.LOTES, id);
        continue;
      }
      
      await base44.entities.LoteApartacao.create(data);
      successCount++;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      
      await deleteItem(STORES_NAMES.LOTES, id);
    } catch (e) {
      console.error('Erro ao sincronizar lote:', e);
      items.push({ name: itemName, status: 'error', message: e.message?.substring(0, 30) });
      await deleteItem(STORES_NAMES.LOTES, lote.id);
    }
  }

  return { successCount, idMap, items };
};

export const syncAll = async (empresaId) => {
  if (syncInProgress) {
    return { success: false, message: 'Sincronização em andamento' };
  }

  if (!navigator.onLine) {
    return { success: false, message: 'Sem conexão' };
  }

  syncInProgress = true;
  processedIds.clear(); // Limpar IDs processados
  notifyListeners({ type: 'start' });

  try {
    // 1. Sincronizar apartações e lotes offline
    notifyListeners({ type: 'progress', entity: 'apartacoes_lotes' });
    const entitiesResult = await syncOfflineEntities(empresaId);

    // 2. Sincronizar pesagens pendentes
    notifyListeners({ type: 'progress', entity: 'pesagens' });
    const pesagensResult = await syncPesagens(empresaId);

    // 3. Atualizar cache com dados do servidor
    notifyListeners({ type: 'progress', entity: 'cache' });
    await refreshCache(empresaId);

    const totalSuccess = pesagensResult.successCount + entitiesResult.successCount;

    notifyListeners({ 
      type: 'complete', 
      success: true,
      message: totalSuccess > 0 ? `${totalSuccess} sincronizado(s)` : 'Tudo sincronizado'
    });

    return { success: true, totalSuccess };
  } catch (error) {
    console.error('Erro sync:', error);
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

    // LIMPAR completamente os caches antes de recarregar (evita dados offline residuais)
    await Promise.all([
      clearStore(STORES_NAMES.PESAGENS),
      clearStore(STORES_NAMES.APARTACOES),
      clearStore(STORES_NAMES.LOTES),
    ]);

    // Recarregar com dados do servidor
    await Promise.all([
      cachePesagens(pesagensEmpresa),
      cacheApartacoes(apartacoesEmpresa),
      cacheLotes(lotesEmpresa),
    ]);

    return { pesagens: pesagensEmpresa, apartacoes: apartacoesEmpresa, lotes: lotesEmpresa };
  } catch (error) {
    console.error('Erro refresh cache:', error);
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

// Auto-sync quando conexão voltar
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    console.log('Conexão restaurada');
    const empresaId = localStorage.getItem('empresa_selecionada_id');
    if (empresaId) {
      setTimeout(() => syncAll(empresaId), 1000);
    }
  });
}

export default {
  syncPesagens,
  syncOfflineEntities,
  syncAll,
  refreshCache,
  isSyncing,
  getStatus,
  addSyncListener,
};