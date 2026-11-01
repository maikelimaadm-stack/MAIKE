/**
 * MAIKE-LOTES-PR167-R1 — cache offline da ENTIDADE Lote depois da exclusão.
 *
 * A exclusão do Cadastro vai direto ao servidor (nunca à fila offline). Antes
 * desta correção, o cache da entidade Lote (runtime offline, IndexedDB) não
 * era tocado: um lote excluído reaparecia no Cadastro quando o aparelho ficava
 * offline antes de uma nova listagem online. Runtime real com porta de
 * armazenamento em memória (mesmo contrato do IndexedDB); só o HTTP é falso.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const http = vi.hoisted(() => ({ excluir: vi.fn() }));
const mapa = vi.hoisted(() => ({ updateMapaCachedData: vi.fn(async () => []) }));

vi.mock('@/apis/lotes', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, excluirLoteOnline: (...a) => http.excluir(...a) };
});
vi.mock('@/services/mapaCacheService', () => mapa);

const { createOfflineEntityAdapter, resetOfflineEntityRuntime } = await import('@/lib/offline/offlineEntityRuntime');
const { setOfflineTenant, clearOfflineTenant } = await import('@/lib/offline/offlineTenant');
const { excluirLotes } = await import('@/services/loteCadastroService');

/** Porta em memória que guarda o REGISTRO inteiro (como o IndexedDB guarda). */
const criarArmazenamento = () => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (chave) => [...(cache.get(chave)?.items || [])],
    gravarCache: async (chave, registro) => { cache.set(chave, { cache_key: chave, ...registro }); },
    removerCache: async (chave) => { cache.delete(chave); },
    listarCaches: async () => [...cache.values()],
    listarFila: async () => [...fila.values()],
    adicionarNaFila: async (item) => { const id = proximo++; fila.set(id, { ...item, id }); return id; },
    atualizarNaFila: async (id, campos) => { const a = fila.get(id); if (a) fila.set(id, { ...a, ...campos, id }); },
    removerDaFila: async (id) => { fila.delete(id); },
  };
};

const X = { id: 'lote-x', empresa_id: 'emp-1', nome: 'NELORE', quantidade_cabecas: 500 };
const Y = { id: 'lote-y', empresa_id: 'emp-1', nome: 'NELORE', quantidade_cabecas: 300 }; // homônimo de X
const Z = { id: 'lote-z', empresa_id: 'emp-2', nome: 'ANGUS', quantidade_cabecas: 80 };
const W = { id: 'lote-w', empresa_id: 'emp-b', nome: 'NELORE', quantidade_cabecas: 90 }; // outro tenant

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
const empresa = (id) => localStorage.setItem('empresa_selecionada_id', id);

let armazenamento;
let servidor;
let adapter;

/** Tenant A com caches de duas fazendas; tenant B com o seu; tudo lido ONLINE antes da exclusão. */
const prepararCaches = async () => {
  servidor = { 'cli-a': [X, Y, Z], 'cli-b': [W] };
  let tenantAtual = 'cli-a';
  adapter = createOfflineEntityAdapter({
    entityName: 'Lote',
    tenantScoped: true,
    storage: armazenamento,
    operations: {
      list: async () => [...servidor[tenantAtual]],
      update: async (id, dados) => ({ id, ...dados }),
      delete: async () => undefined,
    },
  });
  const trocarTenant = (t) => { tenantAtual = t; setOfflineTenant(t); };
  trocarTenant('cli-b'); empresa('emp-b'); await adapter.list();
  trocarTenant('cli-a'); empresa('emp-2'); await adapter.list();
  empresa('emp-1'); await adapter.list();
  return trocarTenant;
};

const idsOffline = async () => (await adapter.list()).map((l) => l.id).sort();

beforeEach(() => {
  resetOfflineEntityRuntime();
  armazenamento = criarArmazenamento();
  http.excluir.mockReset();
  mapa.updateMapaCachedData.mockClear();
  online(true);
});
afterEach(() => {
  online(true);
  clearOfflineTenant();
  resetOfflineEntityRuntime();
});

