// Sync Manager - Gerencia sincronização de dados offline
// VERSÃO COM VERIFICAÇÃO DE DUPLICADOS
import { base44 } from '@/api/base44Client';
import {
  getPendingPesagens,
  deletePendingPesagem,
  getPendingSanidade,
  deletePendingSanidade,
  getPendingUpdates,
  deletePendingUpdate,
  cachePesagens,
  cacheApartacoes,
  cacheLotes,
  getPendingCounts,
  getAllItems,
  deleteItem,
  clearStore,
  STORES_NAMES,
  bulkPut,
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

export const syncPesagens = async (empresaId, onProgress, idMap = {}) => {
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
      
      // Mapear IDs offline de apartação/lote/embarque/documento para IDs reais
      if (data.apartacao_id && idMap[data.apartacao_id]) data.apartacao_id = idMap[data.apartacao_id];
      if (data.lote_id && idMap[data.lote_id]) data.lote_id = idMap[data.lote_id];
      if (data.embarque_id && idMap[data.embarque_id]) data.embarque_id = idMap[data.embarque_id];
      if (data.documento_embarque_id && idMap[data.documento_embarque_id]) data.documento_embarque_id = idMap[data.documento_embarque_id];
      
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
      // Remover da fila apenas em sucesso
      await deletePendingPesagem(offlineId);
    } catch (error) {
      console.error('Erro sync pesagem:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: error.message?.substring(0, 30) });
    }
    
    // Em caso de erro, manter na fila para tentar novamente depois
  }

  return { successCount, errors, total: pending.length, items };
};

// Sincronizar Embarques e Documentos de Embarque criados offline
export const syncEmbarquesDocumentos = async (empresaId, onProgress) => {
  let successCount = 0;
  const items = [];
  const idMap = {};

  // Buscar existentes no servidor
  let existingEmbarques = [];
  let existingDocs = [];
  try {
    existingEmbarques = await base44.entities.Embarque.filter({ empresa_id: empresaId });
    existingDocs = await base44.entities.DocumentoEmbarque.filter({ empresa_id: empresaId });
  } catch (e) {
    console.error('Erro ao buscar embarques/docs existentes:', e);
  }

  // Buscar offline no cache
  const cachedEmbarques = await getAllItems(STORES_NAMES.EMBARQUES);
  const offlineEmbarques = cachedEmbarques.filter(e => e.empresa_id === empresaId && e._isOffline && (e.id?.startsWith('offline_')));

  const cachedDocs = await getAllItems(STORES_NAMES.DOCUMENTOS_EMBARQUE);
  const offlineDocs = cachedDocs.filter(d => d.empresa_id === empresaId && d._isOffline && (d.id?.startsWith('offline_')));

  let current = 0;
  const total = offlineEmbarques.length + offlineDocs.length;

  // Embarques
  for (const emb of offlineEmbarques) {
    current++;
    const itemName = `Embarque: ${emb.nome || emb.id}`;
    onProgress?.({ current, total, currentItem: itemName });
    try {
      const { id, _isOffline, _offlineTimestamp, ...data } = emb;
      // Duplicado por nome+data+frigorifico
      const dup = existingEmbarques.find(e => (e.nome || '').toLowerCase() === (data.nome || '').toLowerCase() && (e.data || null) === (data.data || null) && (e.frigorifico || '') === (data.frigorifico || ''));
      if (dup) {
        idMap[id] = dup.id;
        items.push({ name: itemName, status: 'skip', message: 'Já existe' });
        await deleteItem(STORES_NAMES.EMBARQUES, id);
        continue;
      }
      const created = await base44.entities.Embarque.create(data);
      idMap[id] = created.id;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      successCount++;
      await deleteItem(STORES_NAMES.EMBARQUES, id);
    } catch (e) {
      console.error('Erro sync embarque:', e);
      items.push({ name: itemName, status: 'error', message: e.message?.substring(0, 30) });
    }
  }

  // Documentos
  for (const doc of offlineDocs) {
    current++;
    const itemName = `Documento: ${doc.tipo_documento || ''}-${doc.numero_gta || doc.numero_nfe || ''}`;
    onProgress?.({ current, total, currentItem: itemName });
    try {
      const { id, _isOffline, _offlineTimestamp, ...data } = doc;
      // Mapear embarque se era offline
      if (data.embarque_id && idMap[data.embarque_id]) data.embarque_id = idMap[data.embarque_id];
      // Duplicado por embarque+tipo+números
      const dup = existingDocs.find(d => d.embarque_id === data.embarque_id && (d.tipo_documento || '') === (data.tipo_documento || '') && (d.numero_gta || '') === (data.numero_gta || '') && (d.numero_nfe || '') === (data.numero_nfe || ''));
      if (dup) {
        idMap[id] = dup.id;
        items.push({ name: itemName, status: 'skip', message: 'Já existe' });
        await deleteItem(STORES_NAMES.DOCUMENTOS_EMBARQUE, id);
        continue;
      }
      const created = await base44.entities.DocumentoEmbarque.create(data);
      idMap[id] = created.id;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      successCount++;
      await deleteItem(STORES_NAMES.DOCUMENTOS_EMBARQUE, id);
    } catch (e) {
      console.error('Erro sync documento:', e);
      items.push({ name: itemName, status: 'error', message: e.message?.substring(0, 30) });
    }
  }

  return { successCount, idMap, items };
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
      const oldLoteId = id;
      
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
        idMap[oldLoteId] = duplicado.id;
        items.push({ name: itemName, status: 'skip', message: 'Já existe' });
        await deleteItem(STORES_NAMES.LOTES, id);
        continue;
      }
      
      const created = await base44.entities.LoteApartacao.create(data);
      idMap[oldLoteId] = created.id;
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

