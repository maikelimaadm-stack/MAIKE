// Sync Manager - VERSÃO SIMPLIFICADA SEM DUPLICAÇÃO
import { base44 } from '@/api/base44Client';
import {
  getAllPending,
  deleteItem,
  cachePesagens,
  cacheApartacoes,
  cacheLotes,
  clearAllCache,
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
    try { listener(event); } catch (e) { console.error(e); }
  });
};

export const syncAll = async (empresaId) => {
  if (syncInProgress) {
    return { success: false, message: 'Sincronização em andamento' };
  }

  if (!navigator.onLine) {
    return { success: false, message: 'Sem conexão' };
  }

  syncInProgress = true;
  notifyListeners({ type: 'start' });

  let successCount = 0;
  const errors = [];
  const apartacaoIdMap = {}; // Mapeia ID offline -> ID real

  try {
    const pending = await getAllPending();
    
    // Ordenar: apartações primeiro, depois lotes, depois pesagens
    const sorted = pending.sort((a, b) => {
      const order = { apartacao: 1, lote: 2, pesagem: 3 };
      return (order[a.type] || 99) - (order[b.type] || 99);
    });

    for (const item of sorted) {
      try {
        if (item.type === 'apartacao') {
          // Criar apartação no servidor
          const { _isOffline, id, ...data } = item.data;
          const created = await base44.entities.Apartacao.create({
            ...data,
            empresa_id: empresaId,
          });
          apartacaoIdMap[item.syncId] = created.id;
          successCount++;
        } 
        else if (item.type === 'lote') {
          // Criar lote no servidor (atualizar apartacao_id se necessário)
          const { _isOffline, id, ...data } = item.data;
          let apartacaoId = data.apartacao_id;
          
          // Se apartacao_id é um ID offline, usar o ID real
          if (apartacaoId && apartacaoIdMap[apartacaoId]) {
            apartacaoId = apartacaoIdMap[apartacaoId];
          }
          
          await base44.entities.LoteApartacao.create({
            ...data,
            apartacao_id: apartacaoId,
            empresa_id: empresaId,
          });
          successCount++;
        } 
        else if (item.type === 'pesagem') {
          // Criar ou atualizar pesagem
          const { _syncId, _action, _editId, _isOffline, _offlineTimestamp, ...data } = item.data;
          
          // Atualizar IDs offline para IDs reais
          let apartacaoId = data.apartacao_id;
          if (apartacaoId && apartacaoIdMap[apartacaoId]) {
            apartacaoId = apartacaoIdMap[apartacaoId];
          }
          
          const pesagemData = {
            ...data,
            apartacao_id: apartacaoId,
          };
          
          if (item.action === 'update' && item.editId) {
            await base44.entities.PesagemIndividual.update(item.editId, pesagemData);
          } else {
            await base44.entities.PesagemIndividual.create(pesagemData);
          }
          successCount++;
        }
        
        // Remover da fila após sucesso
        await deleteItem(STORES_NAMES.PENDING_SYNC, item.syncId);
        
      } catch (error) {
        console.error(`Erro ao sincronizar ${item.type}:`, error);
        errors.push({ type: item.type, error: error.message });
        // Remover mesmo com erro para não ficar preso
        await deleteItem(STORES_NAMES.PENDING_SYNC, item.syncId);
      }
    }

    // Atualizar cache com dados do servidor
    await refreshCache(empresaId);

    notifyListeners({ 
      type: 'complete', 
      success: errors.length === 0,
      message: `${successCount} sincronizado(s)`,
      successCount,
      errors,
    });

    return { success: true, successCount, errors };
    
  } catch (error) {
    console.error('Erro geral sync:', error);
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
    console.error('Erro refresh cache:', error);
    throw error;
  }
};

export const isSyncing = () => syncInProgress;

// Auto-sync quando conexão voltar
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    console.log('Conexão restaurada - sincronizando...');
    const empresaId = localStorage.getItem('empresa_selecionada_id');
    if (empresaId) {
      setTimeout(() => syncAll(empresaId), 2000);
    }
  });
}

export default {
  syncAll,
  refreshCache,
  isSyncing,
  addSyncListener,
};