describe('PR167-R1 P0-A — exclusão confirmada some do cache offline da entidade Lote', () => {
  it('204: offline logo em seguida (sem nova leitura online), o lote NÃO reaparece — em nenhuma fazenda do tenant', async () => {
    const trocarTenant = await prepararCaches();
    http.excluir.mockResolvedValue(undefined); // 204
    const r = await excluirLotes([X.id], { lotes: [X, Y, Z] });
    expect(r.excluidos).toEqual([X.id]);

    online(false); // cai a rede antes de qualquer GET /lotes
    empresa('emp-1');
    expect(await idsOffline()).toEqual([Y.id, Z.id]); // homônimo Y continua
    empresa('emp-2');
    expect(await idsOffline()).toEqual([Y.id, Z.id]);

    // Cache de outro tenant intocado.
    trocarTenant('cli-b'); empresa('emp-b');
    expect(await idsOffline()).toEqual([W.id]);
  });

  it('o mesmo vale depois de "recarregar" (runtime novo lendo o mesmo armazenamento)', async () => {
    await prepararCaches();
    http.excluir.mockResolvedValue(undefined);
    await excluirLotes([X.id], { lotes: [X, Y, Z] });
    // Recarga: o runtime em memória some; o armazenamento (IndexedDB) fica.
    resetOfflineEntityRuntime();
    online(false);
    adapter = createOfflineEntityAdapter({ entityName: 'Lote', tenantScoped: true, storage: armazenamento, operations: { list: async () => { throw new Error('offline'); } } });
    empresa('emp-1');
    expect(await idsOffline()).toEqual([Y.id, Z.id]);
  });

  it('cache do mapa (lotes) também perde o lote, na fazenda dele', async () => {
    await prepararCaches();
    http.excluir.mockResolvedValue(undefined);
    await excluirLotes([X.id], { lotes: [X, Y, Z] });
    expect(mapa.updateMapaCachedData).toHaveBeenCalledWith('lotes', 'emp-1', expect.any(Function));
    const filtro = mapa.updateMapaCachedData.mock.calls[0][2];
    expect(filtro([X, Y]).map((l) => l.id)).toEqual([Y.id]);
  });
});

describe('PR167-R1 P0-A — sem resposta definitiva, o cache NÃO é tocado; nada vai para a fila', () => {
  for (const [nome, erro] of [
    ['5xx', Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'INTERNAL_ERROR' } })],
    ['409 bloqueado', Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'LOTE_DELETE_BLOCKED', details: { motivo: 'movimentacao_ativa' } } })],
    ['queda de rede entre a checagem e o HTTP', new TypeError('Failed to fetch')],
    ['timeout', Object.assign(new Error('timeout'), { code: 'API_PROVIDER_UNAVAILABLE' })],
  ]) {
    it(`${nome}: lote continua no cache offline e na fila não entra DELETE`, async () => {
      await prepararCaches();
      http.excluir.mockRejectedValue(erro);
      const r = await excluirLotes([X.id], { lotes: [X, Y, Z] });
      expect(r.excluidos).toEqual([]);
      expect(r.bloqueados.map((b) => b.id)).toEqual([X.id]);
      expect([...armazenamento.fila.values()].filter((f) => f.operation === 'delete')).toEqual([]);
      online(false);
      empresa('emp-1');
      expect(await idsOffline()).toEqual([X.id, Y.id, Z.id]);
      expect(mapa.updateMapaCachedData).not.toHaveBeenCalled();
    });
  }

  it('exclusão em massa: o que falhou fica no cache, o que saiu some', async () => {
    await prepararCaches();
    http.excluir.mockImplementation(async (id) => {
      if (id === Y.id) throw Object.assign(new Error('x'), { code: 'API_OPERATION_FAILED', cause: { code: 'LOTE_DELETE_BLOCKED', details: { motivo: 'movimentacao_ativa' } } });
    });
    const r = await excluirLotes([X.id, Y.id], { lotes: [X, Y, Z] });
    expect(r.excluidos).toEqual([X.id]);
    expect(r.bloqueados.map((b) => b.id)).toEqual([Y.id]);
    online(false);
    empresa('emp-1');
    expect(await idsOffline()).toEqual([Y.id, Z.id]);
  });
});

describe('PR167-R1 P0-A — pendência offline do lote: sem ressurreição e sem descarte silencioso', () => {
  it('alteração offline pendente do lote → exclusão recusada com motivo explícito; nada é enviado; fila intacta', async () => {
    await prepararCaches();
    online(false);
    empresa('emp-1');
    await adapter.update(X.id, { peso_medio_kg: 410 }); // vai para a fila
    expect([...armazenamento.fila.values()].map((f) => [f.operation, f.record_id])).toEqual([['update', X.id]]);
    online(true);
    const r = await excluirLotes([X.id], { lotes: [X, Y, Z] });
    expect(http.excluir).not.toHaveBeenCalled();
    expect(r.excluidos).toEqual([]);
    expect(r.bloqueados).toMatchObject([{ id: X.id, motivo: 'pendencia_offline' }]);
    expect([...armazenamento.fila.values()].map((f) => [f.operation, f.record_id])).toEqual([['update', X.id]]);
  });

  it('pendência de OUTRO tenant com o mesmo id não bloqueia', async () => {
    const trocarTenant = await prepararCaches();
    armazenamento.fila.set(99, { id: 99, entity_name: 'Lote', operation: 'update', record_id: X.id, empresa_id: 'emp-b', cliente_id: 'cli-b', data: {} });
    trocarTenant('cli-a');
    http.excluir.mockResolvedValue(undefined);
    const r = await excluirLotes([X.id], { lotes: [X, Y, Z] });
    expect(r.excluidos).toEqual([X.id]);
    expect(armazenamento.fila.has(99)).toBe(true);
  });
});
