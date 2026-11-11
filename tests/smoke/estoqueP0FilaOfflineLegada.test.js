/**
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01, fechamento R2, achado LC-3): escrita
 * LEGADA de estoque ainda guardada na fila offline (IndexedDB) por uma versão
 * anterior do aplicativo — `create`/`delete` de MovimentacaoEstoque ou de
 * EstoqueLoteNota, de quando as portas ainda tinham essas operações.
 *
 * As portas da P0 não têm mais `create`/`delete`. Sem defesa, o replay chamava
 * `operations.create` inexistente: TypeError, retorno no primeiro erro e a fila
 * INTEIRA (de todas as entidades) travada — o defeito que a P4.1-R1 já
 * documentou para o Setor. Agora o item fica RETIDO na fila (quarentena), sem
 * envio e sem apagar nada por heurística, e o replay segue com o resto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createOfflineEntityAdapter, syncOfflineEntityQueue, resetOfflineEntityRuntime } = await import('@/lib/offline/offlineEntityRuntime');
const { setOfflineTenant, clearOfflineTenant } = await import('@/lib/offline/offlineTenant');
const { API_ERROR_CODES } = await import('@/apis/_core/ApiError');

const TENANT = 'cli-estoque-p0';

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

/** Operações reais das portas P0 de estoque: leitura e `update` (renomeação), sem `create`/`delete`. */
const operacoesDeEstoque = () => ({ list: vi.fn(async () => []), update: vi.fn(async (id, d) => ({ id, ...d })) });

beforeEach(() => {
  resetOfflineEntityRuntime();
  clearOfflineTenant();
  setOfflineTenant(TENANT);
  localStorage.setItem('empresa_selecionada_id', 'emp-1');
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

const montar = () => {
  const storage = memoria();
  const opsMov = operacoesDeEstoque();
  const opsLote = { ...operacoesDeEstoque(), filter: vi.fn(async () => []) };
  const opsProduto = { list: vi.fn(async () => []), update: vi.fn(async (id, d) => ({ id, ...d })) };
  createOfflineEntityAdapter({ entityName: 'MovimentacaoEstoque', operations: opsMov, storage, tenantScoped: true });
  createOfflineEntityAdapter({ entityName: 'EstoqueLoteNota', operations: opsLote, storage, tenantScoped: true });
  createOfflineEntityAdapter({ entityName: 'Produto', operations: opsProduto, storage, tenantScoped: true });
  return { storage, opsMov, opsLote, opsProduto };
};
const itemDaFila = (entity_name, operation, record_id, created_at, data = {}) =>
  ({ entity_name, empresa_id: 'emp-1', cliente_id: TENANT, operation, record_id, data, created_at });

describe('LC-3 — escrita legada de estoque na fila offline', () => {
  it('create/delete legados de movimento e de lote ficam RETIDOS (sem envio, sem apagar); o update de Produto depois deles é aplicado; a fila não trava', async () => {
    const { storage, opsMov, opsLote, opsProduto } = montar();
    await storage.adicionarNaFila(itemDaFila('MovimentacaoEstoque', 'create', 'offline_mov_1', '2026-01-01T00:00:00Z', { id: 'offline_mov_1', quantidade: 5 }));
    await storage.adicionarNaFila(itemDaFila('EstoqueLoteNota', 'delete', 'lote-1', '2026-01-01T00:00:01Z'));
    await storage.adicionarNaFila(itemDaFila('EstoqueLoteNota', 'create', 'offline_lote_1', '2026-01-01T00:00:02Z', { id: 'offline_lote_1', quantidade_disponivel: 9 }));
    await storage.adicionarNaFila(itemDaFila('Produto', 'update', 'p1', '2026-01-02T00:00:00Z', { nome_produto: 'X' }));

    const r = await syncOfflineEntityQueue();

    expect(opsProduto.update).toHaveBeenCalledTimes(1);
    expect(opsProduto.update).toHaveBeenCalledWith('p1', { nome_produto: 'X' });
    expect(opsMov.update).not.toHaveBeenCalled();
    expect(opsLote.update).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.code).toBe(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED);
    expect(r.error).toBeUndefined();
    expect(r.retidos).toBe(3);
    expect(r.pendentes).toBe(3);
    const restante = [...storage.fila.values()];
    expect(restante.map((f) => [f.entity_name, f.operation, f.record_id])).toEqual([
      ['MovimentacaoEstoque', 'create', 'offline_mov_1'],
      ['EstoqueLoteNota', 'delete', 'lote-1'],
      ['EstoqueLoteNota', 'create', 'offline_lote_1'],
    ]);
    for (const f of restante) expect(f.quarentena?.codigo).toBe(API_ERROR_CODES.OFFLINE_ENTITY_UNSUPPORTED);
    expect(restante.map((f) => f.quarentena?.operacao)).toEqual(['create', 'delete', 'create']);

    // replay de novo: idempotente — nada é enviado, nada se perde, a marca não muda
    const marcas = restante.map((f) => f.quarentena?.em);
    const r2 = await syncOfflineEntityQueue();
    expect(r2.retidos).toBe(3);
    expect([...storage.fila.values()].map((f) => f.quarentena?.em)).toEqual(marcas);
    expect(opsProduto.update).toHaveBeenCalledTimes(1);
  });

  it('a renomeação (update) da porta de estoque continua sendo aplicada no replay', async () => {
    const { storage, opsLote } = montar();
    await storage.adicionarNaFila(itemDaFila('EstoqueLoteNota', 'update', 'lote-1', '2026-01-01T00:00:00Z', { local_estoque_nome: 'DEPOSITO' }));
    const r = await syncOfflineEntityQueue();
    expect(r.success).toBe(true);
    expect(opsLote.update).toHaveBeenCalledWith('lote-1', { local_estoque_nome: 'DEPOSITO' });
    expect(storage.fila.size).toBe(0);
  });
});
