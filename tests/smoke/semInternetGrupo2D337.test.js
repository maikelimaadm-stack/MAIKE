/**
 * D-PROD-337 — Grupo 2 da varredura sem internet: travas e avisos que enganavam.
 *
 *  G2-01 depois de várias falhas de rede, a volta da internet / "Enviar agora" manda já (antes esperava até 10 min);
 *        a espera depois de erro do SERVIDOR continua
 *  G2-02 espera maior que a maior possível (relógio do celular que voltou) não segura o item
 *  G2-03 a leitura do cocho parada ("precisa de atenção") não trava os lançamentos do mesmo cocho
 *  G2-04 a edição recusada pelo servidor não fica pintada por cima do valor do servidor nas listas
 *  G2-05 a edição de uma tarefa da fazenda A na fila não aparece no mapa da fazenda B
 *  G2-06 sessão vencida: o item diz o motivo (antes ficava "aguardando" sem explicação)
 *  G2-07 "Excluir" a tarefa criada no aparelho tira as fotos guardadas dela e manda o mapa reler
 * O "Tudo sincronizado" só quando nada ficou no celular: sincronizacaoCompletaCirculo.test.jsx (SC-06).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });
const AGORA = Date.parse('2026-11-26T12:00:00Z');

beforeEach(() => {
  vi.resetModules();
  online(true);
});
afterEach(() => {
  online(true);
  vi.doUnmock('@/lib/offline/offlineEntityRuntime');
});

const motorEmMemoria = async () => {
  const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
  const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
  const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
  const fila = criarFilaEmMemoria();
  let agora = AGORA;
  motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => agora, online: () => navigator.onLine !== false });
  motor.definirSessaoDaFila({ cliente_id: 'cli_A', usuario_id: 'usr_1' });
  const semRede = () => new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
  return { motor, fila, semRede, avancar: (ms) => (agora += ms), ApiError, API_ERROR_CODES };
};

describe('D-PROD-337 — fila dos cochos e depósitos', () => {
  it('G2-01 várias falhas de rede: "Enviar agora" manda já; o erro do servidor continua esperando', async () => {
    const { motor, fila, semRede, ApiError } = await motorEmMemoria();
    let falhar = 8;
    const enviar = vi.fn(async () => {
      if (falhar > 0) {
        falhar -= 1;
        throw semRede();
      }
      return { ok: true };
    });
    motor.registrarTipoDeEnvio({ tipo: 'teste.rede', versao: 1, offline: true, enviar });
    online(false);
    await motor.enviarOuGuardar('teste.rede', { a: 1 }, { operationId: 'op-rede-00001' });
    online(true);
    for (let i = 0; i < 8; i += 1) {
      await motor.liberarEsperaDeRede(); // simula as voltas da rede entre as falhas
      await motor.sincronizar();
    }
    expect((await fila.ler('op-rede-00001')).proxima_tentativa_em).toBeGreaterThan(AGORA + 60_000);
    // Sem liberar, a passada não manda (a espera vale):
    await motor.sincronizar();
    expect(enviar).toHaveBeenCalledTimes(8);
    // "Enviar agora" / a internet voltou:
    expect(await motor.liberarEsperaDeRede()).toBe(1);
    await motor.sincronizar();
    expect(enviar).toHaveBeenCalledTimes(9);
    expect((await fila.ler('op-rede-00001')).estado).toBe('enviado');

    // Erro do servidor: a espera NÃO é liberada.
    const comErro = vi.fn(async () => {
      throw new ApiError('INTERNAL_ERROR', { operation: 'x', resource: 'y', cause: { code: 'INTERNAL_ERROR' } });
    });
    motor.registrarTipoDeEnvio({ tipo: 'teste.servidor', versao: 1, offline: true, enviar: comErro });
    online(false);
    await motor.enviarOuGuardar('teste.servidor', { b: 1 }, { operationId: 'op-serv-00001' });
    online(true);
    await motor.sincronizar();
    const depois = comErro.mock.calls.length;
    expect(await motor.liberarEsperaDeRede()).toBe(0);
    await motor.sincronizar();
    expect(comErro.mock.calls.length).toBe(depois);
    motor.definirSessaoDaFila(null);
  });

  it('G2-02 espera impossível (relógio do celular voltou) não segura o item', async () => {
    const { motor, fila } = await motorEmMemoria();
    const enviar = vi.fn(async () => ({ ok: true }));
    motor.registrarTipoDeEnvio({ tipo: 'teste.relogio', versao: 1, offline: true, enviar });
    online(false);
    await motor.enviarOuGuardar('teste.relogio', { a: 1 }, { operationId: 'op-relogio-001' });
    online(true);
    const item = await fila.ler('op-relogio-001');
    await fila.gravar({ ...item, proxima_tentativa_em: AGORA + 3 * 24 * 60 * 60 * 1000 });
    await motor.sincronizar();
    expect(enviar).toHaveBeenCalledTimes(1);
    motor.definirSessaoDaFila(null);
  });

  it('G2-03 a leitura parada não trava os lançamentos do mesmo cocho', async () => {
    const { motor, ApiError } = await motorEmMemoria();
    const recusa = vi.fn(async () => {
      throw new ApiError('REQUEST_VALIDATION_FAILED', { operation: 'x', resource: 'y', status: 400, cause: { code: 'REQUEST_VALIDATION_FAILED' } });
    });
    const lancar = vi.fn(async () => ({ ok: true }));
    motor.registrarTipoDeEnvio({ tipo: 'cocho.leitura', versao: 1, offline: true, independente: true, enviar: recusa, recursos: (p) => [`cocho:${p.cocho}`] });
    motor.registrarTipoDeEnvio({ tipo: 'cocho.lancamento', versao: 1, offline: true, enviar: lancar, recursos: (p) => [`cocho:${p.cocho}`] });
    online(false);
    await motor.enviarOuGuardar('cocho.leitura', { cocho: 'c1' }, { operationId: 'op-leitura-001' });
    online(true);
    await motor.sincronizar();
    expect((await motor.resumoDaFila()).atencao).toBe(1);
    // Lançamento com internet: vai direto (não fica "aguardando" atrás da leitura parada).
    expect(await motor.enviarOuGuardar('cocho.lancamento', { cocho: 'c1' }, { operationId: 'op-lanc-00001' })).toMatchObject({ estado: 'enviado' });
    // E o que já estava na fila também sai.
    online(false);
    await motor.enviarOuGuardar('cocho.lancamento', { cocho: 'c1' }, { operationId: 'op-lanc-00002' });
    online(true);
    await motor.sincronizar();
    expect(lancar).toHaveBeenCalledTimes(2);
    motor.definirSessaoDaFila(null);
  });

  it('G2-06 sessão vencida: o item diz o motivo', async () => {
    const { motor, fila, ApiError, API_ERROR_CODES } = await motorEmMemoria();
    const enviar = vi.fn(async () => {
      // O cliente HTTP traduz o 401 para TENANT_CONTEXT_REQUIRED (sessão do aparelho vencida).
      throw new ApiError(API_ERROR_CODES.TENANT_CONTEXT_REQUIRED, { operation: 'x', resource: 'y', status: 401 });
    });
    motor.registrarTipoDeEnvio({ tipo: 'teste.sessao', versao: 1, offline: true, enviar });
    online(false);
    await motor.enviarOuGuardar('teste.sessao', { a: 1 }, { operationId: 'op-sessao-0001' });
    online(true);
    await motor.sincronizar();
    const item = await fila.ler('op-sessao-0001');
    expect(item.estado).toBe('pendente');
    expect(item.ultimo_erro).toMatchObject({ codigo: 'SESSAO_VENCIDA', falha: 'sessao' });
    motor.definirSessaoDaFila(null);
  });
});

describe('D-PROD-337 — fila de cadastros e mapa', () => {
  it('G2-04 a edição recusada não fica pintada por cima do servidor', async () => {
    // A fazenda selecionada (a lista e a fila casam por ela).
    window.localStorage.setItem('empresa_selecionada_id', 'emp-1');
    const rt = await import('@/lib/offline/offlineEntityRuntime');
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    rt.resetOfflineEntityRuntime();
    const cache = new Map();
    const fila = new Map();
    let proximo = 1;
    const storage = {
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
    const servidor = [{ id: 'm1', empresa_id: 'emp-1', nome: 'A' }];
    const porta = rt.createOfflineEntityAdapter({
      entityName: 'Marca',
      storage,
      tenantScoped: true,
      operations: { list: async () => servidor.map((m) => ({ ...m })), update: async (id, d) => ({ id, ...d }) },
    });
    online(false);
    await porta.update('m1', { empresa_id: 'emp-1', nome: 'B' });
    const [item] = [...fila.values()];
    await storage.atualizarNaFila(item.id, { quarentena: { codigo: rt.CODIGO_RECUSADO_PELO_SERVIDOR, motivo: 'conflito' } });
    online(true);
    expect((await porta.list()).map((m) => m.nome)).toEqual(['A']);
  });

  it('G2-05 tarefa da fazenda A editada na fila não aparece no mapa da fazenda B', async () => {
    vi.doMock('@/lib/offline/offlineEntityRuntime', async (original) => ({
      ...(await original()),
      listarItensDaFilaDeEntidades: async () => [
        { id: 1, entidade: 'LancamentoTarefa', operacao: 'update', registroId: 'tarefa-A', situacao: 'aguardando', empresaId: 'emp-A', dados: { status: 'Pendente', coordenadas: { lat: -15, lng: -56 } } },
      ],
    }));
    (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
    const mapa = await import('@/services/mapaCacheService');
    expect((await mapa.getMapaCachedData('tarefas', 'emp-B')) ?? []).toEqual([]);
    expect(((await mapa.getMapaCachedData('tarefas', 'emp-A')) ?? []).map((t) => t.id)).toEqual(['tarefa-A']);
  });

  it('G2-07 "Excluir" a tarefa criada no aparelho tira as fotos dela e manda o mapa reler', async () => {
    const excluidas = [];
    vi.doMock('@/lib/offline/offlineEntityRuntime', async (original) => ({
      ...(await original()),
      listarItensDaFilaDeEntidades: async () => [{ id: 7, entidade: 'LancamentoTarefa', operacao: 'create', registroId: 't-nova', situacao: 'aguardando', dados: {} }],
      excluirDaFilaDeEntidades: async () => 1,
    }));
    vi.doMock('@/services/fotosDeTarefaAguardandoService', async (original) => ({
      ...(await original()),
      listarFotosAguardandoEnvio: async () => [
        { chave: 11, tarefaId: 't-nova' },
        { chave: 12, tarefaId: 'outra' },
      ],
      excluirFotoGuardada: async (chave) => excluidas.push(chave),
    }));
    const pedidos = [];
    const ouvir = (e) => pedidos.push(e.detail?.cacheKeys);
    window.addEventListener('atualizar-mapa', ouvir);
    const svc = await import('@/services/sincronizacaoService');
    expect(await svc.descartarRegistroNaoEnviado('cadastro:7')).toBe(true);
    window.removeEventListener('atualizar-mapa', ouvir);
    expect(excluidas).toEqual([11]);
    expect(pedidos).toContainEqual(['tarefas']);
    vi.doUnmock('@/services/fotosDeTarefaAguardandoService');
  });
});
