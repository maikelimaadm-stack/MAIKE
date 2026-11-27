/**
 * D-PROD-335 — Grupo 1 da varredura sem internet: o que perdia, duplicava ou apagava dados.
 *
 *  G1-01 duas passadas pedidas ao mesmo tempo pela fila de cadastros: a criação vai UMA vez ao servidor
 *  G1-02 edição feita enquanto a criação do registro está indo ao servidor: não se perde
 *  G1-03 exclusão feita enquanto a criação está indo ao servidor: chega ao servidor (o registro não volta)
 *  G1-04 edição nova de um registro com edição RECUSADA na fila: vira um item próprio e conta como aguardando
 *  G1-05 a edição do lote manda a versão que a pessoa viu (D-PROD-316)
 *  G1-06 a passada carrega quem sabe enviar o lançamento do cocho (depois de o app reabrir)
 *  G1-07 "Excluir" enquanto o registro vai ao servidor: a falha do envio não o recria
 *  G1-08 o servidor grava no lançamento do cocho o código da operação
 * Fotos de tarefa (somar no servidor, excluída durante o envio, edição aberta antes): tarefaFotosSemInternet.test.js
 * Lançamento do cocho que tentou sem resposta continua na lista: telaNaoPisca.test.js (TN-02).
 */
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

/** Promessa que o teste resolve quando quiser (o servidor "demorando"). */
const adiada = () => {
  let resolver;
  const promessa = new Promise((r) => {
    resolver = r;
  });
  return { promessa, resolver: () => resolver() };
};

let storage;
let rt;

beforeEach(async () => {
  vi.resetModules();
  storage = memoria();
  rt = await import('@/lib/offline/offlineEntityRuntime');
  (await import('@/lib/offline/offlineTenant')).setOfflineTenant('cli_A');
  rt.resetOfflineEntityRuntime();
  online(true);
});

afterEach(() => {
  online(true);
});

/** "Servidor" de marcas (id do servidor, sem id do aparelho: repetir a criação DUPLICA). */
const servidorDeMarcas = () => {
  const gravados = new Map();
  let segurar = null;
  const ops = {
    list: vi.fn(async () => [...gravados.values()]),
    create: vi.fn(async (d) => {
      if (segurar) await segurar.promessa;
      const id = `srv_${gravados.size + 1}`;
      gravados.set(id, { ...d, id });
      return gravados.get(id);
    }),
    update: vi.fn(async (id, d) => {
      gravados.set(id, { ...gravados.get(id), ...d, id });
      return gravados.get(id);
    }),
    delete: vi.fn(async (id) => {
      gravados.delete(id);
    }),
  };
  return {
    gravados,
    ops,
    demorar: () => {
      segurar = adiada();
      return segurar;
    },
  };
};

const portaDaMarca = (ops) => rt.createOfflineEntityAdapter({ entityName: 'Marca', operations: ops, storage, tenantScoped: true });

/** Espera o envio começar (o create foi chamado). */
const ateChamar = async (fn) => {
  for (let i = 0; i < 50 && fn.mock.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 0));
};

describe('D-PROD-335 — fila de cadastros', () => {
  it('G1-01 duas passadas ao mesmo tempo: a criação vai UMA vez', async () => {
    const srv = servidorDeMarcas();
    const porta = portaDaMarca(srv.ops);
    online(false);
    await porta.create({ empresa_id: 'emp-1', nome: 'MARCA' });
    online(true);
    const lento = srv.demorar();
    const a = rt.syncOfflineEntityQueue();
    const b = rt.syncOfflineEntityQueue();
    await ateChamar(srv.ops.create);
    lento.resolver();
    await Promise.all([a, b]);
    expect(srv.ops.create).toHaveBeenCalledTimes(1);
    expect([...srv.gravados.values()].map((m) => m.nome)).toEqual(['MARCA']);
    expect(storage.fila.size).toBe(0);
  });

  it('G1-02 edição enquanto a criação está indo ao servidor: chega ao servidor', async () => {
    const srv = servidorDeMarcas();
    const porta = portaDaMarca(srv.ops);
    online(false);
    const criada = await porta.create({ empresa_id: 'emp-1', nome: 'M1' });
    online(true);
    const lento = srv.demorar();
    const passada = rt.syncOfflineEntityQueue();
    await ateChamar(srv.ops.create);
    const editada = await porta.update(criada.id, { empresa_id: 'emp-1', nome: 'M1 EDITADA' });
    expect(editada.nome).toBe('M1 EDITADA');
    lento.resolver();
    await passada;
    expect([...srv.gravados.values()].map((m) => m.nome)).toEqual(['M1 EDITADA']);
    expect(storage.fila.size).toBe(0);
    expect((await porta.list()).map((m) => m.nome)).toEqual(['M1 EDITADA']);
  });

  it('G1-03 exclusão enquanto a criação está indo ao servidor: o registro não volta', async () => {
    const srv = servidorDeMarcas();
    const porta = portaDaMarca(srv.ops);
    online(false);
    const criada = await porta.create({ empresa_id: 'emp-1', nome: 'M' });
    online(true);
    const lento = srv.demorar();
    const passada = rt.syncOfflineEntityQueue();
    await ateChamar(srv.ops.create);
    await porta.delete(criada.id);
    lento.resolver();
    await passada;
    await rt.syncOfflineEntityQueue();
    expect(srv.ops.delete).toHaveBeenCalledTimes(1);
    expect(srv.gravados.size).toBe(0);
    expect(await porta.list()).toEqual([]);
    expect(storage.fila.size).toBe(0);
  });

  it('G1-04 edição nova de um registro com edição recusada: item próprio, contado como aguardando', async () => {
    const srv = servidorDeMarcas();
    srv.gravados.set('srv_1', { id: 'srv_1', empresa_id: 'emp-1', nome: 'A' });
    const porta = portaDaMarca(srv.ops);
    online(false);
    await porta.update('srv_1', { empresa_id: 'emp-1', nome: 'B' });
    const [recusada] = [...storage.fila.values()];
    await storage.atualizarNaFila(recusada.id, { quarentena: { codigo: rt.CODIGO_RECUSADO_PELO_SERVIDOR, motivo: 'conflito' } });
    await porta.update('srv_1', { empresa_id: 'emp-1', observacoes: 'nova' });
    const itens = [...storage.fila.values()];
    expect(itens).toHaveLength(2);
    expect(itens[0].data).not.toHaveProperty('observacoes');
    expect(itens[1]).toMatchObject({ operation: 'update', data: { observacoes: 'nova' } });
    expect(await rt.contarPendenciasDaFilaDeEntidades()).toBe(1);
  });
});

