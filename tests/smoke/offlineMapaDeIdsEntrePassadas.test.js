/**
 * D-PROD-204 — o id que o servidor deu a uma criação offline sobrevive entre
 * passadas do replay.
 *
 * O mapa `offline_… → id do servidor` de `syncOfflineEntityQueue` vivia só numa
 * passada. Uma passada que criava a área (o item saía da fila) e parava antes
 * do lote que a cita (503 no lote, ou em qualquer item entre os dois) deixava
 * o lote na fila com o id offline da área; na passada seguinte o mapa estava
 * vazio e o lote ia ao servidor com `offline_…` (FK: fila travada; sem FK, como
 * `Lote.area_atual_id`: referência solta).
 *
 *  (a) área criada na passada 1 + lote com 503 → na passada 2 o lote vai com o
 *      id do servidor da área (e a fila persistida já tem esse id entre as
 *      passadas);
 *  (b) a falha é de um item ENTRE os dois (outra entidade): idem;
 *  (c) edição e exclusão do próprio registro criado offline (`record_id`)
 *      passam a apontar para o id do servidor, inclusive item retido e item
 *      que entrou na fila depois da passada 1 começar;
 *  (d) id offline dentro de lista é trocado; texto que não é id offline
 *      ("constructor", id real) não é tocado;
 *  (e) R2 continua valendo: lote que cita categoria retida fica retido, mas a
 *      área que ele cita já leva o id do servidor; nada é enviado com id offline;
 *  (f) se reescrever a fila falha, a criação NÃO sai da fila (nenhum
 *      dependente fica com id offline sem mapeamento).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

/** Porta em memória com o mesmo contrato do armazenamento IndexedDB. */
const memoria = () => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (k) => [...(cache.get(k) || [])],
    gravarCache: async (k, r) => { cache.set(k, r.items); },
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => { const id = proximo++; fila.set(id, { ...structuredClone(i), id }); return id; },
    atualizarNaFila: async (id, c) => { const a = fila.get(id); if (a) fila.set(id, { ...a, ...structuredClone(c), id }); },
    removerDaFila: async (id) => { fila.delete(id); },
    removerCache: async (k) => { cache.delete(k); },
  };
};

const storage = memoria();

const { createOfflineEntityAdapter, syncOfflineEntityQueue, resetOfflineEntityRuntime } = await import('@/lib/offline/offlineEntityRuntime');
const { setOfflineTenant } = await import('@/lib/offline/offlineTenant');
const { API_ERROR_CODES } = await import('@/apis/_core/ApiError');

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
const erro503 = () => Object.assign(new Error('Service Unavailable'), { status: 503 });

const AREA_OFF = 'offline_AreaPastagem_1700000000000_abc123';
const LOTE_OFF = 'offline_Lote_1700000000001_def456';

let opsArea;
let opsLote;
let opsOutra;

const registrar = () => {
  opsArea = {
    list: vi.fn(async () => []),
    create: vi.fn(async (d) => ({ id: 'area-srv-1', ...d })),
    update: vi.fn(async (id, d) => ({ id, ...d })),
    delete: vi.fn(async () => ({})),
  };
  opsLote = {
    list: vi.fn(async () => []),
    create: vi.fn(async (d) => ({ id: 'lote-srv-1', ...d })),
    update: vi.fn(async (id, d) => ({ id, ...d })),
  };
  opsOutra = { list: vi.fn(async () => []), update: vi.fn(async (id, d) => ({ id, ...d })) };
  createOfflineEntityAdapter({ entityName: 'AreaPastagem', operations: opsArea, storage });
  createOfflineEntityAdapter({ entityName: 'Lote', operations: opsLote, storage });
  createOfflineEntityAdapter({ entityName: 'OutraEntidade', operations: opsOutra, storage });
};

const criacaoDaArea = (extra = {}) => ({
  entity_name: 'AreaPastagem', empresa_id: 'emp-1', operation: 'create', record_id: AREA_OFF,
  data: { id: AREA_OFF, nome: 'PIQUETE 1', _isOffline: true, ...extra }, created_at: '2026-11-01T00:00:00Z',
});
const criacaoDoLote = (data = {}, created_at = '2026-11-01T00:00:02Z') => ({
  entity_name: 'Lote', empresa_id: 'emp-1', operation: 'create', record_id: LOTE_OFF,
  data: { id: LOTE_OFF, nome: 'L1', area_atual_id: AREA_OFF, _isOffline: true, ...data }, created_at,
});
const naFila = (recordId) => [...storage.fila.values()].find((f) => f.record_id === recordId);

beforeEach(() => {
  resetOfflineEntityRuntime();
  storage.fila.clear();
  storage.cache.clear();
  setOfflineTenant('cli-1');
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  online(true);
  registrar();
});

