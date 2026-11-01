/**
 * MAIKE-LOTES-PR167-R2 — exclusão de Lote NUNCA passa pela fila offline.
 *
 * Exports reais do domínio Lote (`deleteLote` de `@/apis/lotes`, `excluirLote`
 * de `loteCadastroService`) com o `lotePort` REAL: só o IndexedDB vira um
 * armazenamento em memória com a mesma API (`IndexedDBManager`) e só o HTTP é
 * falso (`nativeRequest` grava cada chamada). Antes desta correção, offline,
 * `lotePort.delete` tirava o lote do cache e ENFILEIRAVA `operation:'delete'`,
 * que o replay despacharia ao reconectar.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const banco = vi.hoisted(() => {
  const stores = new Map();
  let seq = 1;
  const loja = (nome) => { if (!stores.has(nome)) stores.set(nome, new Map()); return stores.get(nome); };
  const chave = (nome, item) => (nome === 'entity_cache' ? item.cache_key : item.id);
  return {
    stores,
    reset: () => { stores.clear(); seq = 1; },
    api: {
      STORES_NAMES: { ENTITY_CACHE: 'entity_cache', ENTITY_QUEUE: 'entity_queue' },
      getItem: async (nome, k) => loja(nome).get(k),
      putItem: async (nome, item) => { loja(nome).set(chave(nome, item), item); },
      getAllItems: async (nome) => [...loja(nome).values()],
      addItem: async (nome, item) => { const id = seq++; loja(nome).set(id, { ...item, id }); return id; },
      deleteItem: async (nome, k) => { loja(nome).delete(k); },
    },
  };
});
const http = vi.hoisted(() => ({ chamadas: [], respostas: {} }));

vi.mock('@/components/offline/IndexedDBManager', () => banco.api);
vi.mock('@/apis/_core/nativeHttpClient.js', () => ({
  nativeRequest: async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    http.chamadas.push(`${metodo} ${caminho}`);
    const r = http.respostas[`${metodo} ${caminho}`] ?? http.respostas[metodo];
    if (typeof r === 'function') return r();
    if (r instanceof Error) throw r;
    return r;
  },
}));
vi.mock('@/services/mapaCacheService', () => ({ updateMapaCachedData: vi.fn(async () => []), refreshMapaCacheEntry: vi.fn() }));

// O jsdom não tem IndexedDB: sem isto o runtime devolveria as operações cruas.
globalThis.indexedDB = globalThis.indexedDB || /** @type {any} */ ({});

const { deleteLote, listLotes } = await import('@/apis/lotes');
const { excluirLote } = await import('@/services/loteCadastroService');
const runtime = await import('@/lib/offline/offlineEntityRuntime');
const { setOfflineTenant, clearOfflineTenant } = await import('@/lib/offline/offlineTenant');

const X = { id: 'lote-x', empresa_id: 'emp-1', nome: 'NELORE' };
const Y = { id: 'lote-y', empresa_id: 'emp-1', nome: 'NELORE' };
const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
const fila = () => [...(banco.stores.get('entity_queue')?.values() || [])];
const cacheLote = () =>
  [...(banco.stores.get('entity_cache')?.values() || [])].filter((r) => r.entity_name === 'Lote').map((r) => ({ cliente: r.cliente_id, ids: (r.items || []).map((i) => i.id) }));
const deletesHttp = () => http.chamadas.filter((c) => c.startsWith('DELETE'));

beforeEach(async () => {
  banco.reset();
  http.chamadas = [];
  http.respostas = { 'GET /lotes': [X, Y], DELETE: undefined };
  online(true);
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  setOfflineTenant('cli-a');
  await listLotes(); // cache online da entidade Lote (tenant A)
});
afterEach(() => {
  online(true);
  clearOfflineTenant();
});

describe('PR167-R2 — deleteLote / excluirLote offline: falha fechada', () => {
  for (const [nome, chamar] of [['deleteLote (@/apis/lotes)', (id) => deleteLote(id)], ['excluirLote (loteCadastroService)', (id) => excluirLote(id)]]) {
    it(`${nome}: ZERO HTTP, ZERO delete na fila, cache intacto, erro tipado`, async () => {
      online(false);
      const erro = await chamar(X.id).then(() => null, (e) => e);
      expect(erro?.code).toBe('OFFLINE_DELETE_FORBIDDEN');
      expect(deletesHttp()).toEqual([]);
      expect(fila().filter((f) => f.operation === 'delete')).toEqual([]);
      expect(cacheLote()).toEqual([{ cliente: 'cli-a', ids: [X.id, Y.id] }]);
      expect((await listLotes()).map((l) => l.id)).toEqual([X.id, Y.id]); // offline, do cache
    });
  }
});

