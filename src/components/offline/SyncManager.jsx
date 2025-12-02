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
  
  if (pending.length === 0) {
    return { successCount: 0, errors: [], total: 0 };
  }
  
  let successCount = 0;
  const errors = [];

  // Processar um por vez para evitar duplicação
  for (let i = 0; i < pending.length; i++) {
    const pesagem = pending[i];
    const offlineId = pesagem._offlineId;
    
    try {
      const { _offlineId, _offlineTimestamp, _synced, _editId, _action, _isOffline, ...data } = pesagem;
      
      // Verificar se é uma edição ou criação
      if (_action === 'update' && _editId) {
        await base44.entities.PesagemIndividual.update(_editId, data);
      } else {
        await base44.entities.PesagemIndividual.create(data);
      }
      
      successCount++;
    } catch (error) {
      console.error('Erro ao sincronizar pesagem:', error);
      errors.push({ pesagem, error: error.message });
    }
    
    // SEMPRE remover após processar (sucesso ou erro)
    try {
      await deletePendingPesagem(offlineId);
    } catch (e) {
      console.error('Erro ao remover pendente:', e);
    }
  }

  return { successCount, errors, total: pending.length };
};

export const syncApartacoes = async (empresaId) => {
  // Limpar fila antiga de pendentes (não usamos mais)
  const oldPending = await getPendingApartacoes();
  for (const p of oldPending) {
    await deletePendingApartacao(p._offlineId);
  }
  return { successCount: 0, errors: [], total: 0, idMap: {} };
};

export const syncLotes = async (empresaId, apartacaoIdMap = {}) => {
  // Limpar fila antiga de pendentes (não usamos mais)
  const oldPending = await getPendingLotes();
  for (const p of oldPending) {
    await deletePendingLote(p._offlineId);
  }
  return { successCount: 0, errors: [], total: 0 };
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
    results.apartacoes = await syncApartacoes(empresaId);

    // Sincronizar lotes usando o mapeamento de IDs das apartações
    notifyListeners({ type: 'progress', entity: 'lotes' });
    results.lotes = await syncLotes(empresaId, results.apartacoes.idMap || {});

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