describe('D-PROD-335 — lote manda a versão', () => {
  it('G1-05 a edição do lote leva versao_esperada no corpo do PATCH', async () => {
    const chamadas = [];
    vi.doMock('@/apis/_core/nativeHttpClient.js', () => ({
      nativeRequest: vi.fn(async (caminho, opcoes) => {
        chamadas.push({ caminho, opcoes });
        return { id: 'l1' };
      }),
    }));
    const { operacoesNativas } = await import('@/apis/lotes/loteNativePort.js');
    await operacoesNativas.update('l1', { nome: 'LOTE X', versao_esperada: '2026-11-20T10:00:00.000Z' });
    expect(chamadas[0].opcoes.body).toEqual({ nome: 'LOTE X', versao_esperada: '2026-11-20T10:00:00.000Z' });
    vi.doUnmock('@/apis/_core/nativeHttpClient.js');
  });
});

describe('D-PROD-335 — fila dos cochos e depósitos', () => {
  const configurar = async () => {
    const motor = await import('@/lib/offline/sincronizacao/motorDeSincronizacao');
    const { criarFilaEmMemoria } = await import('@/lib/offline/sincronizacao/filaDeEnvio');
    const fila = criarFilaEmMemoria();
    motor.configurarMotorDeSincronizacao({ porta: fila, agora: () => Date.parse('2026-11-26T12:00:00Z'), online: () => navigator.onLine !== false });
    motor.definirSessaoDaFila({ cliente_id: 'cli_A', usuario_id: 'usr_1' });
    return { motor, fila };
  };

  it('G1-06 depois de o app reabrir, a passada carrega quem envia o lançamento do cocho', async () => {
    const { motor, fila } = await configurar();
    await fila.gravar(
      /** @type {any} */ ({
        id: 'op-lanc-0001',
        tipo: 'cocho.lancamento',
        versao: 1,
        estado: 'pendente',
        cliente_id: 'cli_A',
        usuario_id: 'usr_1',
        criado_em: '2026-11-26T11:00:00.000Z',
        payload: {},
        recursos: [],
        referencias: [],
        tentativas: 0,
      })
    );
    expect(await motor.temTipoSemRegistroNaFila()).toBe(true);
    const gatilhos = await import('@/lib/offline/sincronizacao/gatilhosDeSincronizacao');
    await gatilhos.prepararTiposDeEnvio();
    expect(await motor.temTipoSemRegistroNaFila()).toBe(false);
    motor.definirSessaoDaFila(null);
  });

  it('G1-07 "Excluir" enquanto o registro vai ao servidor: a falha do envio não o recria', async () => {
    const { motor, fila } = await configurar();
    const { ApiError, API_ERROR_CODES } = await import('@/apis/_core/ApiError');
    let excluir;
    const enviar = vi.fn(async () => {
      await excluir();
      throw new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, { operation: 'x', resource: 'y' });
    });
    motor.registrarTipoDeEnvio({ tipo: 'teste.registro', versao: 1, offline: true, enviar });
    online(false);
    await motor.enviarOuGuardar('teste.registro', { a: 1 }, { operationId: 'op-excluir-0001' });
    online(true);
    excluir = () => motor.descartarDaFila('op-excluir-0001', { mesmoSemResposta: true });
    await motor.sincronizar();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await fila.ler('op-excluir-0001')).toBeFalsy();
    await motor.sincronizar();
    expect(enviar).toHaveBeenCalledTimes(1);
    motor.definirSessaoDaFila(null);
  });
});

describe('D-PROD-335 — servidor', () => {
  it('G1-08 o lançamento do cocho guarda o código da operação (fora do fingerprint)', () => {
    const src = readFileSync('backend/src/modules/suplementacaoEventos/suplementacaoEventoComandoService.js', 'utf8');
    expect(src).toContain('montarDocumento(auth.clienteId, { ...evento, operation_id: operationKey })');
    expect(src.indexOf('fingerprintDePayload({ evento, lotes })')).toBeLessThan(src.indexOf('operation_id: operationKey }'));
  });
});
