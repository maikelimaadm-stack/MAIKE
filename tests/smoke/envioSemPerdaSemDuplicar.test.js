/**
 * D-PROD-308 — Etapa 1: nada se perde, nada duplica.
 *
 *  A. Id do aparelho (fila antiga: cocho/ponto e lote)
 *     IA-01 criado sem internet já nasce com o id definitivo (UUID); ao enviar, o id vai junto
 *     IA-02 com internet, a criação que não chega a uma resposta vai para a fila com o MESMO id
 *     IA-03 com internet, a recusa do servidor volta para a tela e nada fica na fila
 *     IA-04 editar sem internet o que ainda está na fila entra na própria criação (um envio só)
 *     IA-05 excluir sem internet o que ainda está na fila: sai da fila, nada vai ao servidor
 *  B. Motor: gravado antes de sair
 *     EN-01 com internet, o item já está no aparelho enquanto o pedido está no ar (sem aparecer
 *           como "aguardando"); depois fica "enviado"
 *     EN-02 app fechado com o pedido no ar: a reserva vence e a passada termina com o MESMO código
 *     EN-03 a passada não manda junto o item que a tela está enviando
 *     EN-04 o passo feito (a baixa) fica gravado no aparelho durante o envio
 *     EN-05 recusa do servidor: o item sai da fila e a tela decide
 *  C. Ordem entre as filas
 *     OR-01 a leitura de um cocho criado sem internet espera a criação; numa sincronização só,
 *           o cocho sobe e depois a leitura, com o id do cocho
 *  D. Entre abas
 *     AB-01 com `navigator.locks`, a sincronização roda dentro da trava "maike-sincronia"
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/apis/_core/nativeHttpClient.js', () => ({ nativeRequest: vi.fn(async () => []) }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Porta em memória com o mesmo contrato do armazenamento IndexedDB. */
const memoria = () => {
  const cache = new Map();
  const fila = new Map();
  let proximo = 1;
  return {
    cache,
    fila,
    lerCache: async (k) => [...(cache.get(k) || [])],
    gravarCache: async (k, r) => {
      cache.set(k, r.items);
    },
    listarFila: async () => [...fila.values()].map((i) => structuredClone(i)),
    adicionarNaFila: async (i) => {
      const id = proximo++;
      fila.set(id, { ...structuredClone(i), id });
      return id;
    },
    atualizarNaFila: async (id, c) => {
      const a = fila.get(id);
      if (a) fila.set(id, { ...a, ...structuredClone(c), id });
    },
    removerDaFila: async (id) => {
      fila.delete(id);
    },
    removerCache: async (k) => {
      cache.delete(k);
    },
  };
};

const online = (v) => Object.defineProperty(window.navigator, 'onLine', { value: v, configurable: true });

let storage;
let rt;
let erros;

beforeEach(async () => {
  vi.resetModules();
  storage = memoria();
  rt = await import('@/lib/offline/offlineEntityRuntime');
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
  rt.resetOfflineEntityRuntime();
  erros = await import('@/apis/_core/ApiError');
  online(true);
});

afterEach(() => {
  online(true);
});

/** "Servidor" do cocho: grava pelo id que chega (repetir devolve o mesmo). */
const servidorDePontos = () => {
  const gravados = new Map();
  const ops = {
    list: vi.fn(async () => [...gravados.values()]),
    create: vi.fn(async (d) => {
      const id = d.id ?? `srv_${gravados.size + 1}`;
      if (!gravados.has(id)) gravados.set(id, { ...d, id });
      return gravados.get(id);
    }),
    update: vi.fn(async (id, d) => ({ ...gravados.get(id), ...d, id })),
    delete: vi.fn(async (id) => {
      gravados.delete(id);
    }),
  };
  return { gravados, ops };
};

const portaDoPonto = (ops) =>
  rt.createOfflineEntityAdapter({ entityName: 'PontoSuplementacao', operations: ops, storage, tenantScoped: true, idDoAparelho: true });

