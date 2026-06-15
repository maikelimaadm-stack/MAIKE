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
  getPendingTarefas,
  deletePendingTarefa,
  getAllPendingTarefaImages,
  deleteTarefaImageOffline,
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

const PHASE_LABELS = {
  entities: 'Apartações e lotes',
  embarques_docs: 'Embarques e documentos',
  updates: 'Atualizações pendentes',
  pesagens: 'Pesagens individuais',
  sanidade: 'Sanidade',
  tarefas: 'Tarefas do mapa',
  cache: 'Atualização do cache',
  duplicados: 'Verificação de duplicados',
};

const getErrorMessage = (error) => {
  if (error?.response?.data?.error) return String(error.response.data.error);
  if (error?.response?.data?.message) return String(error.response.data.message);
  if (error?.message) return String(error.message);
  return String(error || 'Erro desconhecido');
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // Controle de SN sequencial (SN1, SN2, ...)
  const getMaxSnFromList = (list) => {
    let max = 0;
    list.forEach((p) => {
      const m = String(p.numero_animal || '').toUpperCase().match(/^SN\s*(\d+)$/);
      if (m) {
        const n = parseInt(m[1]);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return max;
  };
  let snCounter = getMaxSnFromList(existingPesagens);

  for (let i = 0; i < pending.length; i++) {
    const pesagem = pending[i];
    const offlineId = pesagem._offlineId;
    const itemName = `Animal: ${pesagem.numero_animal} - ${pesagem.peso}kg`;

    // Se vier SN puro do offline, normalizar para evitar conflito local também
    if (String(pesagem.numero_animal || '').trim().toUpperCase() === 'SN') {
      snCounter += 1;
      pesagem.numero_animal = `SN${snCounter}`;
    }
    
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
      
      // Gerar número sequencial para 'SN'
      if (String(data.numero_animal || '').trim().toUpperCase() === 'SN') {
        snCounter += 1;
        data.numero_animal = `SN${snCounter}`;
      }
      
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
        onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'skip', message: 'Já existe' } });
        await deletePendingPesagem(offlineId);
        continue;
      }
      
      if (_action === 'update' && _editId) {
        await base44.entities.PesagemIndividual.update(_editId, data);
        items.push({ name: itemName, status: 'success', message: 'Atualizado' });
        onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Atualizado' } });
      } else {
        await base44.entities.PesagemIndividual.create(data);
        items.push({ name: itemName, status: 'success', message: 'Criado' });
        onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Criado' } });
      }
      
      successCount++;
      // Remover da fila apenas em sucesso
      await deletePendingPesagem(offlineId);
    } catch (error) {
      console.error('Erro sync pesagem:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: getErrorMessage(error) });
      onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(error) } });
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
        onProgress?.({ current, total, currentItem: itemName, item: { name: itemName, status: 'skip', message: 'Já existe' } });
        await deleteItem(STORES_NAMES.EMBARQUES, id);
        continue;
      }
      const created = await base44.entities.Embarque.create(data);
      idMap[id] = created.id;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      onProgress?.({ current, total, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Criado' } });
      successCount++;
      await deleteItem(STORES_NAMES.EMBARQUES, id);
    } catch (e) {
      console.error('Erro sync embarque:', e);
      items.push({ name: itemName, status: 'error', message: getErrorMessage(e) });
      onProgress?.({ current, total, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(e) } });
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
        onProgress?.({ current, total, currentItem: itemName, item: { name: itemName, status: 'skip', message: 'Já existe' } });
        await deleteItem(STORES_NAMES.DOCUMENTOS_EMBARQUE, id);
        continue;
      }
      const created = await base44.entities.DocumentoEmbarque.create(data);
      idMap[id] = created.id;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      onProgress?.({ current, total, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Criado' } });
      successCount++;
      await deleteItem(STORES_NAMES.DOCUMENTOS_EMBARQUE, id);
    } catch (e) {
      console.error('Erro sync documento:', e);
      items.push({ name: itemName, status: 'error', message: getErrorMessage(e) });
      onProgress?.({ current, total, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(e) } });
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
        onProgress?.({ current, total: totalEntities, currentItem: itemName, item: { name: itemName, status: 'skip', message: 'Já existe' } });
        await deleteItem(STORES_NAMES.APARTACOES, id);
        continue;
      }
      
      const created = await base44.entities.Apartacao.create(data);
      idMap[id] = created.id;
      successCount++;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      onProgress?.({ current, total: totalEntities, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Criado' } });
      
      await deleteItem(STORES_NAMES.APARTACOES, id);
    } catch (e) {
      console.error('Erro ao sincronizar apartação:', e);
      items.push({ name: itemName, status: 'error', message: getErrorMessage(e) });
      onProgress?.({ current, total: totalEntities, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(e) } });
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
        onProgress?.({ current, total: totalEntities, currentItem: itemName, item: { name: itemName, status: 'skip', message: 'Já existe' } });
        await deleteItem(STORES_NAMES.LOTES, id);
        continue;
      }
      
      const created = await base44.entities.LoteApartacao.create(data);
      idMap[oldLoteId] = created.id;
      successCount++;
      items.push({ name: itemName, status: 'success', message: 'Criado' });
      onProgress?.({ current, total: totalEntities, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Criado' } });
      
      await deleteItem(STORES_NAMES.LOTES, id);
    } catch (e) {
      console.error('Erro ao sincronizar lote:', e);
      items.push({ name: itemName, status: 'error', message: getErrorMessage(e) });
      onProgress?.({ current, total: totalEntities, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(e) } });
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
    notifyListeners({ type: 'progress', entity: 'apartacoes_lotes', phaseLabel: PHASE_LABELS.entities });
    const entitiesResult = await syncOfflineEntities(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'entities', phaseLabel: PHASE_LABELS.entities, ...progress });
      }
      if (progress?.item) notifyListeners({ type: 'progress', entity: 'apartacoes_lotes', phaseLabel: PHASE_LABELS.entities, currentItem: progress.currentItem, item: progress.item });
    });
    allItems.push(...(entitiesResult.items || []));

    // 2. Sincronizar Embarques e Documentos
    notifyListeners({ type: 'progress', entity: 'embarques_docs', phaseLabel: PHASE_LABELS.embarques_docs });
    const embDocsResult = await syncEmbarquesDocumentos(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'embarques_docs', phaseLabel: PHASE_LABELS.embarques_docs, ...progress });
      }
      if (progress?.item) notifyListeners({ type: 'progress', entity: 'embarques_docs', phaseLabel: PHASE_LABELS.embarques_docs, currentItem: progress.currentItem, item: progress.item });
    });
    allItems.push(...(embDocsResult.items || []));

    // 3. Sincronizar updates pendentes (edições)
    notifyListeners({ type: 'progress', entity: 'updates', phaseLabel: PHASE_LABELS.updates });
    const updatesResult = await syncUpdates(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'updates', phaseLabel: PHASE_LABELS.updates, ...progress });
      }
      if (progress?.item) notifyListeners({ type: 'progress', entity: 'updates', phaseLabel: PHASE_LABELS.updates, currentItem: progress.currentItem, item: progress.item });
    }, entitiesResult.idMap || {});
    allItems.push(...(updatesResult.items || []));

    // 4. Sincronizar pesagens pendentes (com mapeamento de IDs offline)
    notifyListeners({ type: 'progress', entity: 'pesagens', phaseLabel: PHASE_LABELS.pesagens });
    const mergedIdMap = { ...(entitiesResult.idMap || {}), ...(embDocsResult.idMap || {}) };
    const pesagensResult = await syncPesagens(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'pesagens', phaseLabel: PHASE_LABELS.pesagens, ...progress });
      }
      if (progress?.item) notifyListeners({ type: 'progress', entity: 'pesagens', phaseLabel: PHASE_LABELS.pesagens, currentItem: progress.currentItem, item: progress.item });
    }, mergedIdMap);
    allItems.push(...(pesagensResult.items || []));

    // 5. Sincronizar sanidade pendente
    notifyListeners({ type: 'progress', entity: 'sanidade', phaseLabel: PHASE_LABELS.sanidade });
    const sanidadeResult = await syncSanidade(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'sanidade', phaseLabel: PHASE_LABELS.sanidade, ...progress });
      }
      if (progress?.item) notifyListeners({ type: 'progress', entity: 'sanidade', phaseLabel: PHASE_LABELS.sanidade, currentItem: progress.currentItem, item: progress.item });
    });
    allItems.push(...(sanidadeResult.items || []));

    // 6. Sincronizar tarefas do mapa
    notifyListeners({ type: 'progress', entity: 'tarefas', phaseLabel: PHASE_LABELS.tarefas });
    const tarefasResult = await syncTarefas(empresaId, (progress) => {
      if (onProgress) {
        onProgress({ phase: 'tarefas', phaseLabel: PHASE_LABELS.tarefas, ...progress });
      }
      if (progress?.item) notifyListeners({ type: 'progress', entity: 'tarefas', phaseLabel: PHASE_LABELS.tarefas, currentItem: progress.currentItem, item: progress.item });
    });
    allItems.push(...(tarefasResult.items || []));

    // 7. Atualizar cache com dados do servidor
    notifyListeners({ type: 'progress', entity: 'cache', phaseLabel: PHASE_LABELS.cache });
    if (onProgress) {
      onProgress({ phase: 'cache', phaseLabel: PHASE_LABELS.cache, current: 1, total: 1, currentItem: 'Atualizando cache...' });
    }
    await refreshCache(empresaId);

    // 7. Remover duplicados automaticamente
    notifyListeners({ type: 'progress', entity: 'duplicados', phaseLabel: PHASE_LABELS.duplicados });
    if (onProgress) {
      onProgress({ phase: 'duplicados', phaseLabel: PHASE_LABELS.duplicados, current: 1, total: 1, currentItem: 'Verificando duplicados...' });
    }
    const duplicadosRemovidos = await removerDuplicados(empresaId);
    if (duplicadosRemovidos > 0) {
      allItems.push({ name: `${duplicadosRemovidos} duplicados removidos`, status: 'success' });
    }

    const totalSuccess = (pesagensResult.successCount || 0) + (entitiesResult.successCount || 0) + (sanidadeResult.successCount || 0) + (updatesResult.successCount || 0) + (embDocsResult.successCount || 0) + (tarefasResult.successCount || 0);
    const totalErrors = allItems.filter((item) => item.status === 'error').length;

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
        onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'skip', message: 'Já existe' } });
        await deletePendingSanidade(offlineId);
      } else {
        await base44.entities.SanidadeAnimal.create(data);
        items.push({ name: itemName, status: 'success', message: 'Criado' });
        onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Criado' } });
        successCount++;
        await deletePendingSanidade(offlineId);
      }
    } catch (error) {
      console.error('Erro sync sanidade:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: getErrorMessage(error) });
      onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(error) } });
    }
  }

  return { successCount, errors, total: pending.length, items };
};

