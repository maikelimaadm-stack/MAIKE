/**
 * D-PROD-195 — criar Categoria de Manejo é SÓ ONLINE.
 *
 * A curva de ganho é obrigatória e as opções vêm do servidor. Por isso a porta
 * monta o adaptador offline com `criacao: 'somente_online'` (D-PROD-195 R2):
 *  (a) a criação vai direto ao servidor, mesmo sem conexão (nada entra na fila
 *      prometendo uma gravação que o servidor recusaria);
 *  (b) um POST gravado na fila pela versão anterior (sem `curva_ganho_id`) fica
 *      RETIDO no replay (`OFFLINE_ENTITY_UNSUPPORTED`), sem envio e sem apagar,
 *      e o resto da fila (outra entidade, depois dele) é sincronizado — antes, o
 *      400 `curva_obrigatoria` travava a fila inteira;
 *  (c) editar e excluir seguem passando pelo adaptador offline;
 *  (d) D-PROD-195 R2: nada vai ao servidor citando a categoria retida — um
 *      lote criado offline que aponte para ela fica retido junto; a edição de
 *      um lote REAL segue sem esse campo (sem resto, sai da fila), para não
 *      ficar presa por cima do servidor nem travar a exclusão;
 *  (e) a categoria criada offline pela versão anterior não aparece nas listas
 *      (online ou offline), nem pela fila nem pela cópia `offline_` do cache,
 *      mesmo antes de qualquer sincronização;
 *  (f) a categoria criada online entra no cache offline;
 *  (g) um id offline que NÃO é de criação retida segue o caminho de sempre
 *      (a R2 não retém cadastros de outras entidades);
 *  (h) a ordem da fila não importa: o lote que vem antes da categoria retida
 *      também fica retido.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const nativeRequest = vi.fn(async (_url, opts) => ({ id: 'cm-novo', ...(opts?.body || {}) }));
vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: (...a) => nativeRequest(...a) }));

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
    listarFila: async () => [...fila.values()],
    adicionarNaFila: async (i) => { const id = proximo++; fila.set(id, { ...i, id }); return id; },
    atualizarNaFila: async (id, c) => { const a = fila.get(id); if (a) fila.set(id, { ...a, ...c, id }); },
    removerDaFila: async (id) => { fila.delete(id); },
    removerCache: async (k) => { cache.delete(k); },
  };
};

const storage = memoria();
const registradas = {};
const opcoesRegistradas = {};

vi.mock('@/lib/offline/offlineEntityRuntime', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    offlineStorageDisponivel: () => true,
    createOfflineEntityAdapter: (opcoes) => {
      registradas[opcoes.entityName] = opcoes.operations;
      opcoesRegistradas[opcoes.entityName] = opcoes;
      return real.createOfflineEntityAdapter({ ...opcoes, storage });
    },
  };
});

const { categoriaManejoPort, ENTIDADE_OFFLINE } = await import('@/apis/categorias-manejo/categoriaManejoNativePort.js');
const { createOfflineEntityAdapter, syncOfflineEntityQueue } = await import('@/lib/offline/offlineEntityRuntime');
const { setOfflineTenant } = await import('@/lib/offline/offlineTenant');
const { API_ERROR_CODES } = await import('@/apis/_core/ApiError');

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

beforeEach(() => {
  nativeRequest.mockClear();
  storage.fila.clear();
  storage.cache.clear();
  setOfflineTenant('cli-1');
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  online(true);
});

describe('D-PROD-195 — criar categoria é só online', () => {
  it('(a) o adaptador offline é registrado com criação só online; criar sem conexão vai ao servidor e não enfileira', async () => {
    expect(opcoesRegistradas[ENTIDADE_OFFLINE].criacao).toBe('somente_online');
    expect(Object.keys(registradas[ENTIDADE_OFFLINE]).sort()).toEqual(['create', 'delete', 'list', 'update']);
    online(false);
    await categoriaManejoPort.create({ empresa_id: 'emp-1', nome: 'BEZERRO', curva_ganho_id: 'k1', sexo: 'MACHO' });
    expect(nativeRequest).toHaveBeenCalledTimes(1);
    const [url, opts] = nativeRequest.mock.calls[0];
    expect(url).toBe('/categorias-manejo');
    expect(opts).toMatchObject({ method: 'POST', body: { nome: 'BEZERRO', curva_ganho_id: 'k1' } });
    expect(storage.fila.size).toBe(0);
  });

  it('(b) POST legado na fila fica retido e o item seguinte (outra entidade) sincroniza', async () => {
    const opsOutra = { list: vi.fn(async () => []), update: vi.fn(async (id, d) => ({ id, ...d })) };
    createOfflineEntityAdapter({ entityName: 'OutraEntidade', operations: opsOutra, storage });
    await storage.adicionarNaFila({
      entity_name: ENTIDADE_OFFLINE, empresa_id: 'emp-1', operation: 'create', record_id: 'offline_cm_1',
      data: { id: 'offline_cm_1', nome: 'NOVILHA', sexo: 'FEMEA' }, created_at: '2026-11-01T00:00:00Z',
    });
    await storage.adicionarNaFila({
      entity_name: 'OutraEntidade', empresa_id: 'emp-1', operation: 'update', record_id: 'x1',
      data: { nome: 'Y' }, created_at: '2026-11-02T00:00:00Z',
    });

    const r = await syncOfflineEntityQueue();

    expect(nativeRequest).not.toHaveBeenCalled();
    expect(opsOutra.update).toHaveBeenCalledWith('x1', { nome: 'Y' });
    expect(r.code).toBe(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED);
    expect(r.retidos).toBe(1);
    const restante = [...storage.fila.values()];
    expect(restante).toHaveLength(1);
    expect(restante[0]).toMatchObject({ entity_name: ENTIDADE_OFFLINE, operation: 'create', record_id: 'offline_cm_1' });
    expect(restante[0].quarentena?.codigo).toBe(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED);
  });

  it('(c) editar sem conexão continua indo para a fila', async () => {
    online(false);
    await categoriaManejoPort.update('cm1', { nome: 'VACA' });
    expect(nativeRequest).not.toHaveBeenCalled();
    expect([...storage.fila.values()].map((f) => [f.entity_name, f.operation, f.record_id])).toEqual([
      [ENTIDADE_OFFLINE, 'update', 'cm1'],
    ]);
  });

  const categoriaLegada = () => ({
    entity_name: ENTIDADE_OFFLINE, empresa_id: 'emp-1', operation: 'create', record_id: 'offline_cm_1',
    data: { id: 'offline_cm_1', nome: 'NOVILHA', sexo: 'FEMEA' }, created_at: '2026-11-01T00:00:00Z',
  });

  it('(d) lote criado offline que aponta para a categoria retida fica retido; edição de lote real segue sem o campo', async () => {
    const opsLote = { list: vi.fn(async () => []), create: vi.fn(async (d) => ({ id: 'lote-srv', ...d })), update: vi.fn(async (id, d) => ({ id, ...d })) };
    createOfflineEntityAdapter({ entityName: 'LoteDependente', operations: opsLote, storage });
    await storage.adicionarNaFila(categoriaLegada());
    await storage.adicionarNaFila({
      entity_name: ENTIDADE_OFFLINE, empresa_id: 'emp-1', operation: 'update', record_id: 'offline_cm_1',
      data: { nome: 'NOVILHA 2' }, created_at: '2026-11-01T00:00:01Z',
    });
    await storage.adicionarNaFila({
      entity_name: 'LoteDependente', empresa_id: 'emp-1', operation: 'create', record_id: 'offline_lote_1',
      data: { id: 'offline_lote_1', nome: 'L1', categoria_manejo_id: 'offline_cm_1' }, created_at: '2026-11-01T00:00:02Z',
    });
    await storage.adicionarNaFila({
      entity_name: 'LoteDependente', empresa_id: 'emp-1', operation: 'update', record_id: 'lote-real',
      data: { categoria_manejo_id: 'offline_cm_1' }, created_at: '2026-11-01T00:00:03Z',
    });
    await storage.adicionarNaFila({
      entity_name: 'LoteDependente', empresa_id: 'emp-1', operation: 'update', record_id: 'lote-real-2',
      data: { nome: 'RENOMEADO', categoria_manejo_id: 'offline_cm_1' }, created_at: '2026-11-01T00:00:03.500Z',
    });
    await storage.adicionarNaFila({
      entity_name: 'LoteDependente', empresa_id: 'emp-1', operation: 'create', record_id: 'offline_lote_2',
      data: { id: 'offline_lote_2', nome: 'L2', categoria_manejo_id: 'cm-real' }, created_at: '2026-11-01T00:00:04Z',
    });

    const r = await syncOfflineEntityQueue();

    expect(nativeRequest).not.toHaveBeenCalled();
    // lote real: só o resto da edição vai; a edição que só trocava a categoria sai da fila
    expect(opsLote.update).toHaveBeenCalledTimes(1);
    expect(opsLote.update).toHaveBeenCalledWith('lote-real-2', { nome: 'RENOMEADO' });
    expect(opsLote.create).toHaveBeenCalledTimes(1);
    expect(opsLote.create).toHaveBeenCalledWith({ nome: 'L2', categoria_manejo_id: 'cm-real' });
    expect(r.code).toBe(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED);
    expect(r.retidos).toBe(3);
    expect(r.descartados).toBe(1);
    const restante = [...storage.fila.values()];
    expect(restante.map((f) => [f.entity_name, f.operation, f.record_id, f.quarentena?.depende_de ?? null])).toEqual([
      [ENTIDADE_OFFLINE, 'create', 'offline_cm_1', null],
      [ENTIDADE_OFFLINE, 'update', 'offline_cm_1', 'offline_cm_1'],
      ['LoteDependente', 'create', 'offline_lote_1', 'offline_cm_1'],
    ]);
    for (const f of restante) expect(f.quarentena?.codigo).toBe(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED);

    // de novo: idempotente — nada mais enviado, nada perdido
    const r2 = await syncOfflineEntityQueue();
    expect(r2.retidos).toBe(3);
    expect(opsLote.create).toHaveBeenCalledTimes(1);
    expect(opsLote.update).toHaveBeenCalledTimes(1);
    expect(storage.fila.size).toBe(3);
  });

  it('(e) a categoria da versão anterior não aparece na lista, nem pela fila nem pelo cache, sem sincronizar antes', async () => {
    await storage.adicionarNaFila(categoriaLegada());
    // cópia que a versão antiga gravou no cache (a porta não é tenant-scoped: chave `Entidade::empresa`)
    storage.cache.set(`${ENTIDADE_OFFLINE}::emp-1`, [{ id: 'offline_cm_1', nome: 'NOVILHA', _isOffline: true }, { id: 'srv-0', nome: 'BOI' }]);
    online(false);
    expect((await categoriaManejoPort.list()).map((c) => c.id)).toEqual(['srv-0']);
    online(true);
    nativeRequest.mockImplementationOnce(async () => [{ id: 'srv-1', nome: 'VACA' }]);
    expect((await categoriaManejoPort.list()).map((c) => c.id)).toEqual(['srv-1']);
    expect(storage.fila.size).toBe(1);
  });

  it('(f) a categoria criada online entra no cache offline', async () => {
    nativeRequest.mockImplementationOnce(async () => []);
    await categoriaManejoPort.list();
    await categoriaManejoPort.create({ empresa_id: 'emp-1', nome: 'BOI', curva_ganho_id: 'k1' });
    online(false);
    expect((await categoriaManejoPort.list()).map((c) => c.id)).toEqual(['cm-novo']);
  });

  it('(g) id offline de outro cadastro (não retido) segue o caminho de sempre', async () => {
    const opsLote = { list: vi.fn(async () => []), create: vi.fn(async (d) => ({ id: 'lote-srv', ...d })) };
    createOfflineEntityAdapter({ entityName: 'LoteComArea', operations: opsLote, storage });
    await storage.adicionarNaFila({
      entity_name: 'LoteComArea', empresa_id: 'emp-1', operation: 'create', record_id: 'offline_lote_9',
      data: { id: 'offline_lote_9', nome: 'L9', area_atual_id: 'offline_AreaPastagem_1' }, created_at: '2026-11-01T00:00:00Z',
    });
    const r = await syncOfflineEntityQueue();
    expect(opsLote.create).toHaveBeenCalledWith({ nome: 'L9', area_atual_id: 'offline_AreaPastagem_1' });
    expect(r.retidos ?? 0).toBe(0);
    expect(storage.fila.size).toBe(0);
  });

  it('(h) lote que vem ANTES da categoria retida na fila também fica retido', async () => {
    const opsLote = { list: vi.fn(async () => []), create: vi.fn(async (d) => ({ id: 'lote-srv', ...d })) };
    createOfflineEntityAdapter({ entityName: 'LoteAntes', operations: opsLote, storage });
    await storage.adicionarNaFila({
      entity_name: 'LoteAntes', empresa_id: 'emp-1', operation: 'create', record_id: 'offline_lote_0',
      data: { id: 'offline_lote_0', nome: 'L0', categoria_manejo_id: 'offline_cm_1' }, created_at: '2026-10-31T00:00:00Z',
    });
    await storage.adicionarNaFila(categoriaLegada());
    const r = await syncOfflineEntityQueue();
    expect(opsLote.create).not.toHaveBeenCalled();
    expect(nativeRequest).not.toHaveBeenCalled();
    expect(r.retidos).toBe(2);
    expect([...storage.fila.values()].find((f) => f.record_id === 'offline_lote_0')?.quarentena?.depende_de).toBe('offline_cm_1');
  });
});