describe('D-PROD-308 A — id do aparelho na fila antiga', () => {
  it('IA-01 sem internet nasce com o id definitivo; ao enviar, o id vai junto', async () => {
    const { ops, gravados } = servidorDePontos();
    const porta = portaDoPonto(ops);
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'COCHO DO CAMPO' });
    expect(criado.id).toMatch(UUID);
    expect(criado._isOffline).toBe(true);
    const [item] = [...storage.fila.values()];
    expect(item).toMatchObject({ operation: 'create', record_id: criado.id });
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({ id: criado.id, nome_ponto: 'COCHO DO CAMPO' }));
    expect([...gravados.keys()]).toEqual([criado.id]);
    expect(storage.fila.size).toBe(0);
    const lista = await porta.list();
    expect(lista.map((p) => p.id)).toEqual([criado.id]);
  });

  it('IA-02 com internet, sem resposta: vai para a fila com o MESMO id; reenviar não duplica', async () => {
    const { ops, gravados } = servidorDePontos();
    const original = ops.create.getMockImplementation();
    // O servidor grava, mas a resposta se perde (rede caiu na volta).
    ops.create.mockImplementationOnce(async (d) => {
      await original(d);
      throw new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
    });
    const porta = portaDoPonto(ops);
    const r = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'COCHO' });
    expect(r.id).toMatch(UUID);
    expect(r._isOffline).toBe(true);
    const [item] = [...storage.fila.values()];
    expect(item.record_id).toBe(r.id);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).toHaveBeenCalledTimes(2);
    expect(ops.create.mock.calls.map((c) => c[0].id)).toEqual([r.id, r.id]);
    expect(gravados.size).toBe(1);
    expect(storage.fila.size).toBe(0);
  });

  it('IA-03 com internet, recusa do servidor: volta para a tela, nada na fila', async () => {
    const { ops } = servidorDePontos();
    ops.create.mockRejectedValueOnce(
      new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'REQUEST_VALIDATION_FAILED' } })
    );
    const porta = portaDoPonto(ops);
    await expect(porta.create({ empresa_id: 'emp-1', nome_ponto: '' })).rejects.toBeTruthy();
    expect(storage.fila.size).toBe(0);
  });

  it('IA-04 editar sem internet o que ainda está na fila: entra na criação (um envio só)', async () => {
    const { ops } = servidorDePontos();
    const porta = portaDoPonto(ops);
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    await porta.update(criado.id, { empresa_id: 'emp-1', nome_ponto: 'B' });
    expect([...storage.fila.values()].map((i) => i.operation)).toEqual(['create']);
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).toHaveBeenCalledWith(expect.objectContaining({ id: criado.id, nome_ponto: 'B' }));
    expect(ops.update).not.toHaveBeenCalled();
  });

  it('IA-05 excluir sem internet o que ainda está na fila: sai da fila, nada vai ao servidor', async () => {
    const { ops } = servidorDePontos();
    const porta = portaDoPonto(ops);
    online(false);
    const criado = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'A' });
    await porta.delete(criado.id);
    expect(storage.fila.size).toBe(0);
    online(true);
    await rt.syncOfflineEntityQueue();
    expect(ops.create).not.toHaveBeenCalled();
    expect(ops.delete).not.toHaveBeenCalled();
  });
});

describe('D-PROD-308 B — motor: gravado antes de sair', () => {
  let motor;
  let fila;
  let relogio;
  let temRede;
  beforeEach(async () => {
    motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
    fila = criarFilaEmMemoria();
    relogio = Date.parse('2026-11-25T12:00:00Z');
    temRede = true;
    motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => relogio, online: () => temRede });
    motor.definirSessaoDaFila({ cliente_id: 'cli_A', usuario_id: 'usr_1' });
  });
  afterEach(() => motor.definirSessaoDaFila(null));

  it('EN-01 com o pedido no ar, o item já está no aparelho (sem aparecer como aguardando); depois, enviado', async () => {
    let soltar;
    const noAr = [];
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async (_p, { operationId }) => {
        noAr.push((await fila.ler(operationId))?.estado);
        await new Promise((r) => (soltar = r));
        return { id: 'srv-1' };
      },
    });
    const envio = motor.enviarOuGuardar('cocho.leitura', { ponto_suplementacao_id: 'c1', escore: 2 }, { operationId: 'op-1' });
    await vi.waitFor(() => expect(noAr).toEqual(['pendente']));
    expect((await motor.resumoDaFila()).aguardando).toBe(0);
    expect(await motor.registrosAguardandoDoTipo('cocho.leitura')).toEqual([]);
    soltar();
    expect(await envio).toMatchObject({ estado: 'enviado', operationId: 'op-1' });
    expect(await fila.ler('op-1')).toMatchObject({ estado: 'enviado', resultado: { id: 'srv-1' } });
    expect((await fila.ler('op-1')).direto_ate).toBeUndefined();
  });

  it('EN-02 app fechado com o pedido no ar: a reserva vence e a passada termina com o MESMO código', async () => {
    const recebidos = [];
    let primeira = true;
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async (_p, { operationId }) => {
        recebidos.push(operationId);
        if (primeira) {
          primeira = false;
          return new Promise(() => {}); // o app "fechou": a resposta nunca chega
        }
        return { id: 'srv-1' };
      },
    });
    void motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-fechou' });
    await vi.waitFor(() => expect(recebidos).toEqual(['op-fechou']));
    // Antes de a reserva vencer, a passada não manda junto.
    await motor.sincronizar();
    expect(recebidos).toEqual(['op-fechou']);
    relogio += 3 * 60 * 1000;
    await motor.sincronizar();
    expect(recebidos).toEqual(['op-fechou', 'op-fechou']);
    expect(await fila.ler('op-fechou')).toMatchObject({ estado: 'enviado' });
  });

  it('EN-04 o passo feito fica gravado no aparelho durante o envio', async () => {
    let soltar;
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.lancamento',
      versao: 1,
      offline: true,
      enviar: async (_p, { registrarProgresso }) => {
        await registrarProgresso({ saida_feita: { id: 'mov-1', quantidade: 80 } });
        await new Promise((r) => (soltar = r));
        return { id: 'ev-1' };
      },
    });
    const envio = motor.enviarOuGuardar('cocho.lancamento', { quantidade: 80 }, { operationId: 'op-l' });
    await vi.waitFor(async () => expect((await fila.ler('op-l'))?.progresso).toEqual({ saida_feita: { id: 'mov-1', quantidade: 80 } }));
    soltar();
    await envio;
  });

  it('EN-05 recusa do servidor: o item sai da fila e a tela decide', async () => {
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async () => {
        throw new erros.ApiError(erros.API_ERROR_CODES.OPERATION_FAILED, { operation: 'x', resource: 'y', cause: { code: 'PONTO_NOT_FOUND' } });
      },
    });
    await expect(motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-r' })).rejects.toBeTruthy();
    expect(await fila.ler('op-r')).toBeUndefined();
  });

  it('EN-06 falha de rede no envio direto: fica aguardando (sem reserva) e a passada envia', async () => {
    let vez = 0;
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async () => {
        vez += 1;
        if (vez === 1) throw new erros.ApiError(erros.API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
        return { id: 'srv' };
      },
    });
    expect(await motor.enviarOuGuardar('cocho.leitura', { escore: 1 }, { operationId: 'op-n' })).toMatchObject({ estado: 'aguardando' });
    const item = await fila.ler('op-n');
    expect(item).toMatchObject({ estado: 'pendente', tentado: true });
    expect(item.direto_ate).toBeUndefined();
    expect((await motor.resumoDaFila()).aguardando).toBe(1);
    await motor.sincronizar();
    expect(await fila.ler('op-n')).toMatchObject({ estado: 'enviado' });
  });
});

