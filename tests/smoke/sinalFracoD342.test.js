/**
 * D-PROD-342 — sinal fraco (o celular diz que tem internet, mas o pedido não tem resposta).
 *
 *  SF-01 a edição de um cadastro sem resposta vai para a fila (antes: erro, e a pessoa refazia), com a versão que a
 *        pessoa viu; a tela mostra a edição; na volta do sinal ela sobe
 *  SF-02 recusa do servidor (com resposta) continua voltando para a tela, nada na fila
 *  SF-03 a transferência do depósito que tentou subir sem resposta: com internet não aparece duas vezes, e a
 *        confirmação é pedida na hora; sem internet aparece como aguardando
 *  SF-04 a porta que pede `edicaoSemResposta: 'erro'` (fechamento do período do cocho, que o motor repete) continua
 *        recebendo o erro: nada vai para a fila de cadastros
 *  SF-05 a correção depois de uma edição que ficou sem resposta vai como item próprio, sem versão (não entra na
 *        repetição, que levaria a versão velha com valores novos: conflito consigo mesma)
 *  SF-06 a edição depois de uma criação já tentada sem resposta também vai como item próprio (o servidor devolve o que
 *        já tem para o mesmo id, e a edição somada à criação se perderia)
 *  SF-07 a exclusão repetida que recebe "não existe" conta como feita (não fica "precisa de atenção")
 *  SF-08 o item que a fila mandou e ficou sem resposta passa a contar como já tentado
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

describe('D-PROD-342 — edição de cadastro com sinal fraco', () => {
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

describe('D-PROD-342 — fila de cadastros depois de um envio sem resposta', () => {
  const montar = async ({ opcoes = {}, servidor = {} } = {}) => {
    const rt = await import('@/lib/offline/offlineEntityRuntime');
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    rt.resetOfflineEntityRuntime();
    const erros = await import('@/apis/_core/ApiError');
    const storage = memoria();
    const estado = { falhar: null };
    const semRede = () => new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
    const ops = {
      list: vi.fn(async () => Object.values(servidor).map((l) => ({ ...l }))),
      create: vi.fn(async (d) => {
        if (estado.falhar === 'rede') throw semRede();
        // Como o servidor com o id do aparelho: o mesmo id de novo devolve o que já está gravado.
        const id = d.id ?? 'srv-1';
        servidor[id] = servidor[id] ?? { ...d, id };
        if (estado.falhar === 'respostaPerdida') throw semRede();
        return { ...servidor[id] };
      }),
      update: vi.fn(async (id, d) => {
        if (estado.falhar === 'rede') throw semRede();
        const { versao_esperada: _v, ...resto } = d;
        servidor[id] = { ...servidor[id], ...resto };
        return { ...servidor[id] };
      }),
      delete: vi.fn(async (id) => {
        if (estado.falhar === 'rede') throw semRede();
        if (!servidor[id]) throw new erros.ApiError('NOT_FOUND', { operation: 'x', resource: 'y', status: 404, cause: { code: 'PONTO_SUPLEMENTACAO_NOT_FOUND' } });
        delete servidor[id];
      }),
    };
    const porta = rt.createOfflineEntityAdapter({ entityName: 'PontoSuplementacao', operations: ops, storage, tenantScoped: true, ...opcoes });
    await porta.list();
    return { rt, porta, ops, storage, servidor, estado };
  };

  it("SF-04 com edicaoSemResposta 'erro', a edição sem resposta volta como erro e nada entra na fila", async () => {
    const { porta, storage, estado } = await montar({ opcoes: { edicaoSemResposta: 'erro' }, servidor: { c1: { id: 'c1', empresa_id: 'emp-1', nome: 'COCHO' } } });
    estado.falhar = 'rede';
    await expect(porta.update('c1', { empresa_id: 'emp-1', nome: 'COCHO 2' })).rejects.toBeTruthy();
    expect(storage.fila.size).toBe(0);
  });

  it('SF-04b as portas do fechamento do período do cocho pedem o erro', async () => {
    const fs = await import('node:fs');
    for (const arquivo of ['src/apis/suplementacao-eventos/suplementacaoEventoNativePort.js', 'src/apis/suplementacao-lotes/suplementacaoLoteNativePort.js']) {
      expect(fs.readFileSync(arquivo, 'utf8')).toMatch(/edicaoSemResposta:\s*'erro'/);
    }
  });

  it('SF-05 a correção depois de uma edição sem resposta vai como item próprio, sem versão', async () => {
    const { rt, porta, storage, servidor, estado } = await montar({ servidor: { c1: { id: 'c1', empresa_id: 'emp-1', nome: 'A', updated_date: 'v1' } } });
    estado.falhar = 'rede';
    await porta.update('c1', { empresa_id: 'emp-1', nome: 'B', versao_esperada: 'v1' });
    online(false);
    await porta.update('c1', { empresa_id: 'emp-1', nome: 'C', versao_esperada: 'v-local' });
    const itens = [...storage.fila.values()];
    expect(itens).toHaveLength(2);
    expect(itens[0]).toMatchObject({ ja_tentado: true, data: { nome: 'B', versao_esperada: 'v1' } });
    expect(itens[1].data).toMatchObject({ nome: 'C' });
    expect(itens[1].data.versao_esperada).toBeUndefined();
    online(true);
    estado.falhar = null;
    await rt.syncOfflineEntityQueue();
    expect(servidor.c1.nome).toBe('C');
    expect(storage.fila.size).toBe(0);
  });

  it('SF-06 a edição depois de uma criação já tentada vai como item próprio', async () => {
    const { rt, porta, storage, servidor, estado } = await montar({ opcoes: { idDoAparelho: true } });
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome: 'NOVO' });
    online(true);
    estado.falhar = 'respostaPerdida';
    await rt.syncOfflineEntityQueue(); // chegou ao servidor, a resposta se perdeu: a criação fica como já tentada
    expect([...storage.fila.values()][0]).toMatchObject({ operation: 'create', ja_tentado: true });
    online(false);
    await porta.update(criado.id, { empresa_id: 'emp-1', nome: 'NOVO RENOMEADO' });
    const itens = [...storage.fila.values()];
    expect(itens.map((i) => i.operation)).toEqual(['create', 'update']);
    expect(itens[0].data.nome).toBe('NOVO');
    online(true);
    estado.falhar = null;
    await rt.syncOfflineEntityQueue();
    expect(Object.values(servidor).map((c) => c.nome)).toEqual(['NOVO RENOMEADO']);
    expect(storage.fila.size).toBe(0);
  });

  it('SF-07 a exclusão que recebe "não existe" conta como feita', async () => {
    const { rt, porta, storage, servidor } = await montar({ servidor: { c1: { id: 'c1', empresa_id: 'emp-1', nome: 'COCHO' } } });
    online(false);
    await porta.delete('c1');
    delete servidor.c1; // a exclusão chegou numa tentativa anterior (ou outra pessoa excluiu)
    online(true);
    const r = await rt.syncOfflineEntityQueue();
    expect(r.success).toBe(true);
    expect(storage.fila.size).toBe(0);
    expect(rt.registroJaNaoExiste({ cause: { code: 'LOTE_NOT_FOUND' } })).toBe(true);
    expect(rt.registroJaNaoExiste({ cause: { code: 'REQUEST_VALIDATION_FAILED', status: 400 } })).toBe(false);
  });

  it('SF-08 o item enviado pela fila que ficou sem resposta passa a contar como já tentado', async () => {
    const { rt, porta, storage, estado } = await montar({ servidor: { c1: { id: 'c1', empresa_id: 'emp-1', nome: 'A' } } });
    online(false);
    await porta.update('c1', { empresa_id: 'emp-1', nome: 'B' });
    expect([...storage.fila.values()][0].ja_tentado).toBeUndefined();
    online(true);
    estado.falhar = 'rede';
    await rt.syncOfflineEntityQueue();
    expect([...storage.fila.values()][0].ja_tentado).toBe(true);
  });
});

describe('D-PROD-342 — histórico do depósito com sinal fraco', () => {
  const tentada = () => [
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
  ];
  const montar = async () => {
    const sincronizarTudo = vi.fn(async () => undefined);
    vi.doMock('@/lib/offline/sincronizacao/gatilhosDeSincronizacao', () => ({ sincronizarTudo }));
    vi.doMock('@/lib/offline/sincronizacao/motorDeSincronizacao', async (original) => ({
      ...(await original()),
      registrosDoAparelhoDoTipo: async (tipo) => (tipo === 'deposito.transferencia' ? tentada() : []),
    }));
    const { movimentacoesAguardandoEnvio } = await import('@/services/historicoAguardandoEnvioService');
    return { movimentacoesAguardandoEnvio, sincronizarTudo };
  };

  it('SF-03 com internet: a transferência tentada não aparece duas vezes e a confirmação é pedida na hora', async () => {
    const { movimentacoesAguardandoEnvio, sincronizarTudo } = await montar();
    expect(await movimentacoesAguardandoEnvio('emp-1')).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(sincronizarTudo).toHaveBeenCalledWith({ jaEmVoltaDaRede: true });
  });

  it('SF-03b sem internet: a transferência tentada aparece como aguardando', async () => {
    online(false);
    const { movimentacoesAguardandoEnvio, sincronizarTudo } = await montar();
    const movs = await movimentacoesAguardandoEnvio('emp-1');
    expect(movs.map((m) => m.id)).toEqual(['aguardando:op-transf-0001:saida', 'aguardando:op-transf-0001:entrada']);
    expect(sincronizarTudo).not.toHaveBeenCalled();
  });
});