describe('D-PROD-204 — mapa de ids offline entre passadas do replay', () => {
  it('(a) área criada na passada 1 + lote com 503 → na passada 2 o lote vai com o id do servidor da área', async () => {
    await storage.adicionarNaFila(criacaoDaArea());
    await storage.adicionarNaFila(criacaoDoLote());
    opsLote.create.mockRejectedValueOnce(erro503());

    const r1 = await syncOfflineEntityQueue();

    expect(r1.success).toBe(false);
    expect(opsArea.create).toHaveBeenCalledTimes(1);
    expect(opsArea.create).toHaveBeenCalledWith({ nome: 'PIQUETE 1' });
    expect(opsLote.create).toHaveBeenCalledTimes(1);
    expect(opsLote.create).toHaveBeenLastCalledWith({ nome: 'L1', area_atual_id: 'area-srv-1' });
    // entre as passadas, a fila PERSISTIDA já cita o id do servidor
    expect(naFila(AREA_OFF)).toBeUndefined();
    expect(naFila(LOTE_OFF).data.area_atual_id).toBe('area-srv-1');

    const r2 = await syncOfflineEntityQueue();

    expect(r2.success).toBe(true);
    expect(opsArea.create).toHaveBeenCalledTimes(1);
    expect(opsLote.create).toHaveBeenCalledTimes(2);
    expect(opsLote.create).toHaveBeenLastCalledWith({ nome: 'L1', area_atual_id: 'area-srv-1' });
    expect(storage.fila.size).toBe(0);
  });

  it('(b) a falha é de um item ENTRE a área e o lote (outra entidade): o lote vai com o id do servidor na passada 2', async () => {
    await storage.adicionarNaFila(criacaoDaArea());
    await storage.adicionarNaFila({
      entity_name: 'OutraEntidade', empresa_id: 'emp-1', operation: 'update', record_id: 'x1',
      data: { nome: 'Y' }, created_at: '2026-11-01T00:00:01Z',
    });
    await storage.adicionarNaFila(criacaoDoLote());
    opsOutra.update.mockRejectedValueOnce(erro503());

    const r1 = await syncOfflineEntityQueue();
    expect(r1.success).toBe(false);
    expect(opsLote.create).not.toHaveBeenCalled();
    expect(naFila(LOTE_OFF).data.area_atual_id).toBe('area-srv-1');

    const r2 = await syncOfflineEntityQueue();
    expect(r2.success).toBe(true);
    expect(opsLote.create).toHaveBeenCalledWith({ nome: 'L1', area_atual_id: 'area-srv-1' });
    expect(storage.fila.size).toBe(0);
  });

  it('(c) edição e exclusão do registro criado offline passam a apontar para o id do servidor (inclusive retido e item novo)', async () => {
    // exclusão só online: o delete na fila fica retido (quarentena) e não é enviado
    createOfflineEntityAdapter({ entityName: 'AreaPastagem', operations: opsArea, storage, exclusao: 'somente_online' });
    await storage.adicionarNaFila(criacaoDaArea());
    await storage.adicionarNaFila({
      entity_name: 'OutraEntidade', empresa_id: 'emp-1', operation: 'update', record_id: 'x1',
      data: { nome: 'Y' }, created_at: '2026-11-01T00:00:01Z',
    });
    await storage.adicionarNaFila({
      entity_name: 'AreaPastagem', empresa_id: 'emp-1', operation: 'update', record_id: AREA_OFF,
      data: { id: AREA_OFF, nome: 'PIQUETE 1A' }, created_at: '2026-11-01T00:00:02Z',
    });
    // retido na própria passada 1 (antes da falha): não é enviado, mas também é reescrito
    await storage.adicionarNaFila({
      entity_name: 'AreaPastagem', empresa_id: 'emp-1', operation: 'delete', record_id: AREA_OFF,
      created_at: '2026-11-01T00:00:00.500Z',
    });
    opsArea.create.mockImplementationOnce(async (d) => {
      // entra na fila DURANTE a passada 1 (depois de listada): também é reescrito
      await storage.adicionarNaFila({
        entity_name: 'Lote', empresa_id: 'emp-1', operation: 'update', record_id: 'lote-real',
        data: { area_atual_id: AREA_OFF }, created_at: '2026-11-01T00:00:09Z',
      });
      return { id: 'area-srv-1', ...d };
    });
    opsOutra.update.mockRejectedValueOnce(erro503());

    await syncOfflineEntityQueue();

    const editar = [...storage.fila.values()].find((f) => f.entity_name === 'AreaPastagem' && f.operation === 'update');
    expect(editar).toMatchObject({ record_id: 'area-srv-1', data: { id: 'area-srv-1', nome: 'PIQUETE 1A' } });
    const excluir = [...storage.fila.values()].find((f) => f.operation === 'delete');
    expect(excluir.record_id).toBe('area-srv-1');
    expect(excluir.quarentena.codigo).toBe(API_ERROR_CODES.OFFLINE_DELETE_QUARANTINED);
    expect(naFila('lote-real').data.area_atual_id).toBe('area-srv-1');

    const r2 = await syncOfflineEntityQueue();
    expect(opsArea.update).toHaveBeenCalledWith('area-srv-1', { id: 'area-srv-1', nome: 'PIQUETE 1A' });
    expect(opsLote.update).toHaveBeenCalledWith('lote-real', { area_atual_id: 'area-srv-1' });
    expect(opsArea.delete).not.toHaveBeenCalled();
    expect(r2.quarentenados).toBe(1);
    expect([...storage.fila.values()].map((f) => [f.operation, f.record_id])).toEqual([['delete', 'area-srv-1']]);
    expect(JSON.stringify([...opsArea.update.mock.calls, ...opsLote.update.mock.calls])).not.toContain('offline_');
  });

  it('(d) id offline dentro de lista é trocado; texto que não é id offline não é tocado', async () => {
    await storage.adicionarNaFila(criacaoDaArea({ apelido: 'constructor' }));
    await storage.adicionarNaFila(criacaoDoLote({ areas_historico: [AREA_OFF, 'area-real-0'], obs: 'constructor', mapa: { area: AREA_OFF } }));
    opsLote.create.mockRejectedValueOnce(erro503());

    await syncOfflineEntityQueue();

    expect(opsArea.create).toHaveBeenCalledWith({ nome: 'PIQUETE 1', apelido: 'constructor' });
    const data = naFila(LOTE_OFF).data;
    expect(data.areas_historico).toEqual(['area-srv-1', 'area-real-0']);
    expect(data.mapa).toEqual({ area: 'area-srv-1' });
    expect(data.obs).toBe('constructor');
    expect(data.id).toBe(LOTE_OFF);

    await syncOfflineEntityQueue();
    expect(opsLote.create).toHaveBeenLastCalledWith({
      nome: 'L1', area_atual_id: 'area-srv-1', areas_historico: ['area-srv-1', 'area-real-0'], obs: 'constructor', mapa: { area: 'area-srv-1' },
    });
  });

  it('(e) R2 continua valendo: lote que cita categoria retida fica retido, com a área já trocada pelo id do servidor', async () => {
    const opsCategoria = { list: vi.fn(async () => []), create: vi.fn(async (d) => ({ id: 'cm-srv', ...d })) };
    createOfflineEntityAdapter({ entityName: 'CategoriaRetida', operations: opsCategoria, storage, criacao: 'somente_online' });
    await storage.adicionarNaFila({
      entity_name: 'CategoriaRetida', empresa_id: 'emp-1', operation: 'create', record_id: 'offline_cm_1',
      data: { id: 'offline_cm_1', nome: 'NOVILHA' }, created_at: '2026-10-31T00:00:00Z',
    });
    await storage.adicionarNaFila(criacaoDaArea());
    await storage.adicionarNaFila(criacaoDoLote({ categoria_manejo_id: 'offline_cm_1' }));

    const r1 = await syncOfflineEntityQueue();
    const r2 = await syncOfflineEntityQueue();

    expect(opsCategoria.create).not.toHaveBeenCalled();
    expect(opsLote.create).not.toHaveBeenCalled();
    expect(r1.retidos).toBe(2);
    expect(r2.retidos).toBe(2);
    const lote = naFila(LOTE_OFF);
    expect(lote.quarentena).toMatchObject({ codigo: API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED, depende_de: 'offline_cm_1' });
    expect(lote.data).toMatchObject({ area_atual_id: 'area-srv-1', categoria_manejo_id: 'offline_cm_1' });
    expect(opsArea.create).toHaveBeenCalledTimes(1);
  });

  it('(f) se reescrever a fila falha, a criação não sai da fila', async () => {
    await storage.adicionarNaFila(criacaoDaArea());
    await storage.adicionarNaFila(criacaoDoLote());
    const original = storage.atualizarNaFila;
    storage.atualizarNaFila = vi.fn(async () => { throw new Error('IndexedDB indisponível'); });
    try {
      const r = await syncOfflineEntityQueue();
      expect(r.success).toBe(false);
    } finally {
      storage.atualizarNaFila = original;
    }
    expect(naFila(AREA_OFF)).toBeDefined();
    expect(opsLote.create).not.toHaveBeenCalled();
  });
});