export const syncAll = async (empresaId, onProgress) => {
  if (syncInProgress) {
    return { success: false, message: 'Sincronização em andamento' };
  }

  if (!navigator.onLine) {
    return { success: false, message: 'Sem conexão' };
  }

  syncInProgress = true;
  notifyListeners({ type: 'start' });

  const allItems = [];

  try {
    // 1. Sincronizar apartações e lotes offline
    notifyListeners({ type: 'progress', entity: 'apartacoes_lotes' });
    const entitiesResult = await syncOfflineEntities(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'entities', ...progress });
      }
    });
    allItems.push(...(entitiesResult.items || []));

    // 2. Sincronizar Embarques e Documentos
    notifyListeners({ type: 'progress', entity: 'embarques_docs' });
    const embDocsResult = await syncEmbarquesDocumentos(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'embarques_docs', ...progress });
      }
    });
    allItems.push(...(embDocsResult.items || []));

    // 3. Sincronizar updates pendentes (edições)
    notifyListeners({ type: 'progress', entity: 'updates' });
    const updatesResult = await syncUpdates(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'updates', ...progress });
      }
    });
    allItems.push(...(updatesResult.items || []));

    // 4. Sincronizar pesagens pendentes (com mapeamento de IDs offline)
    notifyListeners({ type: 'progress', entity: 'pesagens' });
    const mergedIdMap = { ...(entitiesResult.idMap || {}), ...(embDocsResult.idMap || {}) };
    const pesagensResult = await syncPesagens(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'pesagens', ...progress });
      }
    }, mergedIdMap);
    allItems.push(...(pesagensResult.items || []));

    // 5. Sincronizar sanidade pendente
    notifyListeners({ type: 'progress', entity: 'sanidade' });
    const sanidadeResult = await syncSanidade(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'sanidade', ...progress });
      }
    });
    allItems.push(...(sanidadeResult.items || []));

    // 6. Atualizar cache com dados do servidor
    notifyListeners({ type: 'progress', entity: 'cache' });
    if (onProgress) {
      onProgress({ phase: 'cache', currentItem: 'Atualizando cache...' });
    }
    await refreshCache(empresaId);

    // 7. Remover duplicados automaticamente
    notifyListeners({ type: 'progress', entity: 'duplicados' });
    if (onProgress) {
      onProgress({ phase: 'duplicados', currentItem: 'Verificando duplicados...' });
    }
    const duplicadosRemovidos = await removerDuplicados(empresaId);
    if (duplicadosRemovidos > 0) {
      allItems.push({ name: `${duplicadosRemovidos} duplicados removidos`, status: 'success' });
    }

    const totalSuccess = (pesagensResult.successCount || 0) + (entitiesResult.successCount || 0) + (sanidadeResult.successCount || 0) + (updatesResult.successCount || 0) + (embDocsResult.successCount || 0);
    const totalErrors = (pesagensResult.errors?.length || 0);

    notifyListeners({ 
      type: 'complete', 
      success: true,
      message: totalSuccess > 0 ? `${totalSuccess} sincronizado(s)` : 'Tudo sincronizado',
      results: {
        pesagens: { successCount: pesagensResult.successCount },
        apartacoes: { successCount: entitiesResult.successCount },
        embarques_docs: { successCount: embDocsResult.successCount },
        sanidade: { successCount: sanidadeResult.successCount },
        updates: { successCount: updatesResult.successCount },
        duplicadosRemovidos
      },
      hasErrors: totalErrors > 0
    });

    return { success: true, totalSuccess, totalErrors, items: allItems };
  } catch (error) {
    console.error('Erro sync:', error);
    notifyListeners({ type: 'error', error: error.message });
    return { success: false, error: error.message, items: allItems };
  } finally {
    syncInProgress = false;
  }
};