describe('PR167-R2 — online: só 204 definitivo mexe no cache', () => {
  it('204: DELETE chega ao servidor e o lote sai do cache do tenant', async () => {
    await deleteLote(X.id);
    expect(deletesHttp()).toEqual([`DELETE /lotes/${X.id}`]);
    expect(cacheLote()).toEqual([{ cliente: 'cli-a', ids: [Y.id] }]);
    expect(fila()).toEqual([]);
  });

  for (const [nome, falha] of [
    ['409', Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'LOTE_DELETE_BLOCKED' } })],
    ['404', Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'LOTE_NOT_FOUND' } })],
    ['timeout', Object.assign(new Error('timeout'), { code: 'API_PROVIDER_UNAVAILABLE' })],
    ['conexão caiu antes do HTTP', new TypeError('Failed to fetch')],
  ]) {
    it(`${nome}: erro propagado, nenhuma remoção otimista, nada na fila`, async () => {
      http.respostas.DELETE = falha;
      const erro = await deleteLote(X.id).then(() => null, (e) => e);
      expect(erro).toBeTruthy();
      expect(cacheLote()).toEqual([{ cliente: 'cli-a', ids: [X.id, Y.id] }]);
      expect(fila()).toEqual([]);
    });
  }
});

describe('PR167-R2 — delete LEGADO já gravado na fila por versão anterior', () => {
  const legado = (extra = {}) => ({
    entity_name: 'Lote', empresa_id: 'emp-1', cliente_id: 'cli-a', operation: 'delete', record_id: X.id, data: { id: X.id }, created_at: '2026-10-01T00:00:00.000Z', ...extra,
  });

  it('replay: nenhum DELETE enviado; item fica na fila em QUARENTENA; o resto da fila segue', async () => {
    const outra = vi.fn(async (id, dados) => ({ id, ...dados }));
    runtime.createOfflineEntityAdapter({ entityName: 'OutraEntidade', tenantScoped: true, operations: { list: async () => [], update: outra } });
    await banco.api.addItem('entity_queue', legado());
    await banco.api.addItem('entity_queue', { entity_name: 'OutraEntidade', empresa_id: 'emp-1', cliente_id: 'cli-a', operation: 'update', record_id: 'o-1', data: { a: 1 }, created_at: '2026-10-02T00:00:00.000Z' });

    const r = await runtime.syncOfflineEntityQueue();
    expect(deletesHttp()).toEqual([]);
    expect(outra).toHaveBeenCalledWith('o-1', { a: 1 }); // outra entidade não foi travada
    expect(r.quarentenados).toBe(1);
    expect(r.code).toBe('OFFLINE_DELETE_QUARANTINED');
    const restante = fila();
    expect(restante.map((f) => [f.entity_name, f.operation])).toEqual([['Lote', 'delete']]);
    expect(restante[0].quarentena?.codigo).toBe('OFFLINE_DELETE_QUARANTINED');

    // Replay de novo: continua sem DELETE (idempotente), nada se perde.
    await runtime.syncOfflineEntityQueue();
    expect(deletesHttp()).toEqual([]);
    expect(fila()).toHaveLength(1);
  });

  it('offline, o delete legado não esconde o lote (ele não foi excluído no servidor)', async () => {
    await banco.api.addItem('entity_queue', legado());
    online(false);
    expect((await listLotes()).map((l) => l.id)).toEqual([X.id, Y.id]);
  });

  it('pendência retida bloqueia a exclusão pela tela com motivo explícito; liberar é ação manual e só tira a retenção', async () => {
    const { excluirLotes } = await import('@/services/loteCadastroService');
    const id = await banco.api.addItem('entity_queue', legado());
    const r = await excluirLotes([X.id], { lotes: [X, Y] });
    expect(r.bloqueados).toMatchObject([{ id: X.id, motivo: 'exclusao_offline_retida' }]);
    expect(deletesHttp()).toEqual([]);

    // Liberação manual: remove SÓ o item retido (nenhum HTTP, nenhum dado do servidor tocado).
    expect(await runtime.liberarExclusaoOfflineRetida(id)).toBe(true);
    expect(fila()).toEqual([]);
    expect(deletesHttp()).toEqual([]);
    // Liberar algo que não é delete retido de Lote é recusado.
    const upd = await banco.api.addItem('entity_queue', { ...legado(), operation: 'update', data: { a: 1 } });
    expect(await runtime.liberarExclusaoOfflineRetida(upd)).toBe(false);
    expect(fila()).toHaveLength(1);
  });

  it('item de OUTRO tenant: nem quarentena, nem envio, nem liberação', async () => {
    const id = await banco.api.addItem('entity_queue', legado({ cliente_id: 'cli-b' }));
    await runtime.syncOfflineEntityQueue();
    expect(deletesHttp()).toEqual([]);
    expect(fila()[0].quarentena).toBeUndefined();
    expect(await runtime.liberarExclusaoOfflineRetida(id)).toBe(false);
    expect(fila()).toHaveLength(1);
  });
});

