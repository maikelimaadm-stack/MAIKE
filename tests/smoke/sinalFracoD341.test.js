/**
 * D-PROD-341 — sinal fraco (o celular diz que tem internet, mas o pedido não tem resposta).
 *
 *  SF-01 a edição de um cadastro sem resposta vai para a fila (antes: erro, e a pessoa refazia), com a versão que a
 *        pessoa viu; a tela mostra a edição; na volta do sinal ela sobe
 *  SF-02 recusa do servidor (com resposta) continua voltando para a tela, nada na fila
 *  SF-03 a transferência do depósito que tentou subir sem resposta continua no histórico ("confirmando") e a
 *        confirmação é pedida na hora (antes sumia com internet, e a pessoa transferia de novo)
 * O servidor que reconhece a mesma edição repetida: backend/tests/versaoDoRegistro.test.mjs (VR-07).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

const memoria = () => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (k) => [...(cache.get(k) || [])],
    gravarCache: async (k, r) => cache.set(k, r.items),
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => {
      const id = proximo++;
      fila.set(id, { ...structuredClone(i), id });
      return id;
    },
    atualizarNaFila: async (id, c) => fila.has(id) && fila.set(id, { ...fila.get(id), ...structuredClone(c), id }),
    removerDaFila: async (id) => fila.delete(id),
    removerCache: async (k) => cache.delete(k),
  };
};

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
  online(true);
});
afterEach(() => {
  online(true);
  vi.doUnmock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao');
  vi.doUnmock('@/lib/offline/sincronizacao/motorDeSincronizacao');
});

describe('D-PROD-341 — edição de cadastro com sinal fraco', () => {
  const montar = async () => {
    const rt = await import('@/lib/offline/offlineEntityRuntime');
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    rt.resetOfflineEntityRuntime();
    const erros = await import('@/apis/_core/ApiError');
    const storage = memoria();
    const servidor = { l1: { id: 'l1', empresa_id: 'emp-1', nome: 'LOTE A', updated_date: '2026-11-27T10:00:00.000Z' } };
    let falhar = null;
    const ops = {
      list: vi.fn(async () => Object.values(servidor).map((l) => ({ ...l }))),
      update: vi.fn(async (id, d) => {
        if (falhar === 'rede') throw new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
        if (falhar === 'recusa') throw new erros.ApiError('REQUEST_VALIDATION_FAILED', { operation: 'x', resource: 'y', status: 400, cause: { code: 'REQUEST_VALIDATION_FAILED' } });
        const { versao_esperada: _v, ...resto } = d;
        servidor[id] = { ...servidor[id], ...resto };
        return { ...servidor[id] };
      }),
    };
    const porta = rt.createOfflineEntityAdapter({ entityName: 'Lote', operations: ops, storage, tenantScoped: true });
    await porta.list();
    return { rt, porta, ops, storage, servidor, falhar: (v) => (falhar = v) };
  };

  it('SF-01 sem resposta: a edição vai para a fila com a versão vista, aparece na tela e sobe depois', async () => {
    const { rt, porta, ops, storage, servidor, falhar } = await montar();
    falhar('rede');
    const r = await porta.update('l1', { empresa_id: 'emp-1', nome: 'LOTE B', versao_esperada: '2026-11-27T10:00:00.000Z' });
    expect(r).toMatchObject({ id: 'l1', nome: 'LOTE B', _isOffline: true });
    const [item] = [...storage.fila.values()];
    expect(item).toMatchObject({ operation: 'update', record_id: 'l1', data: { nome: 'LOTE B', versao_esperada: '2026-11-27T10:00:00.000Z' } });
    expect((await porta.list()).find((l) => l.id === 'l1').nome).toBe('LOTE B');
    falhar(null);
    await rt.syncOfflineEntityQueue();
    expect(ops.update).toHaveBeenLastCalledWith('l1', expect.objectContaining({ nome: 'LOTE B', versao_esperada: '2026-11-27T10:00:00.000Z' }));
    expect(servidor.l1.nome).toBe('LOTE B');
    expect(storage.fila.size).toBe(0);
  });

  it('SF-02 recusa do servidor continua voltando para a tela, nada na fila', async () => {
    const { porta, storage, falhar } = await montar();
    falhar('recusa');
    await expect(porta.update('l1', { empresa_id: 'emp-1', nome: '' })).rejects.toBeTruthy();
    expect(storage.fila.size).toBe(0);
  });
});

describe('D-PROD-341 — histórico do depósito com sinal fraco', () => {
  it('SF-03 a transferência que tentou subir sem resposta continua no histórico e a confirmação é pedida', async () => {
    const sincronizarTudo = vi.fn(async () => undefined);
    vi.doMock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({ sincronizarTudo }));
    vi.doMock('@/lib/offline/sincronizacao/motorDeSincronizacao', async (original) => ({
      ...(await original()),
      registrosDoAparelhoDoTipo: async (tipo) =>
        tipo === 'deposito.transferencia'
          ? [
              {
                operationId: 'op-transf-0001',
                estado: 'pendente',
                tentado: true,
                tentado_em: '2026-11-27T10:00:00.000Z',
                criado_em: '2026-11-27T10:00:00.000Z',
                payload: { empresa_id: 'emp-1', produto_id: 'p1', produto_nome: 'SAL', quantidade: 10, local_origem_id: 'galpao', local_destino_id: 'cocho-1', local_destino_nome: 'COCHO 1' },
                progresso: {},
                resultado: null,
              },
            ]
          : [],
    }));
    const { movimentacoesAguardandoEnvio } = await import('@/services/historicoAguardandoEnvioService');
    const movs = await movimentacoesAguardandoEnvio('emp-1');
    expect(movs.map((m) => m.id)).toEqual(['aguardando:op-transf-0001:saida', 'aguardando:op-transf-0001:entrada']);
    expect(movs.every((m) => m._confirmando === true)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(sincronizarTudo).toHaveBeenCalledWith({ jaEmVoltaDaRede: true });
  });
});