// Sincronizar updates offline (edições de lotes/apartações)
const syncUpdates = async (empresaId, onProgress, idMap = {}) => {
  const pending = await getPendingUpdates();
  const filtered = pending.filter(u => u.data?.empresa_id === empresaId);
  
  if (filtered.length === 0) {
    return { successCount: 0, errors: [], total: 0, items: [] };
  }

  const grouped = Object.values(filtered.reduce((acc, update) => {
    const resolvedId = idMap[update.entity_id] || update.entity_id;
    const key = `${update.entity}:${resolvedId}`;

    if (!acc[key]) {
      acc[key] = {
        ...update,
        entity_id: resolvedId,
        data: { ...update.data },
        mergedOfflineIds: [update._offlineId],
      };
    } else {
      acc[key].data = { ...acc[key].data, ...update.data };
      acc[key].mergedOfflineIds.push(update._offlineId);
    }

    return acc;
  }, {}));
  
  let successCount = 0;
  const errors = [];
  const items = [];

  for (let i = 0; i < grouped.length; i++) {
    const update = grouped[i];
    const itemName = `${update.entity} - ${update.entity_id}`;
    
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: grouped.length,
        currentItem: itemName
      });
    }

    if (String(update.entity_id || '').startsWith('offline_')) {
      items.push({ name: itemName, status: 'skip', message: 'Atualização incorporada ao cadastro offline' });
      onProgress?.({ current: i + 1, total: grouped.length, currentItem: itemName, item: { name: itemName, status: 'skip', message: 'Atualização incorporada ao cadastro offline' } });
      for (const offlineId of update.mergedOfflineIds || []) {
        await deletePendingUpdate(offlineId);
      }
      continue;
    }
    
    try {
      if (update.entity === 'Apartacao') {
        await base44.entities.Apartacao.update(update.entity_id, update.data);
      } else if (update.entity === 'LoteApartacao') {
        await base44.entities.LoteApartacao.update(update.entity_id, update.data);
      }
      items.push({ name: itemName, status: 'success', message: 'Atualizado' });
      onProgress?.({ current: i + 1, total: grouped.length, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Atualizado' } });
      successCount++;
      for (const offlineId of update.mergedOfflineIds || []) {
        await deletePendingUpdate(offlineId);
      }
      await wait(120);
    } catch (error) {
      console.error('Erro sync update:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: getErrorMessage(error) });
      onProgress?.({ current: i + 1, total: grouped.length, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(error) } });
    }
  }

  return { successCount, errors, total: grouped.length, items };
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

// Sincronizar tarefas do mapa criadas/editadas offline (com upload de imagens)
export const syncTarefas = async (empresaId, onProgress) => {
  const pending = await getPendingTarefas(empresaId);
  if (pending.length === 0) return { successCount: 0, errors: [], total: 0, items: [] };

  // Buscar todas imagens offline de uma vez
  const allImages = await getAllPendingTarefaImages();

  let successCount = 0;
  const errors = [];
  const items = [];

  for (let i = 0; i < pending.length; i++) {
    const tarefa = pending[i];
    const offlineId = tarefa._offlineId;
    const itemName = `Tarefa: ${tarefa.titulo || offlineId}`;

    onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName });

    try {
      const { _offlineId, _action, _offlineTimestamp, _pendingImages, ...data } = tarefa;

      // 1. Upload das imagens vinculadas a esta tarefa offline
      const tarefaImages = allImages.filter((img) => img.tarefa_offline_id === offlineId);
      const uploadedUrls = [];

      for (const img of tarefaImages) {
        try {
          const blob = new Blob([img.buffer], { type: img.type });
          const file = new File([blob], img.name, { type: img.type });
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          uploadedUrls.push(file_url);
          await deleteTarefaImageOffline(img._imgId);
        } catch (imgErr) {
          console.error('Erro upload imagem tarefa:', imgErr);
        }
      }

      // Mesclar URLs já existentes com as novas
      const fotos = [...(data.fotos || []), ...uploadedUrls];
      const payload = fotos.length > 0 ? { ...data, fotos } : data;

      // 2. Criar ou atualizar tarefa no servidor
      if (_action === 'update' && data.id && !String(data.id).startsWith('offline_')) {
        const { id, ...updateData } = payload;
        await base44.entities.LancamentoTarefa.update(id, updateData);
        // Histórico de edição
        await base44.entities.HistoricoLancamentoTarefa.create({
          empresa_id: data.empresa_id,
          tarefa_id: id,
          titulo_tarefa: data.titulo,
          evento: 'Edição',
          data_evento: new Date().toISOString(),
          status: data.status,
          responsavel: data.responsavel,
          descricao: 'Tarefa atualizada (sincronizado do offline).',
        });
      } else {
        const { id, ...createData } = payload;
        const created = await base44.entities.LancamentoTarefa.create(createData);
        // Histórico de criação
        await base44.entities.HistoricoLancamentoTarefa.create({
          empresa_id: created.empresa_id,
          tarefa_id: created.id,
          titulo_tarefa: created.titulo,
          evento: 'Criação',
          data_evento: new Date().toISOString(),
          status: created.status,
          responsavel: created.responsavel,
          descricao: 'Tarefa criada pelo mapa (sincronizado do offline).',
        });
      }

      successCount++;
      items.push({ name: itemName, status: 'success', message: 'Sincronizado' });
      onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'success', message: 'Sincronizado' } });
      await deletePendingTarefa(offlineId);
    } catch (error) {
      console.error('Erro sync tarefa:', error);
      errors.push({ error: error.message });
      items.push({ name: itemName, status: 'error', message: getErrorMessage(error) });
      onProgress?.({ current: i + 1, total: pending.length, currentItem: itemName, item: { name: itemName, status: 'error', message: getErrorMessage(error) } });
    }
  }

  return { successCount, errors, total: pending.length, items };
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