// Sincronizar sanidade offline
const syncSanidade = async (empresaId, onProgress) => {
  const pending = await getPendingSanidade(empresaId);
  
  if (pending.length === 0) {
    return { successCount: 0, errors: [], total: 0, items: [] };
  }

  let existingSanidade = [];
  try {
    existingSanidade = await base44.entities.SanidadeAnimal.filter({ empresa_id: empresaId });
  } catch (e) {
    console.error('Erro ao buscar sanidade existente:', e);
  }
  
  let successCount = 0;
  const errors = [];
  const items = [];

  for (let i = 0; i < pending.length; i++) {
    const sanidade = pending[i];
    const offlineId = sanidade._offlineId;
    const itemName = `${sanidade.medicamento} - ${sanidade.numero_animal}`;
    
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: pending.length,
        currentItem: itemName
      });
    }
    
    try {
      const { _offlineId, _offlineTimestamp, _synced, ...data } = sanidade;
      
      // Verificar duplicado (mesmo animal, mesma data, mesmo medicamento)
      const duplicado = existingSanidade.find(e => 
        e.numero_animal === data.numero_animal && 
        e.data_aplicacao === data.data_aplicacao &&
        e.medicamento === data.medicamento
      );
      
      if (duplicado) {
        items.push({ name: itemName, status: 'skip', message: 'Já existe' });
      } else {
        await base44.entities.SanidadeAnimal.create(data);
        items.push({ name: itemName, status: 'success', message: 'Criado' });
        successCount++;
      }
    } catch (error) {
      console.error('Erro sync sanidade:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: error.message?.substring(0, 30) });
    }
    
    await deletePendingSanidade(offlineId);
  }

  return { successCount, errors, total: pending.length, items };
};

