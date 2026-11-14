/**
 * D-PROD-195 — criar Categoria de Manejo é SÓ ONLINE.
 *
 * A curva de ganho é obrigatória e as opções vêm do servidor. Por isso a porta
 * monta o adaptador offline SEM `create`:
 *  (a) a criação vai direto ao servidor, mesmo sem conexão (nada entra na fila
 *      prometendo uma gravação que o servidor recusaria);
 *  (b) um POST gravado na fila pela versão anterior (sem `curva_ganho_id`) fica
 *      RETIDO no replay (`OFFLINE_ENTITY_UNSUPPORTED`), sem envio e sem apagar,
 *      e o resto da fila (outra entidade, depois dele) é sincronizado — antes, o
 *      400 `curva_obrigatoria` travava a fila inteira;
 *  (c) editar e excluir seguem passando pelo adaptador offline.
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

vi.mock('@/lib/offline/offlineEntityRuntime', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    offlineStorageDisponivel: () => true,
    createOfflineEntityAdapter: (opcoes) => {
      registradas[opcoes.entityName] = opcoes.operations;
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
  setOfflineTenant('cli-1');
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  online(true);
});

describe('D-PROD-195 — criar categoria é só online', () => {
  it('(a) o adaptador offline é registrado sem create; criar sem conexão vai ao servidor e não enfileira', async () => {
    expect(Object.keys(registradas[ENTIDADE_OFFLINE]).sort()).toEqual(['delete', 'list', 'update']);
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
});