describe('D-PROD-308 C — ordem entre as filas', () => {
  it('OR-01 a leitura de um cocho criado sem internet espera a criação; numa sincronização só, sobem os dois, na ordem', async () => {
    const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
    const fila = criarFilaEmMemoria();
    motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => Date.parse('2026-11-25T12:00:00Z'), online: () => navigator.onLine !== false });
    motor.definirSessaoDaFila({ cliente_id: 'cli_A', usuario_id: 'usr_1' });
    // gatilhos liga a espera da fila antiga (carregado depois da configuração do motor)
    const gatilhos = await import('@/lib/offline/sincronizacao/gatilhosDeSincronizacao');

    const ordem = [];
    const { ops } = servidorDePontos();
    const criar = ops.create.getMockImplementation();
    ops.create.mockImplementation(async (d) => {
      ordem.push(`ponto:${d.id}`);
      return criar(d);
    });
    const porta = portaDoPonto(ops);
    motor.registrarTipoDeEnvio({
      tipo: 'cocho.leitura',
      versao: 1,
      offline: true,
      enviar: async (p) => {
        ordem.push(`leitura:${p.ponto_suplementacao_id}`);
        return { id: 'lei-1' };
      },
    });

    online(false);
    const cocho = await porta.create({ empresa_id: 'emp-1', nome_ponto: 'COCHO NOVO' });
    await motor.enviarOuGuardar('cocho.leitura', { ponto_suplementacao_id: cocho.id, escore: 2 }, { operationId: 'op-leitura' });
    online(true);

    // Envio direto de outra leitura no mesmo cocho, com internet, enquanto o cocho está na fila: espera.
    expect(await motor.enviarOuGuardar('cocho.leitura', { ponto_suplementacao_id: cocho.id, escore: 3 }, { operationId: 'op-leitura-2' })).toMatchObject({
      estado: 'aguardando',
    });

    await gatilhos.sincronizarTudo();
    expect(ordem).toEqual([`ponto:${cocho.id}`, `leitura:${cocho.id}`, `leitura:${cocho.id}`]);
    expect((await fila.ler('op-leitura')).estado).toBe('enviado');
    expect((await fila.ler('op-leitura-2')).estado).toBe('enviado');
    motor.definirSessaoDaFila(null);
  });
});

describe('D-PROD-308 D — entre abas', () => {
  it('AB-01 com navigator.locks, a sincronização roda dentro da trava "maike-sincronia"', async () => {
    const pedidos = [];
    Object.defineProperty(window.navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(async (nome, opcoes, fn) => {
          pedidos.push([nome, opcoes.mode]);
          return fn();
        }),
      },
    });
    try {
      const { naVezDaSincronia } = await import('@/lib/offline/sincronizacao/vezDaSincronia');
      expect(await naVezDaSincronia(async () => 42)).toBe(42);
      expect(pedidos).toEqual([['maike-sincronia', 'exclusive']]);
    } finally {
      delete /** @type {any} */ (window.navigator).locks;
    }
  });
});