// Sincronizar updates offline (edições de lotes/apartações)
const syncUpdates = async (empresaId, onProgress) => {
  const pending = await getPendingUpdates();
  const filtered = pending.filter(u => u.data?.empresa_id === empresaId);
  
  if (filtered.length === 0) {
    return { successCount: 0, errors: [], total: 0, items: [] };
  }
  
  let successCount = 0;
  const errors = [];
  const items = [];

  for (let i = 0; i < filtered.length; i++) {
    const update = filtered[i];
    const itemName = `${update.entity} - ${update.entity_id}`;
    
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: filtered.length,
        currentItem: itemName
      });
    }
    
    try {
      if (update.entity === 'Apartacao') {
        await base44.entities.Apartacao.update(update.entity_id, update.data);
      } else if (update.entity === 'LoteApartacao') {
        await base44.entities.LoteApartacao.update(update.entity_id, update.data);
      }
      items.push({ name: itemName, status: 'success', message: 'Atualizado' });
      successCount++;
    } catch (error) {
      console.error('Erro sync update:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: error.message?.substring(0, 30) });
    }
    
    await deletePendingUpdate(update._offlineId);
  }

  return { successCount, errors, total: filtered.length, items };
};

// Função para remover duplicados automaticamente
const removerDuplicados = async (empresaId) => {
  try {
    const pesagens = await base44.entities.PesagemIndividual.filter({ empresa_id: empresaId });
    
    const grupos = {};
    pesagens.forEach(p => {
      const key = `${p.numero_animal}_${p.data_pesagem}_${p.peso}`;
      if (!grupos[key]) {
        grupos[key] = [];
      }
      grupos[key].push(p);
    });

    const duplicados = [];
    Object.values(grupos).forEach(registros => {
      if (registros.length > 1) {
        registros.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        duplicados.push(...registros.slice(1));
      }
    });

    if (duplicados.length === 0) return 0;

    for (const dup of duplicados) {
      try {
        await base44.entities.PesagemIndividual.delete(dup.id);
      } catch (e) {
        console.error('Erro ao remover duplicado:', e);
      }
    }

    return duplicados.length;
  } catch (error) {
    console.error('Erro ao remover duplicados:', error);
    return 0;
  }
};

export const refreshCache = async (empresaId) => {
  if (!navigator.onLine) return;

  try {
    const [pesagens, apartacoes, lotes, embarques, documentos] = await Promise.all([
      base44.entities.PesagemIndividual.list('-data_pesagem'),
      base44.entities.Apartacao.list(),
      base44.entities.LoteApartacao.list(),
      base44.entities.Embarque.list('-updated_date'),
      base44.entities.DocumentoEmbarque.list('-updated_date'),
    ]);

    const pesagensEmpresa = pesagens.filter(p => p.empresa_id === empresaId);
    const apartacoesEmpresa = apartacoes.filter(a => a.empresa_id === empresaId);
    const lotesEmpresa = lotes.filter(l => l.empresa_id === empresaId);
    const embarquesEmpresa = embarques.filter(e => e.empresa_id === empresaId);
    const documentosEmpresa = documentos.filter(d => d.empresa_id === empresaId);

    // LIMPAR completamente os caches antes de recarregar (evita dados offline residuais)
    await Promise.all([
      clearStore(STORES_NAMES.PESAGENS),
      clearStore(STORES_NAMES.APARTACOES),
      clearStore(STORES_NAMES.LOTES),
      clearStore(STORES_NAMES.EMBARQUES),
      clearStore(STORES_NAMES.DOCUMENTOS_EMBARQUE),
    ]);

    // Recarregar com dados do servidor
    await Promise.all([
      cachePesagens(pesagensEmpresa),
      cacheApartacoes(apartacoesEmpresa),
      cacheLotes(lotesEmpresa),
      bulkPut(STORES_NAMES.EMBARQUES, embarquesEmpresa),
      bulkPut(STORES_NAMES.DOCUMENTOS_EMBARQUE, documentosEmpresa),
    ]);

    return { pesagens: pesagensEmpresa, apartacoes: apartacoesEmpresa, lotes: lotesEmpresa, embarques: embarquesEmpresa, documentos: documentosEmpresa };
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
  syncEmbarquesDocumentos,
  syncAll,
  refreshCache,
  isSyncing,
  getStatus,
  addSyncListener,
};