describe('PR167-R2 — sem regressão: criar e editar Lote offline continuam na fila', () => {
  it('update offline enfileira e aparece no cache; delete continua proibido', async () => {
    const { updateLote } = await import('@/apis/lotes');
    online(false);
    await updateLote(Y.id, { nome: 'NOVO' });
    expect(fila().map((f) => [f.operation, f.record_id])).toEqual([['update', Y.id]]);
    expect((await listLotes()).find((l) => l.id === Y.id)?.nome).toBe('NOVO');
    expect((await deleteLote(Y.id).then(() => null, (e) => e))?.code).toBe('OFFLINE_DELETE_FORBIDDEN');
    expect(fila().map((f) => f.operation)).toEqual(['update']);
  });
});

describe('PR167-R2 F — corrida com outra aba (sem mutex entre IndexedDB e HTTP)', () => {
  it('outra aba grava edição offline do lote DEPOIS da checagem e da exclusão: o replay falha de forma recuperável, sem perder a fila', async () => {
    const { excluirLotes } = await import('@/services/loteCadastroService');
    // Esta aba: checagem sem pendência → DELETE 204.
    const r = await excluirLotes([X.id], { lotes: [X, Y] });
    expect(r.excluidos).toEqual([X.id]);
    // "Outra aba" (mesmo IndexedDB) tinha editado offline e grava agora na fila.
    await banco.api.addItem('entity_queue', {
      entity_name: 'Lote', empresa_id: 'emp-1', cliente_id: 'cli-a', operation: 'update', record_id: X.id, data: { nome: 'EDITADO' }, created_at: '2026-11-01T00:00:00.000Z',
    });
    // Replay: o servidor responde 404 ao PATCH do lote excluído.
    http.respostas[`PATCH /lotes/${X.id}`] = Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'LOTE_NOT_FOUND' } });
    const s = await runtime.syncOfflineEntityQueue();
    expect(s.success).toBe(false);
    expect(s.error?.cause?.code).toBe('LOTE_NOT_FOUND');
    expect(fila().map((f) => [f.operation, f.record_id])).toEqual([['update', X.id]]); // nada descartado em silêncio
    expect(deletesHttp()).toEqual([`DELETE /lotes/${X.id}`]); // só o DELETE online confirmado
  });
});

describe('PR167-R2 — pré-check da tela', () => {
  it('consultarExclusaoDeLotes: delete retido → bloqueado (exclusao_offline_retida) sem nem consultar o servidor', async () => {
    const { consultarExclusaoDeLotes } = await import('@/services/loteCadastroService');
    await banco.api.addItem('entity_queue', {
      entity_name: 'Lote', empresa_id: 'emp-1', cliente_id: 'cli-a', operation: 'delete', record_id: X.id, data: { id: X.id }, created_at: '2026-10-01T00:00:00.000Z',
    });
    http.chamadas = [];
    const r = await consultarExclusaoDeLotes([X.id]);
    expect(r).toEqual([{ id: X.id, tipo: 'bloqueado', motivo: 'exclusao_offline_retida' }]);
    expect(http.chamadas).toEqual([]);
  });
});
